/**
 * @module components/PhoneCallbackAlertBanner
 * @description Banner en tiempo real de Recados Telefónicos Prioritarios (`phone_callback_requests`)
 * para la pantalla de la PC del Manager (`/order-ready-board`).
 *
 * @businessRules
 * - Cuando la Contestadora IA registra una urgencia REAL de Twilio (`source = 'twilio'`) en una sucursal
 *   (cliente reportando comida faltante, objeto olvidado, empleado reportando retardo/falta o proveedor en puerta),
 *   este componente muestra una alerta visual inmediata con aviso acústico suave en la PC del Manager de esa sucursal.
 * - Las pruebas realizadas desde el Simulador Web (`source = 'simulator'`) quedan estrictamente aisladas en el backend
 *   y NUNCA activan alertas rojas en la pantalla operativa de la tienda.
 * - Espera a `ready === true` antes de consultar al servidor para evitar fugas fugaces de tienda por defecto antes de
 *   resolver `/api/order-ready/my-stores`.
 * - Permite al gerente agregar una nota opcional de seguimiento y marcar el recado como "Atendido" validando `res.ok`.
 *
 * @dataFlow
 * - Polling autenticado cada 6s (`GET /api/phone/dashboard?callbacksOnly=true&storeId=X&status=pending`) con soporte
 *   tanto de JWT (`teg_token`) como de cookie 24/7 (`teg_order_ready_session`), más listeners `visibilitychange` y `online`
 *   -> Renderiza banner -> `PATCH /api/phone/dashboard` (`entity: 'callback_request'`, `status: 'resolved'`).
 *
 * @notes
 * - Con RLS estricto activo en `phone_callback_requests` (para proteger PII de clientes), la sincronización se realiza
 *   vía endpoint autenticado en vez de canal `anon` de Supabase Realtime.
 * - 100% bilingüe mediante `useLanguage()` (`t('phone_agent.*')`).
 */

'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import { PhoneCall, CheckCircle2, AlertTriangle } from 'lucide-react'

