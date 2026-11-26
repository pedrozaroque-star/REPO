/**
 * @module components/RemoteDeviceBridge
 * @description Bridge remoto ligero del lado del cliente para tabletas Android de sucursal
 *              (`/inventory/preparador` y `/tablet/blindaje-delivery` / `/admin/blindaje-delivery/empaque`).
 *              Auto-registra la tableta en `/admin/control-remoto`, reporta telemetría (batería, resolución,
 *              fullscreen, ruta activa) cada 45s y ejecuta comandos seguros enviados por Admin sin ir a la tienda.
 *
 * @businessRules
 * - Permanece 100% inactivo (`null`, cero peticiones de red) fuera de las rutas de tableta de sucursal.
 * - Pausa polling cuando la pestaña no está visible (`document.visibilityState !== 'visible'`).
 * - Solo ejecuta comandos de la lista blanca segura (`reload_page`, `clear_cache_reload`, `navigate_url`
 *   con rutas internas válidas, `show_banner`, `test_sound`, `request_fullscreen`).
 * - Envía ACK antes de recargar o navegar para confirmar en `/admin/control-remoto` que el equipo obedeció.
 *
 * @dataFlow
 * - `ClientLayout` -> `RemoteDeviceBridge` -> POST `/api/remote-control/web-bridge` (cada 45s) -> ACK.
 */

'use client'

import React, { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { BellRing, X } from 'lucide-react'
import { isSafeInternalRoute, normalizeRemoteStoreCode } from '@/lib/remote-control'
import { purgeTabletStaleCaches } from '@/lib/tablet-cache-cleaner'

const BRIDGE_POLL_INTERVAL_MS = 45_000

interface RemoteBannerState {
  message: string
  expiresAtMs: number | null
}

function detectTabletRole(pathname: string | null): 'prep_tablet' | 'delivery_tablet' | null {
  if (!pathname) return null
  if (pathname === '/inventory/preparador' || pathname.startsWith('/inventory/preparador/')) {
    return 'prep_tablet'
  }
  if (
    pathname === '/tablet/blindaje-delivery' ||
    pathname.startsWith('/tablet/blindaje-delivery/') ||
    pathname === '/admin/blindaje-delivery/empaque' ||
    pathname.startsWith('/admin/blindaje-delivery/empaque/')
  ) {
    return 'delivery_tablet'
  }
  return null
}

function resolveCurrentTabletStoreCode(role: 'prep_tablet' | 'delivery_tablet'): string | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('store') || params.get('storeId') || params.get('store_id')
    if (fromUrl) {
      const norm = normalizeRemoteStoreCode(fromUrl)
      if (norm) return norm
    }

    if (role === 'prep_tablet') {
      const prepSaved = localStorage.getItem('teg_preparador_store')
      const normPrep = normalizeRemoteStoreCode(prepSaved)
      if (normPrep) return normPrep
    } else {
      const delSaved = localStorage.getItem('blindaje_delivery_store_id')
      const normDel = normalizeRemoteStoreCode(delSaved)
      if (normDel) return normDel
    }

    const rawUser = localStorage.getItem('teg_user')
    if (rawUser) {
      const parsed = JSON.parse(rawUser)
      const normUser = normalizeRemoteStoreCode(
        parsed?.store_id ?? parsed?.storeId ?? parsed?.store_code ?? parsed?.store_name
      )
      if (normUser) return normUser
    }
  } catch {
    // ignore storage errors
  }
  return null
}

async function collectClientTelemetry(pathname: string): Promise<Record<string, any>> {
  let batteryPct: number | null = null
  let isCharging: boolean | null = null
  try {
    const nav = navigator as any
    if (typeof nav?.getBattery === 'function') {
      const bat = await nav.getBattery()
      if (bat && typeof bat.level === 'number') {
        batteryPct = Math.round(bat.level * 100)
        isCharging = Boolean(bat.charging)
      }
    }
  } catch {
    // Battery API not supported
  }

  return {
    route: pathname,
    batteryPct,
    isCharging,
    isFullscreen: Boolean(
      document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement
    ),
    screenResolution: `${window.screen?.width || window.innerWidth}x${window.screen?.height || window.innerHeight}`,
    userAgent: navigator.userAgent?.slice(0, 220) || null,
  }
}

function playVerificationChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const playTone = (freq: number, startSec: number, durSec: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startSec)
      gain.gain.setValueAtTime(0.001, ctx.currentTime + startSec)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + startSec + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startSec + durSec)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + startSec)
      osc.stop(ctx.currentTime + startSec + durSec + 0.02)
    }
    playTone(880, 0, 0.22)
    playTone(1174.66, 0.22, 0.3)
    setTimeout(() => {
      try {
        ctx.close()
      } catch {}
    }, 900)
  } catch {
    // autoplay locked
  }
}

