/**
 * @module components/DeliveryPhoneNotesAlertPanel
 * @description Panel temporal de alertas telefónicas parpadeantes para órdenes de Delivery (DoorDash, Uber Eats,
 *   Grubhub y Tacos Gavilan Online) en la tableta de llamado de clientes (`/inventory/preparador`) y en el tablero
 *   `/order-ready-board` (oculto en Modo TV/F11), replicando exactamente la función y comportamiento de Delivery Armor
 *   mientras se despliegan las tabletas dedicadas de empaque en todas las sucursales.
 *
 * @businessRules
 * - **Exclusión de Sucursales con Tableta Física Delivery Armor**: `#7 Slauson` y `#8 Hollywood` (`STORES_WITH_PHYSICAL_DELIVERY_ARMOR_TABLET`)
 *   ya operan con su propia tableta física de Delivery Armor, por lo que esta alerta temporal se apaga por completo en esas tiendas
 *   (0 peticiones, 0 Realtime, 0 sonido, 0 px) y solo se muestra en las otras 13 sucursales mientras reciben sus tabletas.
 * - **Cero Ruido en Reposo**: Cuando no hay alertas `pending` o `acknowledged` para la sucursal activa, renderiza `null`
 *   (0 px de altura) para no estorbar la operación normal de llamado de clientes ni parrilla.
 * - **Tiempo Real < 500 ms + Fallback Seguro**: Se suscribe al canal Supabase Realtime Broadcast
 *   `blindaje-delivery-phone-notes-${storeId}` (payload ligero sin PII que dispara refetch autenticado) y mantiene
 *   polling de respaldo adaptativo (20 s en horario operativo, 120 s de 4:15–6:59 AM PT, pausado con pestaña oculta).
 * - **Misma Función que Delivery Armor + Ícono Cerrar Estilo Tableta Preparador**:
 *   * Timbre triple distintivo Web Audio API (`C6 1046.5 Hz` triangle + `G6 1567.98 Hz` sine, 3 pulsos en 0, 0.24 y 0.48 s),
 *     con desbloqueo diferido al primer toque si el navegador suspendió autoplay.
 *   * Tarjeta parpadeante de alto contraste (`.da-phone-alert-blink`) con plataforma, cliente, código/Check #,
 *     aviso rojo "¡REABRIR BOLSA!" si la bolsa ya estaba sellada (`PACKED_AND_SEALED`), chips de condimentos gratuitos,
 *     modificaciones sin costo y platillos de referencia rápida de la orden en Toast.
 *   * Botón grande apto para guantes "✓ CONFIRMAR CONDIMENTOS / AJUSTE APLICADO" (`PATCH /api/delivery-armor/phone-notes`
 *     con sesión autenticada) que apaga el parpadeo en TODAS las tabletas de la sucursal al instante vía Broadcast y
 *     resuelve automáticamente cualquier callback ligado en `phone_callback_requests`.
 *   * Botón circular rojo de cierre (`✕`) estilo Tableta Preparador en cada orden individual de delivery para cerrar
 *     esa orden en 1 toque (`action: 'dismiss'`), apagándola en todas las tabletas de la sucursal sin afectar otras órdenes.
 * - **Privacidad**: En `/order-ready-board`, el padre solo monta este componente cuando NO está en modo TV/Fullscreen.
 *   Las notas `source = 'simulator'` quedan ocultas salvo que un admin habilite `includeSimulator`.
 *
 * @dataFlow
 * - Realtime Broadcast (`blindaje-delivery-phone-notes-${storeId}`) / Polling -> `GET /api/delivery-armor/phone-notes`
 *   -> Estado local `pendingNotes` -> Confirmar / Descartar -> `PATCH /api/delivery-armor/phone-notes`
 *   -> Broadcast instantáneo a todas las tabletas de la sucursal.
 *
 * @notes
 * - Creado 2026-11-24 a solicitud de Carlos para operar la alerta de condimentos/modificaciones de delivery en la
 *   tableta de llamado de clientes (`/inventory/preparador`) y `/order-ready-board` antes del despliegue de tabletas
 *   Delivery Armor.
 */

