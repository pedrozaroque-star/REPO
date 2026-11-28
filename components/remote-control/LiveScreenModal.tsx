/**
 * @module components/remote-control/LiveScreenModal
 * @description Visor e Interfaz de Control Remoto de Pantalla 100% nativo dentro de SM TEG (`/admin/control-remoto`).
 *              Recibe cuadros JPEG efímeros en RAM vía Supabase Realtime Broadcast (cero blobs en Postgres/Storage)
 *              y permite hacer clic izquierdo, doble clic, clic derecho, scroll, escribir texto y enviar atajos
 *              de teclado (`F5`, `F11`, `Ctrl+R`, `Alt+Tab`, `Win+D`) en cualquier PC Windows de las 15 sucursales.
 *
 * @businessRules
 * - Solo transmite mientras el modal está abierto (keepalive cada 18s; al cerrar dispara `DELETE /api/remote-control/screen-session`).
 * - Detecta si el agente en la tienda corre una versión anterior a `REMOTE_AGENT_LATEST_VERSION` (`1.1.0`) y ofrece
 *   botón directo de 1 clic para actualizar el agente remotamente sin ir físicamente a la tienda.
 * - Incluye enlace secundario a Action1 (60 FPS) para casos de pantalla bloqueada de Windows o transferencias pesadas.
 * - 100% bilingüe (ES/EN) mediante `useLanguage()` (`remoteControl.live_screen_*`).
 *
 * @dataFlow
 * - `LiveScreenModal` -> `POST/PATCH/DELETE /api/remote-control/screen-session`
 * - Supabase Realtime Broadcast (`teg-remote-screen-${deviceId}-${sessionId}`) -> `screen_frame` -> `<img>` interactivo.
 */

'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  AlertTriangle,
  CornerDownLeft,
  ExternalLink,
  Eye,
  Keyboard,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  RefreshCw,
  Send,
  Volume2,
  X,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
  REMOTE_AGENT_LATEST_VERSION,
  type RemoteScreenHotkey,
  type RemoteScreenInputEvent,
} from '@/lib/remote-control'
import type { FleetDeviceUI } from '@/components/remote-control/RemoteControlModals'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface FrameState {
  dataUrl: string
  frameSeq: number
  origWidth: number
  origHeight: number
  sentWidth: number
  sentHeight: number
  byteSize: number
  capturedAt: string
}

interface ClickRipple {
  id: number
  xPct: number
  yPct: number
  button: 'left' | 'right' | 'dbl'
}

type QualityPreset = 'fast' | 'std' | 'hd'