const STORE_ID_BY_CODE: Record<string, number> = {
  RIALTO: 1,
  WCOVINA: 3,
  AZUSA: 4,
  LABROADWY: 5,
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

interface CallbackAlert {
  id: string
  store_id: number
  source?: string
  caller_name: string
  caller_phone: string
  caller_type: string
  urgency: string
  reason_category: string
  reason_summary: string
  ticket_or_order_number: string | null
  created_at: string
}

const POLL_INTERVAL_MS = 6000

export default function PhoneCallbackAlertBanner({
  storeCode,
  ready = true
}: {
  storeCode: string
  ready?: boolean
}) {
  const { t } = useLanguage()
  const normalizedCode = String(storeCode || '').trim().toUpperCase()
  const storeId = STORE_ID_BY_CODE[normalizedCode] || null

  const [pendingCallbacks, setPendingCallbacks] = useState<CallbackAlert[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [notesById, setNotesById] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetchAbortRef = useRef<AbortController | null>(null)
  const fetchSeqRef = useRef(0)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const initializedStoreRef = useRef<number | null>(null)
  const activeStoreIdRef = useRef<number | null>(storeId)
  activeStoreIdRef.current = storeId

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }, [])

  const playCallbackChime = useCallback(() => {
    try {
      if (typeof window === 'undefined') return
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const playTone = (freq: number, startOffset: number, duration: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.12, ctx.currentTime + startOffset)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(ctx.currentTime + startOffset)
        osc.stop(ctx.currentTime + startOffset + duration)
      }
      playTone(880, 0, 0.18)
      playTone(1174.66, 0.2, 0.24)
      setTimeout(() => {
        ctx.close().catch(() => {})
      }, 800)
    } catch {
      // Silencioso si el navegador aún no desbloquea AudioContext
    }
  }, [])

  const fetchPending = useCallback(async () => {
    const targetStoreId = storeId
    if (!ready || !targetStoreId) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort()
    }
    const ctrl = new AbortController()
    fetchAbortRef.current = ctrl
    const seq = ++fetchSeqRef.current

    try {
      const res = await fetch(
        `/api/phone/dashboard?callbacksOnly=true&storeId=${targetStoreId}&status=pending`,
        {
          headers: getAuthHeaders(),
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ctrl.signal
        }
      )
      if (!res.ok) return
      const data = await res.json()
      if (activeStoreIdRef.current !== targetStoreId || seq !== fetchSeqRef.current) return

      const list: CallbackAlert[] = Array.isArray(data.callbacks) ? data.callbacks : []

      let hasBrandNew = false
      const wasInitializedForStore = initializedStoreRef.current === targetStoreId
      for (const item of list) {
        if (!seenIdsRef.current.has(item.id)) {
          seenIdsRef.current.add(item.id)
          if (wasInitializedForStore) {
            hasBrandNew = true
          }
        }
      }
      initializedStoreRef.current = targetStoreId

      if (hasBrandNew) {
        playCallbackChime()
      }

      setPendingCallbacks(list)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      // Ignorar intermitencias de red temporales
    }
  }, [ready, storeId, getAuthHeaders, playCallbackChime])

  // Limpiar estado y abortar polling previo al cambiar de tienda o mientras `ready` sea falso
  useEffect(() => {
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort()
      fetchAbortRef.current = null
    }
    fetchSeqRef.current += 1
    setPendingCallbacks([])
    setErrorMsg(null)
    seenIdsRef.current.clear()
    initializedStoreRef.current = null
    return () => {
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort()
        fetchAbortRef.current = null
      }
    }
  }, [storeId, ready])

  // Polling autenticado cada 6s + recarga inmediata al volver a la pestaña o recuperar red
  useEffect(() => {
    if (!ready || !storeId) return

    void fetchPending()
    const interval = setInterval(() => {
      void fetchPending()
    }, POLL_INTERVAL_MS)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchPending()
      }
    }
    const handleOnline = () => {
      void fetchPending()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
    }
  }, [ready, storeId, fetchPending])

  const getCallerTypeLabel = (callerType: string): string => {
    const norm = String(callerType || '').toLowerCase()
    if (norm === 'employee') return t('phone_agent.caller_type_employee')
    if (norm === 'vendor') return t('phone_agent.caller_type_vendor')
    if (norm === 'delivery_driver') return t('phone_agent.caller_type_driver')
    if (norm === 'corporate') return t('phone_agent.caller_type_corporate')
    return t('phone_agent.caller_type_customer')
  }

  const getUrgencyLabel = (urgency: string): string => {
    const norm = String(urgency || '').toLowerCase()
    if (norm === 'critical') return t('phone_agent.urgency_critical')
    if (norm === 'urgent') return t('phone_agent.urgency_urgent')
    if (norm === 'high') return t('phone_agent.urgency_high')
    return t('phone_agent.urgency_normal')
  }

  const handleResolve = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (resolvingId) return
    setResolvingId(id)
    setErrorMsg(null)
    try {
      const note = (notesById[id] || '').trim()
      const res = await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({
          entity: 'callback_request',
          id,
          status: 'resolved',
          ...(note ? { resolution_notes: note } : {})
        })
      })
      if (!res.ok) {
        setErrorMsg(t('phone_agent.banner_resolve_error'))
        return
      }
      setPendingCallbacks((prev) => prev.filter((c) => c.id !== id))
      setNotesById((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch {
      setErrorMsg(t('phone_agent.banner_resolve_error'))
    } finally {
      setResolvingId(null)
    }
  }

  if (!ready || !storeId || pendingCallbacks.length === 0) return null

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="bg-rose-600 text-white px-4 py-2.5 border-b border-rose-700 shadow-md z-40"
    >
      <div className="max-w-7xl mx-auto flex flex-col gap-2">
        {errorMsg && (
          <div className="flex items-center gap-2 bg-rose-900/80 border border-rose-300/40 rounded-lg px-3 py-1.5 text-xs font-bold">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {pendingCallbacks.map((cb) => (
          <div
            key={cb.id}
            className="flex flex-wrap items-center justify-between gap-3 bg-rose-700/60 rounded-xl px-3.5 py-2 border border-rose-400/40"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="p-1.5 rounded-lg bg-white text-rose-600 animate-pulse shrink-0">
                <PhoneCall size={16} />
              </span>
              <div className="text-xs sm:text-sm leading-snug">
                <span className="font-black uppercase tracking-wide mr-2">
                  🔔 {t('phone_agent.banner_priority_label')}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-black uppercase mr-2">
                  {getCallerTypeLabel(cb.caller_type)} • {getUrgencyLabel(cb.urgency)}
                </span>
                <span className="font-extrabold">
                  {cb.caller_name} ({cb.caller_phone})
                </span>
                <span className="mx-1.5 opacity-75">•</span>
                <span className="font-medium">{cb.reason_summary}</span>
                {cb.ticket_or_order_number && (
                  <span className="ml-2 px-2 py-0.5 rounded bg-white/20 text-[11px] font-bold">
                    {t('phone_agent.banner_ticket_prefix')} {cb.ticket_or_order_number}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                value={notesById[cb.id] || ''}
                onChange={(e) =>
                  setNotesById((prev) => ({ ...prev, [cb.id]: e.target.value.slice(0, 200) }))
                }
                placeholder={t('phone_agent.banner_note_placeholder')}
                className="hidden md:block w-44 px-2.5 py-1.5 rounded-lg bg-rose-900/50 border border-rose-300/40 text-white placeholder-rose-200/75 text-xs focus:outline-none focus:border-white"
              />
              <button
                type="button"
                disabled={resolvingId === cb.id}
                onClick={(e) => handleResolve(cb.id, e)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-60 text-xs font-black shadow-sm transition shrink-0"
              >
                <CheckCircle2 size={14} />
                {t('phone_agent.callbacks_mark_resolved')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