export default function RemoteDeviceBridge() {
  const pathname = usePathname()
  const role = detectTabletRole(pathname)
  const [banner, setBanner] = useState<RemoteBannerState | null>(null)
  const inFlightRef = useRef(false)
  const executedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!banner?.expiresAtMs) return
    const msLeft = banner.expiresAtMs - Date.now()
    if (msLeft <= 0) {
      setBanner(null)
      return
    }
    const timer = setTimeout(() => setBanner(null), msLeft)
    return () => clearTimeout(timer)
  }, [banner])

  useEffect(() => {
    if (!role || !pathname) return
    let cancelled = false

    const buildHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      try {
        const tok = localStorage.getItem('teg_token')
        if (tok && tok !== 'null' && tok !== 'undefined') {
          headers['Authorization'] = `Bearer ${tok}`
        }
      } catch {}
      return headers
    }

    const sendAck = async (
      storeCode: string,
      commandId: string,
      status: 'succeeded' | 'failed',
      output?: string,
      errorMessage?: string
    ) => {
      try {
        await fetch('/api/remote-control/web-bridge', {
          method: 'POST',
          headers: buildHeaders(),
          credentials: 'include',
          keepalive: true,
          body: JSON.stringify({
            action: 'ack',
            storeCode,
            deviceRole: role,
            commandId,
            status,
            output,
            errorMessage,
          }),
        })
      } catch {
        // ignore network errors on ack
      }
    }

    const executeCommand = async (storeCode: string, cmd: any) => {
      if (!cmd?.id || executedIdsRef.current.has(cmd.id)) return
      executedIdsRef.current.add(cmd.id)

      const cmdType = String(cmd.command_type || '')
      const payload = (cmd.payload && typeof cmd.payload === 'object' ? cmd.payload : {}) as Record<string, any>

      try {
        switch (cmdType) {
          case 'reload_page': {
            await sendAck(storeCode, cmd.id, 'succeeded', 'Recargando tableta remotamente...')
            window.location.reload()
            return
          }
          case 'clear_cache_reload': {
            const cleaned = await purgeTabletStaleCaches({
              clearBrowserCaches: true,
              forceTokenRefresh: true,
              force: true,
              clearSessionStorage: true,
            })
            await sendAck(
              storeCode,
              cmd.id,
              'succeeded',
              `Caché limpiada (${cleaned.removedLocalStorageKeys} llaves, ${cleaned.clearedCacheBuckets} caches). Recargando...`
            )
            window.location.reload()
            return
          }
          case 'navigate_url': {
            const target = String(payload.url || '').trim()
            if (!isSafeInternalRoute(target)) {
              await sendAck(storeCode, cmd.id, 'failed', undefined, 'Ruta interna no permitida')
              return
            }
            await sendAck(storeCode, cmd.id, 'succeeded', `Navegando hacia ${target}`)
            window.location.assign(target)
            return
          }
          case 'show_banner': {
            const msg = String(payload.message || '').trim()
            const durationSec = Number(payload.durationSec || 60)
            setBanner({
              message: msg,
              expiresAtMs: durationSec > 0 ? Date.now() + durationSec * 1000 : null,
            })
            playVerificationChime()
            await sendAck(storeCode, cmd.id, 'succeeded', 'Aviso remoto mostrado en pantalla')
            return
          }
          case 'test_sound': {
            playVerificationChime()
            await sendAck(storeCode, cmd.id, 'succeeded', 'Tono de prueba ejecutado en tableta')
            return
          }
          case 'request_fullscreen': {
            const docEl = document.documentElement as any
            const req =
              docEl.requestFullscreen ||
              docEl.webkitRequestFullscreen ||
              docEl.mozRequestFullScreen ||
              docEl.msRequestFullscreen
            if (req) {
              try {
                await req.call(docEl)
                await sendAck(storeCode, cmd.id, 'succeeded', 'Pantalla completa activada')
              } catch {
                setBanner({
                  message: 'Toca la pantalla para activar Modo Pantalla Completa (solicitado por Administración).',
                  expiresAtMs: Date.now() + 45_000,
                })
                await sendAck(
                  storeCode,
                  cmd.id,
                  'succeeded',
                  'El navegador requiere un toque para fullscreen; se mostró aviso en pantalla.'
                )
              }
            } else {
              await sendAck(storeCode, cmd.id, 'failed', undefined, 'Fullscreen API no disponible')
            }
            return
          }
          default:
            await sendAck(storeCode, cmd.id, 'failed', undefined, `Comando no soportado: ${cmdType}`)
        }
      } catch (err: any) {
        await sendAck(storeCode, cmd.id, 'failed', undefined, err?.message || 'Error ejecutando comando')
      }
    }

    const runSync = async () => {
      if (cancelled || inFlightRef.current) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

      const storeCode = resolveCurrentTabletStoreCode(role)
      if (!storeCode) return

      inFlightRef.current = true
      try {
        const telemetry = await collectClientTelemetry(pathname)
        const res = await fetch('/api/remote-control/web-bridge', {
          method: 'POST',
          headers: buildHeaders(),
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify({
            action: 'sync',
            storeCode,
            deviceRole: role,
            telemetry,
          }),
        })
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        if (data?.success && Array.isArray(data.commands)) {
          for (const cmd of data.commands) {
            await executeCommand(storeCode, cmd)
          }
        }
      } catch {
        // silent offline resilience
      } finally {
        inFlightRef.current = false
      }
    }

    // Sincronización inicial tras 4s para permitir que la vista cargue su storeCode
    const initTimer = setTimeout(runSync, 4000)
    const interval = setInterval(runSync, BRIDGE_POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void runSync()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearTimeout(initTimer)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [role, pathname])

  if (!role || !banner) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[99999] max-w-[92vw] sm:max-w-xl animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-indigo-600 text-white shadow-2xl border border-indigo-400/40">
        <BellRing className="w-5 h-5 shrink-0 animate-bounce" />
        <p className="text-sm font-bold leading-snug break-words">{banner.message}</p>
        <button
          type="button"
          onClick={() => setBanner(null)}
          className="p-1 rounded-lg hover:bg-white/20 transition-colors shrink-0"
          aria-label="Cerrar aviso"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