'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, PhoneCall, Utensils, Volume2, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { createClient } from '@/lib/supabase-client'
import { resolveCustomerStoreMeta } from '@/lib/customer-store-names'
import type { DeliveryArmorPhoneNote } from '@/lib/delivery-armor-phone-notes'
import type { DeliveryPlatform } from '@/lib/delivery-armor'

const STORE_ID_BY_CODE: Record<string, number> = {
  RIALTO: 1,
  WCOVINA: 3,
  AZUSA: 4,
  LABROADWY: 5,
  LABROADWAY: 5,
  LACENTRAL: 6,
  SLAUSON: 7,
  HOLLYWOOD: 8,
  SANTAANA: 9,
  LAPUENTE: 10,
  HPARK: 11,
  NORWALK: 12,
  BELL: 13,
  LYNWOOD: 14,
  SOUTHGATE: 15,
  DOWNEY: 16
}

/**
 * Sucursales que YA operan con tableta física dedicada de Delivery Armor.
 * En estas tiendas la alerta temporal del Preparador / Order Ready Board permanece apagada.
 * Al desplegar nuevas tabletas físicas en otras tiendas, basta agregar su `store_id` aquí.
 */
export const STORES_WITH_PHYSICAL_DELIVERY_ARMOR_TABLET = new Set<number>([
  7, // #7 Slauson (Los Ángeles - Slauson y Broadway)
  8  // #8 Hollywood
])

export function shouldShowTemporaryDeliveryPhoneAlertForStore(storeId: number | null | undefined): boolean {
  if (typeof storeId !== 'number' || !Number.isInteger(storeId) || storeId <= 0) return false
  return !STORES_WITH_PHYSICAL_DELIVERY_ARMOR_TABLET.has(storeId)
}

const POLL_INTERVAL_OPEN_MS = 20_000
const POLL_INTERVAL_CLOSED_MS = 120_000
const FETCH_TIMEOUT_MS = 6_000

function getAdaptivePollIntervalMs(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date())
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12') % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    const mins = h * 60 + m
    // Cerrado de 4:15 AM a 6:59 AM hora California
    if (mins >= 255 && mins < 420) return POLL_INTERVAL_CLOSED_MS
    return POLL_INTERVAL_OPEN_MS
  } catch {
    return POLL_INTERVAL_OPEN_MS
  }
}

function getPlatformMeta(platform: DeliveryPlatform | string): { label: string; badgeClass: string } {
  switch (platform) {
    case 'DOORDASH':
      return { label: 'DoorDash', badgeClass: 'bg-red-600 text-white' }
    case 'UBER_EATS':
      return { label: 'Uber Eats', badgeClass: 'bg-emerald-700 text-white' }
    case 'GRUBHUB':
      return { label: 'Grubhub', badgeClass: 'bg-orange-600 text-white' }
    case 'TOAST_ONLINE':
      return { label: 'Tacos Gavilan Online', badgeClass: 'bg-amber-700 text-white' }
    case 'TAKEOUT':
      return { label: 'Takeout', badgeClass: 'bg-slate-800 text-white' }
    default:
      return { label: 'Delivery', badgeClass: 'bg-slate-900 text-white' }
  }
}

export interface DeliveryPhoneNotesAlertPanelProps {
  /** ID numérico de la sucursal (usado en `/inventory/preparador`). */
  storeId?: number | null
  /** Código de sucursal ej. `'LYNWOOD'` (usado en `/order-ready-board`). */
  storeCode?: string | null
  /** Si es `false`, pausa red y Realtime hasta que la sucursal esté lista. */
  ready?: boolean
  /** Solo para vista previa de Administrador en `/order-ready-board`. */
  includeSimulator?: boolean
  /** Si `false` (ej. tablero silenciado), omite el timbre automático. */
  soundEnabled?: boolean
  /** Contexto visual y etiqueta de auditoría (`tablet` = `/inventory/preparador`, `board` = `/order-ready-board`). */
  variant?: 'tablet' | 'board'
}