const QUALITY_PRESETS: Record<QualityPreset, { maxWidth: number; quality: number }> = {
  fast: { maxWidth: 960, quality: 45 },
  std: { maxWidth: 1280, quality: 55 },
  hd: { maxWidth: 1600, quality: 68 },
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('teg_token')
    if (token && token !== 'null' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`
    }
  }
  return headers
}

function isAgentBelowLiveScreen(ver: string | null | undefined): boolean {
  if (!ver) return false
  const parts = ver.split('.').map((n) => parseInt(n, 10) || 0)
  const major = parts[0] || 0
  const minor = parts[1] || 0
  return major < 1 || (major === 1 && minor < 1)
}

export default function LiveScreenModal({
  device,
  onClose,
  onSendQuickCommand,
  notify,
}: {
  device: FleetDeviceUI | null
  onClose: () => void
  onSendQuickCommand: (device: FleetDeviceUI, commandType: string, payload?: Record<string, any>) => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useLanguage()
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [frame, setFrame] = useState<FrameState | null>(null)
  const [controlEnabled, setControlEnabled] = useState(true)
  const [preset, setPreset] = useState<QualityPreset>('std')
  const [textInput, setTextInput] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [ripples, setRipples] = useState<ClickRipple[]>([])
  const [upgrading, setUpgrading] = useState(false)
  const [reconnectCounter, setReconnectCounter] = useState(0)

  const sessionIdRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rippleIdRef = useRef(0)

  const closeRemoteSession = useCallback((sid: string | null) => {
    if (!sid) return
    try {
      fetch(`/api/remote-control/screen-session?sessionId=${encodeURIComponent(sid)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'include',
        keepalive: true,
      }).catch(() => {})
    } catch {}
  }, [])

  const sendInputEvent = useCallback(
    async (event: RemoteScreenInputEvent) => {
      const sid = sessionIdRef.current
      if (!sid) return
      try {
        await fetch('/api/remote-control/screen-session', {
          method: 'PATCH',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({ sessionId: sid, event }),
        })
      } catch {
        // non-blocking
      }
    },
    []
  )

  useEffect(() => {
    if (!device) return
    let disposed = false
    let rtClient: ReturnType<typeof createClient> | null = null
    let rtChannel: any = null
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null

    setStatus('connecting')
    setErrorMsg(null)
    setFrame(null)
    setSessionId(null)
    sessionIdRef.current = null

    const startSession = async () => {
      try {
        const cfg = QUALITY_PRESETS[preset]
        const res = await fetch('/api/remote-control/screen-session', {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            deviceId: device.id,
            quality: cfg.quality,
            maxWidth: cfg.maxWidth,
          }),
        })
        const data = await res.json().catch(() => null)
        if (disposed) {
          if (data?.session?.id) closeRemoteSession(data.session.id)
          return
        }
        if (!res.ok || !data?.success || !data?.session?.id) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }

        const sid = String(data.session.id)
        const topic = String(data.broadcastTopic)
        setSessionId(sid)
        sessionIdRef.current = sid

        if (supabaseUrl && supabaseAnonKey) {
          rtClient = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
          rtChannel = rtClient
            .channel(topic)
            .on('broadcast', { event: 'screen_frame' }, (msg: any) => {
              if (disposed) return
              const p = msg?.payload
              if (!p || p.sessionId !== sid || typeof p.imageBase64 !== 'string') return
              setFrame({
                dataUrl: `data:image/jpeg;base64,${p.imageBase64}`,
                frameSeq: Number(p.frameSeq) || 1,
                origWidth: Number(p.origWidth) || 1920,
                origHeight: Number(p.origHeight) || 1080,
                sentWidth: Number(p.sentWidth) || 1280,
                sentHeight: Number(p.sentHeight) || 720,
                byteSize: Number(p.byteSize) || 0,
                capturedAt: String(p.capturedAt || new Date().toISOString()),
              })
              setStatus('live')
            })
            .subscribe()
        }

        // Keepalive cada 18s para mantener la transmisión activa mientras el modal sigue abierto
        keepaliveTimer = setInterval(() => {
          if (disposed || !sessionIdRef.current) return
          fetch('/api/remote-control/screen-session', {
            method: 'PATCH',
            headers: getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({ sessionId: sessionIdRef.current }),
          }).catch(() => {})
        }, 18_000)
      } catch (err: any) {
        if (!disposed) {
          setStatus('error')
          setErrorMsg(err?.message || 'Error starting live screen session')
        }
      }
    }

    void startSession()

    const onBeforeUnload = () => closeRemoteSession(sessionIdRef.current)
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      disposed = true
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (keepaliveTimer) clearInterval(keepaliveTimer)
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      const activeSid = sessionIdRef.current
      sessionIdRef.current = null
      closeRemoteSession(activeSid)
      if (rtClient && rtChannel) {
        try {
          void rtClient.removeChannel(rtChannel)
        } catch {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id, reconnectCounter])

  const handleQualityChange = async (nextPreset: QualityPreset) => {
    setPreset(nextPreset)
    const sid = sessionIdRef.current
    if (!sid) return
    const cfg = QUALITY_PRESETS[nextPreset]
    try {
      await fetch('/api/remote-control/screen-session', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          sessionId: sid,
          quality: cfg.quality,
          maxWidth: cfg.maxWidth,
        }),
      })
    } catch {}
  }

  const pushRipple = (xPct: number, yPct: number, button: 'left' | 'right' | 'dbl') => {
    const id = ++rippleIdRef.current
    setRipples((prev) => [...prev.slice(-5), { id, xPct, yPct, button }])
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id))
    }, 650)
  }

  const computeCoords = (e: React.MouseEvent<HTMLImageElement>): { xPct: number; yPct: number } | null => {
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    return { xPct, yPct }
  }

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!controlEnabled) return
    const coords = computeCoords(e)
    if (!coords) return
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      pushRipple(coords.xPct, coords.yPct, 'left')
      void sendInputEvent({ type: 'click', button: 'left', xPct: coords.xPct, yPct: coords.yPct })
    }, 170)
  }

  const handleImageDoubleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!controlEnabled) return
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    const coords = computeCoords(e)
    if (!coords) return
    pushRipple(coords.xPct, coords.yPct, 'dbl')
    void sendInputEvent({ type: 'dblclick', xPct: coords.xPct, yPct: coords.yPct })
  }

  const handleImageContextMenu = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault()
    if (!controlEnabled) return
    const coords = computeCoords(e)
    if (!coords) return
    pushRipple(coords.xPct, coords.yPct, 'right')
    void sendInputEvent({ type: 'click', button: 'right', xPct: coords.xPct, yPct: coords.yPct })
  }

  const handleImageWheel = (e: React.WheelEvent<HTMLImageElement>) => {
    if (!controlEnabled) return
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const delta = e.deltaY > 0 ? -240 : 240
    void sendInputEvent({ type: 'scroll', xPct, yPct, delta })
  }

  const handleSendText = async (withEnter: boolean) => {
    const clean = textInput
    if (!clean) return
    setTextInput('')
    await sendInputEvent({ type: 'type', text: clean })
    if (withEnter) {
      await sendInputEvent({ type: 'hotkey', key: 'enter' })
    }
  }

  const handleHotkey = (key: RemoteScreenHotkey) => {
    void sendInputEvent({ type: 'hotkey', key })
  }

  const handleToggleFullscreen = async () => {
    const el = containerRef.current as any
    if (!el) return
    try {
      if (!document.fullscreenElement) {
        await (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen?.()
        setIsFullscreen(false)
      }
    } catch {}
  }

  const handleUpgradeAgent = async () => {
    if (!device) return
    setUpgrading(true)
    try {
      await onSendQuickCommand(device, 'update_agent')
      notify(t('remoteControl.live_screen_upgrade_sent'), 'success')
    } finally {
      setUpgrading(false)
    }
  }

  if (!device) return null

  const outdated = isAgentBelowLiveScreen(device.agent_version)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-2 sm:p-4">
      <div
        ref={containerRef}
        className="w-full max-w-[1440px] h-[94vh] rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl flex flex-col overflow-hidden text-white"
      >
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
              <Monitor className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black truncate">{device.display_name}</h2>
                {status === 'live' ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold shrink-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    {t('remoteControl.live_screen_connected')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold shrink-0">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    {t('remoteControl.live_screen_connecting')}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {t('remoteControl.live_screen_title')}
                {frame
                  ? ` • ${frame.origWidth}×${frame.origHeight} • ${Math.round(frame.byteSize / 1024)} KB • ${frame.frameSeq} ${t('remoteControl.live_screen_frames')}`
                  : sessionId
                    ? ` • ${device.telemetry?.hostname || device.store_code}`
                    : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Control vs View Only toggle */}
            <button
              type="button"
              onClick={() => setControlEnabled((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                controlEnabled
                  ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              {controlEnabled ? (
                <MousePointerClick className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span>
                {controlEnabled
                  ? t('remoteControl.live_screen_mode_control')
                  : t('remoteControl.live_screen_mode_view')}
              </span>
            </button>

            {/* Quality preset */}
            <select
              value={preset}
              onChange={(e) => void handleQualityChange(e.target.value as QualityPreset)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200"
            >
              <option value="fast">{t('remoteControl.live_screen_quality_fast')}</option>
              <option value="std">{t('remoteControl.live_screen_quality_std')}</option>
              <option value="hd">{t('remoteControl.live_screen_quality_hd')}</option>
            </select>

            <button
              type="button"
              onClick={() => setReconnectCounter((c) => c + 1)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('remoteControl.live_screen_reconnect')}</span>
            </button>

            {device.remote_tool_url && (
              <a
                href={device.remote_tool_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-sky-300"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t('remoteControl.btn_open_action1')}</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title="Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>{t('remoteControl.live_screen_close_session')}</span>
            </button>
          </div>
        </div>

        {/* Banner si el agente en la tienda aún está en v1.0.0 */}
        {outdated && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-amber-500/15 border-b border-amber-500/40 text-amber-200 text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {t('remoteControl.live_screen_outdated_banner')
                  .replace('{cur}', device.agent_version || '1.0.0')
                  .replace('{latest}', REMOTE_AGENT_LATEST_VERSION)}
              </span>
            </div>
            <button
              type="button"
              disabled={upgrading}
              onClick={() => void handleUpgradeAgent()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${upgrading ? 'animate-spin' : ''}`} />
              <span>{t('remoteControl.live_screen_outdated_btn')}</span>
            </button>
          </div>
        )}

        {/* Viewport de Pantalla */}
        <div className="flex-1 min-h-0 bg-black flex items-center justify-center relative overflow-hidden p-2 select-none">
          {errorMsg ? (
            <div className="text-center max-w-md space-y-3 p-6">
              <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-sm font-bold text-red-300">{errorMsg}</p>
              <button
                type="button"
                onClick={() => setReconnectCounter((c) => c + 1)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white cursor-pointer"
              >
                {t('remoteControl.live_screen_reconnect')}
              </button>
            </div>
          ) : !frame ? (
            <div className="text-center max-w-md space-y-3 p-6">
              <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mx-auto" />
              <p className="text-base font-black text-white">
                {t('remoteControl.live_screen_connecting')}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                {t('remoteControl.live_screen_connecting_hint')}
              </p>
            </div>
          ) : (
            <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={frame.dataUrl}
                alt={device.display_name}
                draggable={false}
                onClick={handleImageClick}
                onDoubleClick={handleImageDoubleClick}
                onContextMenu={handleImageContextMenu}
                onWheel={handleImageWheel}
                className={`max-w-full max-h-[calc(94vh-190px)] w-auto h-auto object-contain rounded-lg border border-slate-800 shadow-2xl ${
                  controlEnabled ? 'cursor-crosshair' : 'cursor-default'
                }`}
              />

              {/* Pulsos visuales donde hiciste clic */}
              {ripples.map((r) => (
                <span
                  key={r.id}
                  style={{ left: `${r.xPct * 100}%`, top: `${r.yPct * 100}%` }}
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-2 animate-ping ${
                    r.button === 'right'
                      ? 'border-amber-400 bg-amber-400/20'
                      : r.button === 'dbl'
                        ? 'border-emerald-400 bg-emerald-400/20'
                        : 'border-sky-400 bg-sky-400/20'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Barra Inferior: Teclado + Atajos Rápidos */}
        <div className="px-4 py-3 bg-slate-900 border-t border-slate-800 space-y-2.5 shrink-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Keyboard className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSendText(true)
                  }
                }}
                placeholder={t('remoteControl.live_screen_type_placeholder')}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleSendText(false)}
                disabled={!textInput}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t('remoteControl.live_screen_send_text')}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSendText(true)}
                disabled={!textInput}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                <CornerDownLeft className="w-3.5 h-3.5" />
                <span>{t('remoteControl.live_screen_send_enter')}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { k: 'enter', label: 'Enter' },
                  { k: 'escape', label: 'Esc' },
                  { k: 'backspace', label: 'Backspace' },
                  { k: 'f5', label: 'F5' },
                  { k: 'f11', label: 'F11' },
                  { k: 'ctrl_r', label: 'Ctrl+R' },
                  { k: 'alt_tab', label: 'Alt+Tab' },
                  { k: 'win_d', label: 'Win+D' },
                ] as Array<{ k: RemoteScreenHotkey; label: string }>
              ).map((item) => (
                <button
                  key={item.k}
                  type="button"
                  onClick={() => handleHotkey(item.k)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-mono font-bold text-slate-200 cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void onSendQuickCommand(device, 'unmute_audio')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[11px] font-bold text-indigo-200 cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>{t('remoteControl.btn_unmute')}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              {t('remoteControl.live_screen_click_hint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