export default function DeliveryPhoneNotesAlertPanel({
  storeId: storeIdProp = null,
  storeCode = null,
  ready = true,
  includeSimulator = false,
  soundEnabled = true,
  variant = 'tablet'
}: DeliveryPhoneNotesAlertPanelProps) {
  const { language, t } = useLanguage()

  const effectiveStoreId = useMemo<number | null>(() => {
    if (typeof storeIdProp === 'number' && Number.isInteger(storeIdProp) && storeIdProp > 0) {
      return storeIdProp
    }
    const normalizedCode = String(storeCode || '').trim().toUpperCase()
    if (!normalizedCode) return null
    return STORE_ID_BY_CODE[normalizedCode] || resolveCustomerStoreMeta(normalizedCode)?.id || null
  }, [storeIdProp, storeCode])

  const isStoreEligible = shouldShowTemporaryDeliveryPhoneAlertForStore(effectiveStoreId)
  const supabase = useMemo(() => createClient(), [])

  const [pendingNotes, setPendingNotes] = useState<DeliveryArmorPhoneNote[]>([])
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState<number>(() => Date.now())

  const audioCtxRef = useRef<AudioContext | null>(null)
  const pendingChimeRef = useRef<boolean>(false)
  const announcedIdsRef = useRef<Set<string>>(new Set())
  const initializedStoreRef = useRef<number | null>(null)
  const fetchAbortRef = useRef<AbortController | null>(null)
  const fetchSeqRef = useRef<number>(0)
  const toastTimerRef = useRef<number | null>(null)
  const soundEnabledRef = useRef<boolean>(soundEnabled)
  soundEnabledRef.current = soundEnabled
  const activeStoreIdRef = useRef<number | null>(effectiveStoreId)
  activeStoreIdRef.current = effectiveStoreId
  const activeIncludeSimRef = useRef<boolean>(includeSimulator)
  activeIncludeSimRef.current = includeSimulator

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
      'Content-Type': 'application/json',
      ...(token && token !== 'null' && token !== 'undefined'
        ? { Authorization: `Bearer ${token}` }
        : {})
    }
  }, [])

  // Timbre telefónico triple distintivo idéntico al de la tableta Delivery Armor (C6 + G6, 3 pulsos)
  const playPhoneNoteAlertChime = useCallback(async (forcePlay = false) => {
    if (!forcePlay && !soundEnabledRef.current) return
    try {
      if (typeof window === 'undefined') return
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx()
      }
      const ctx = audioCtxRef.current
      const st = String(ctx.state || '')
      if (st === 'suspended' || st === 'interrupted') {
        await ctx.resume().catch(() => {})
      }
      if (ctx.state !== 'running') {
        pendingChimeRef.current = true
        return
      }
      pendingChimeRef.current = false
      const now = ctx.currentTime + 0.03
      const master = ctx.createGain()
      master.gain.setValueAtTime(1.4, now)
      master.connect(ctx.destination)

      const pulses = [0, 0.24, 0.48]
      for (const offset of pulses) {
        const oscA = ctx.createOscillator()
        const oscB = ctx.createOscillator()
        const env = ctx.createGain()
        oscA.type = 'triangle'
        oscB.type = 'sine'
        oscA.frequency.setValueAtTime(1046.5, now + offset) // C6
        oscB.frequency.setValueAtTime(1567.98, now + offset) // G6
        env.gain.setValueAtTime(0.0001, now + offset)
        env.gain.linearRampToValueAtTime(0.55, now + offset + 0.015)
        env.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.19)
        oscA.connect(env)
        oscB.connect(env)
        env.connect(master)
        oscA.start(now + offset)
        oscB.start(now + offset)
        oscA.stop(now + offset + 0.21)
        oscB.stop(now + offset + 0.21)
      }
    } catch {
      // ignore audio context failures on restricted browsers
    }
  }, [])

  // Desbloqueo automático de audio al primer toque/clic si había un timbre pendiente por políticas de autoplay
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleUnlock = () => {
      if (pendingChimeRef.current && soundEnabledRef.current) {
        void playPhoneNoteAlertChime(false)
      }
    }
    window.addEventListener('pointerdown', handleUnlock, { passive: true })
    window.addEventListener('keydown', handleUnlock, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', handleUnlock)
      window.removeEventListener('keydown', handleUnlock)
    }
  }, [playPhoneNoteAlertChime])

  // Limpiar AudioContext y timers al desmontar
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      if (fetchAbortRef.current) fetchAbortRef.current.abort()
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {})
      }
    }
  }, [])

  // Actualizar contador de minutos transcurridos solo mientras existan alertas activas
  useEffect(() => {
    if (pendingNotes.length === 0) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [pendingNotes.length])

  const fetchNotes = useCallback(
    async (opts?: { force?: boolean }) => {
      const targetStoreId = effectiveStoreId
      const targetIncludeSim = includeSimulator
      if (!ready || !targetStoreId || !shouldShowTemporaryDeliveryPhoneAlertForStore(targetStoreId)) return
      if (!opts?.force && typeof document !== 'undefined' && document.visibilityState === 'hidden') return

      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort()
      }
      const ctrl = new AbortController()
      fetchAbortRef.current = ctrl
      const timeoutId = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      const seq = ++fetchSeqRef.current

      try {
        const simQuery = targetIncludeSim ? '&includeSimulator=1' : ''
        const res = await fetch(`/api/delivery-armor/phone-notes?storeId=${targetStoreId}${simQuery}`, {
          headers: getAuthHeaders(),
          credentials: 'include',
          cache: 'no-store',
          signal: ctrl.signal
        })
        if (!res.ok) {
          return
        }
        const data = await res.json().catch(() => null)
        if (
          activeStoreIdRef.current !== targetStoreId ||
          activeIncludeSimRef.current !== targetIncludeSim ||
          seq !== fetchSeqRef.current
        ) {
          return
        }
        const allNotes: DeliveryArmorPhoneNote[] = Array.isArray(data?.notes) ? data.notes : []
        const active = allNotes.filter((n) => n.status === 'pending' || n.status === 'acknowledged')

        const wasInitialized = initializedStoreRef.current === targetStoreId
        let hasNewAlert = false
        for (const n of active) {
          const alertKey = `${n.id}:${n.updatedAt}`
          if (!announcedIdsRef.current.has(alertKey)) {
            announcedIdsRef.current.add(alertKey)
            hasNewAlert = true
          }
        }
        initializedStoreRef.current = targetStoreId

        if (active.length === 0) {
          pendingChimeRef.current = false
        } else if (hasNewAlert || !wasInitialized) {
          void playPhoneNoteAlertChime(false)
        }

        setPendingNotes(active)
      } catch {
        // Silencioso en polling/abort para no ensuciar la tableta con errores transitorios de red
      } finally {
        window.clearTimeout(timeoutId)
      }
    },
    [effectiveStoreId, includeSimulator, ready, getAuthHeaders, playPhoneNoteAlertChime]
  )

  // Reiniciar memoria de alertas anunciadas al cambiar de tienda
  useEffect(() => {
    announcedIdsRef.current.clear()
    initializedStoreRef.current = null
    setPendingNotes([])
    setErrorMsg(null)
  }, [effectiveStoreId, includeSimulator])

  // Polling adaptativo + refresh instantáneo al volver visible o recuperar conexión
  useEffect(() => {
    if (!ready || !effectiveStoreId || !isStoreEligible) return
    let disposed = false
    let pollTimer: number | null = null

    const scheduleNext = () => {
      if (disposed) return
      pollTimer = window.setTimeout(() => {
        if (disposed) return
        void fetchNotes().finally(scheduleNext)
      }, getAdaptivePollIntervalMs())
    }

    void fetchNotes({ force: true }).finally(scheduleNext)

    const onVisibilityOrOnline = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchNotes({ force: true })
      }
    }
    window.addEventListener('visibilitychange', onVisibilityOrOnline)
    window.addEventListener('online', onVisibilityOrOnline)

    return () => {
      disposed = true
      if (pollTimer) window.clearTimeout(pollTimer)
      window.removeEventListener('visibilitychange', onVisibilityOrOnline)
      window.removeEventListener('online', onVisibilityOrOnline)
    }
  }, [ready, effectiveStoreId, isStoreEligible, fetchNotes])

  // Suscripción Supabase Realtime Broadcast (< 500 ms) idéntica a la tableta Delivery Armor
  useEffect(() => {
    if (!ready || !effectiveStoreId || !isStoreEligible) return
    let channelDisposed = false
    const channel = supabase
      .channel(`blindaje-delivery-phone-notes-${effectiveStoreId}`, {
        config: { broadcast: { self: false } }
      })
      .on('broadcast', { event: 'phone_note_alert' }, () => {
        if (channelDisposed) return
        void fetchNotes({ force: true })
      })
      .subscribe()

    return () => {
      channelDisposed = true
      void supabase.removeChannel(channel)
    }
  }, [ready, effectiveStoreId, isStoreEligible, supabase, fetchNotes])

  const showTransientToast = useCallback((msg: string) => {
    setToastMsg(msg)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null)
    }, 3500)
  }, [])

  const handleNoteAction = useCallback(
    async (note: DeliveryArmorPhoneNote, action: 'apply' | 'dismiss') => {
      if (!effectiveStoreId || busyNoteId) return
      setBusyNoteId(note.id)
      setErrorMsg(null)
      try {
        const res = await fetch('/api/delivery-armor/phone-notes', {
          method: 'PATCH',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            noteId: note.id,
            storeId: effectiveStoreId,
            action,
            clientSource: variant === 'board' ? 'order_ready_board' : 'preparador_tablet',
            matchedOrderGuid: note.toastOrderGuid || null,
            matchedDisplayNumber: note.toastDisplayNumber || null
          })
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || t('blindaje_delivery.phone_note_action_error'))
        }
        setPendingNotes((prev) => prev.filter((item) => item.id !== note.id))
        showTransientToast(
          action === 'apply'
            ? t('blindaje_delivery.phone_note_applied_toast')
            : t('blindaje_delivery.phone_note_closed_toast')
        )
      } catch (err: any) {
        setErrorMsg(err?.message || t('blindaje_delivery.phone_note_action_error'))
      } finally {
        setBusyNoteId(null)
      }
    },
    [effectiveStoreId, busyNoteId, getAuthHeaders, variant, t, showTransientToast]
  )

  const formatElapsed = useCallback(
    (iso: string): string => {
      const ms = Date.parse(iso)
      if (!Number.isFinite(ms)) return t('blindaje_delivery.phone_note_just_now')
      const mins = Math.max(0, Math.floor((nowTick - ms) / 60_000))
      if (mins < 1) return t('blindaje_delivery.phone_note_just_now')
      return t('blindaje_delivery.phone_note_minutes_ago').replace('{min}', String(mins))
    },
    [nowTick, t]
  )

  // En sucursales que ya tienen tableta física de Delivery Armor (#7 Slauson, #8 Hollywood), no mostrar alerta temporal
  if (!isStoreEligible) {
    return null
  }

  // Si no hay alertas activas ni toast de confirmación breve, ocupar exactamente 0 px
  if (pendingNotes.length === 0) {
    if (!toastMsg) return null
    return (
      <div
        data-no-proximity="true"
        className="px-3 sm:px-4 py-2 bg-emerald-600 text-white text-sm font-black flex items-center justify-center gap-2 shadow-md shrink-0 z-30"
      >
        <CheckCircle2 className="w-5 h-5 shrink-0" />
        <span>{toastMsg}</span>
      </div>
    )
  }

  const isRedTabletTheme = variant === 'tablet'

  return (
    <section
      data-no-proximity="true"
      aria-live="assertive"
      className={`shrink-0 z-30 ${
        isRedTabletTheme
          ? 'px-2.5 sm:px-4 py-2.5 bg-red-700 dark:bg-red-950 border-b-4 border-red-900 max-h-[46vh] overflow-y-auto'
          : 'px-3 sm:px-5 py-3 bg-amber-100/90 dark:bg-amber-950/70 border-b-4 border-amber-500'
      }`}
    >
      <div
        className={`rounded-2xl sm:rounded-3xl border-4 p-3 sm:p-4 shadow-xl space-y-3 ${
          isRedTabletTheme
            ? 'border-red-300 bg-red-600 da-phone-alert-blink-red'
            : 'border-amber-500 bg-amber-50 da-phone-alert-blink'
        }`}
      >
        {/* Cabecera parpadeante (rojo intenso en tableta Preparador / ámbar-rojo en tablero) */}
        <div className="flex items-center justify-between gap-2.5 flex-wrap">
          <div className={`flex items-center gap-2.5 min-w-0 ${isRedTabletTheme ? 'text-white' : 'text-red-700'}`}>
            <BellRing className="w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0 animate-bounce" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-xl font-black uppercase tracking-tight leading-tight">
                  {t('blindaje_delivery.phone_note_banner_title')} ({pendingNotes.length})
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wide ${
                    isRedTabletTheme
                      ? 'bg-red-950/75 border border-red-200/70 text-red-50'
                      : 'bg-amber-200 border border-amber-400 text-amber-950'
                  }`}
                >
                  {t('blindaje_delivery.phone_note_temp_badge')}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void playPhoneNoteAlertChime(true)}
            title={t('blindaje_delivery.phone_note_replay_sound_tooltip')}
            className={`px-3 py-2 rounded-xl active:scale-95 text-xs font-black flex items-center gap-1.5 border shadow-xs cursor-pointer touch-manipulation ${
              isRedTabletTheme
                ? 'bg-white/20 hover:bg-white/30 text-white border-white/50'
                : 'bg-amber-200 hover:bg-amber-300 text-amber-950 border-amber-400'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            <span>🔊</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-red-950 border border-red-300 text-white text-xs sm:text-sm font-black flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Tarjetas individuales de alertas activas */}
        <div className="space-y-2.5">
          {pendingNotes.map((note) => {
            const plat = getPlatformMeta(note.platform)
            const customerDisplay = note.orderCustomerName || note.callerName
            const summaryText =
              language === 'en' && note.noteSummaryEn ? note.noteSummaryEn : note.noteSummaryEs
            const isReopenBag = note.orderStageAtAlert === 'PACKED_AND_SEALED'
            const isUnmatched = note.matchStatus === 'UNMATCHED'
            const isBusy = busyNoteId === note.id

            return (
              <div
                key={note.id}
                className={`relative rounded-2xl bg-white border-2 p-3 sm:p-4 shadow-md space-y-2.5 text-slate-950 ${
                  isRedTabletTheme ? 'border-red-400 ring-2 ring-red-200/80' : 'border-amber-400'
                }`}
              >
                {/* Alerta roja prioritaria si la bolsa ya estaba sellada */}
                {isReopenBag && (
                  <div className="p-2.5 sm:p-3 rounded-xl bg-red-700 text-white text-xs sm:text-sm font-black flex items-center gap-2 shadow-sm">
                    <AlertTriangle className="w-5 h-5 shrink-0 animate-pulse" />
                    <span>{t('blindaje_delivery.phone_note_detail_reopen_warn')}</span>
                  </div>
                )}

                {/* Identidad de la orden (Plataforma + Cliente + Código/Check + Estado + Tiempo + Ícono Cerrar estilo Preparador) */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                    <span className={`px-2.5 py-1 rounded-lg text-xs sm:text-sm font-black tracking-tight ${plat.badgeClass}`}>
                      {plat.label}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-lg sm:text-2xl font-black text-slate-950 leading-none">
                      <PhoneCall
                        className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${
                          isRedTabletTheme ? 'text-red-600' : 'text-amber-600'
                        }`}
                      />
                      <span>{customerDisplay}</span>
                    </span>
                    {note.shortOrderKey && (
                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-xs sm:text-sm font-mono font-black ${
                          isRedTabletTheme
                            ? 'bg-red-100 border border-red-400 text-red-950'
                            : 'bg-amber-100 border border-amber-400 text-amber-950'
                        }`}
                      >
                        {note.shortOrderKey}
                      </span>
                    )}
                    {note.toastDisplayNumber && (
                      <span className="px-2.5 py-0.5 rounded-lg bg-slate-900 text-white text-xs sm:text-sm font-mono font-black">
                        Check #{note.toastDisplayNumber}
                      </span>
                    )}
                    {isReopenBag ? (
                      <span className="px-2.5 py-0.5 rounded-lg bg-red-600 text-white text-xs font-black uppercase">
                        {t('blindaje_delivery.phone_note_reopen_bag_badge')}
                      </span>
                    ) : isUnmatched ? (
                      <span className="px-2.5 py-0.5 rounded-lg bg-red-100 border border-red-300 text-red-800 text-xs font-black uppercase">
                        {t('blindaje_delivery.phone_note_unmatched_tag')}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-black uppercase">
                        {t('blindaje_delivery.phone_note_active_order_tag')}
                      </span>
                    )}
                    {note.source === 'simulator' && (
                      <span className="px-2 py-0.5 rounded-lg bg-purple-100 border border-purple-300 text-purple-900 text-[11px] font-black uppercase">
                        {t('blindaje_delivery.phone_note_simulator_tag')}
                      </span>
                    )}
                  </div>

                  {/* Tiempo + Botón circular rojo de cerrar (✕) replicado de la tableta Preparador */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-slate-500">
                      {formatElapsed(note.updatedAt || note.createdAt)}
                    </span>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleNoteAction(note, 'dismiss')}
                      title={t('blindaje_delivery.phone_note_close_order_btn')}
                      aria-label={t('blindaje_delivery.phone_note_close_order_btn')}
                      className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 text-white border-2 border-white shadow-md transition-all disabled:opacity-40 cursor-pointer select-none touch-manipulation flex items-center justify-center shrink-0"
                    >
                      <X className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={3.5} />
                    </button>
                  </div>
                </div>

                {/* Resumen legible en tamaño grande */}
                <p className="text-base sm:text-xl font-black text-red-900 leading-snug">
                  {summaryText}
                </p>

                {/* Chips de Condimentos Gratuitos y Modificaciones Sin Costo */}
                {(note.requestedCondiments.length > 0 || note.itemModifications.length > 0) && (
                  <div className="flex flex-wrap gap-3 pt-0.5">
                    {note.requestedCondiments.length > 0 && (
                      <div className="space-y-1">
                        <div
                          className={`text-[11px] font-black uppercase tracking-wider ${
                            isRedTabletTheme ? 'text-red-700' : 'text-amber-800'
                          }`}
                        >
                          {t('blindaje_delivery.phone_note_condiments_label')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {note.requestedCondiments.map((c, idx) => (
                            <span
                              key={idx}
                              className={`px-2.5 py-1 rounded-xl text-xs sm:text-sm font-black ${
                                isRedTabletTheme
                                  ? 'bg-red-50 border-2 border-red-400 text-red-950'
                                  : 'bg-amber-100 border border-amber-400 text-amber-950'
                              }`}
                            >
                              + {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {note.itemModifications.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-black uppercase tracking-wider text-red-700">
                          {t('blindaje_delivery.phone_note_modifications_label')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {note.itemModifications.map((m, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-xl bg-red-100 border border-red-400 text-red-950 text-xs sm:text-sm font-black"
                            >
                              ✏️ {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Referencia rápida de platillos en la orden (cuando Toast emparejó la orden o el cliente los dictó) */}
                {note.orderedItemsHint && (
                  <div className="pt-2 border-t border-slate-200 flex items-start gap-2 text-xs sm:text-sm text-slate-700">
                    <Utensils className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-black uppercase text-[11px] tracking-wider text-slate-500 mr-1.5">
                        {t('blindaje_delivery.phone_note_order_items_label')}:
                      </span>
                      <span className="font-bold text-slate-900">{note.orderedItemsHint}</span>
                    </div>
                  </div>
                )}

                {/* Botón principal grande apto para guantes (el botón circular ✕ de cierre individual está arriba a la derecha) */}
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleNoteAction(note, 'apply')}
                    className="w-full min-h-[48px] sm:min-h-[54px] px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-sm sm:text-lg font-black disabled:opacity-40 shadow-md transition-transform cursor-pointer select-none touch-manipulation flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                    <span>
                      {isBusy
                        ? t('blindaje_delivery.phone_note_applying_btn')
                        : t('blindaje_delivery.phone_note_apply_btn')}
                    </span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
