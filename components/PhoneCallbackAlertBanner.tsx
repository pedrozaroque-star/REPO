/**
 * @module components/PhoneCallbackAlertBanner
 * @description Banner en tiempo real de Recados Telefónicos Prioritarios (`phone_callback_requests`)
 * para la pantalla de la PC del Manager (`/order-ready-board`).
 *
 * @businessRules
 * - Cuando la Contestadora IA registra una urgencia en una sucursal (cliente reportando comida faltante,
 *   objeto olvidado, empleado reportando retardo/falta o proveedor en puerta), este componente muestra
 *   una alerta visual inmediata en la PC del Manager de esa sucursal.
 * - Permite al gerente marcar el recado como "Atendido" con un solo clic.
 *
 * @dataFlow
 * - `/api/phone/dashboard?callbacksOnly=true&storeId=X&status=pending` + Supabase Realtime (`phone_callback_requests`)
 *   -> Renderiza banner -> `PATCH /api/phone/dashboard` (`status = 'resolved'`).
 *
 * @notes
 * - Totalmente aislado en su propio canal Realtime para no interferir con el bucle de audio de Order Ready Board.
 */

'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useLanguage } from '@/lib/i18n'
import { PhoneCall, CheckCircle2, Bell } from 'lucide-react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

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
  caller_name: string
  caller_phone: string
  caller_type: string
  urgency: string
  reason_category: string
  reason_summary: string
  ticket_or_order_number: string | null
  created_at: string
}

export default function PhoneCallbackAlertBanner({ storeCode }: { storeCode: string }) {
  const { language } = useLanguage()
  const isEn = language === 'en'
  const storeId = STORE_ID_BY_CODE[String(storeCode || 'LYNWOOD').toUpperCase()] || 14

  const [pendingCallbacks, setPendingCallbacks] = useState<CallbackAlert[]>([])

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }, [])

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/phone/dashboard?callbacksOnly=true&storeId=${storeId}&status=pending`,
        { headers: getAuthHeaders() }
      )
      if (!res.ok) return
      const data = await res.json()
      setPendingCallbacks(data.callbacks || [])
    } catch {
      // Ignore network hiccups
    }
  }, [storeId, getAuthHeaders])

  useEffect(() => {
    fetchPending()
  }, [fetchPending])

  useEffect(() => {
    const channel = supabase
      .channel(`manager-phone-callbacks:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'phone_callback_requests',
          filter: `store_id=eq.${storeId}`
        },
        () => {
          fetchPending()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId, fetchPending])

  const handleResolve = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'callback_request',
          id,
          status: 'resolved'
        })
      })
      setPendingCallbacks((prev) => prev.filter((c) => c.id !== id))
    } catch {
      // Ignore
    }
  }

  if (pendingCallbacks.length === 0) return null

  return (
    <div className="bg-rose-600 text-white px-4 py-2.5 border-b border-rose-700 shadow-md z-40">
      <div className="max-w-7xl mx-auto flex flex-col gap-2">
        {pendingCallbacks.map((cb) => (
          <div
            key={cb.id}
            className="flex flex-wrap items-center justify-between gap-3 bg-rose-700/60 rounded-xl px-3.5 py-2 border border-rose-400/40"
          >
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-white text-rose-600 animate-pulse">
                <PhoneCall size={16} />
              </span>
              <div className="text-xs sm:text-sm">
                <span className="font-black uppercase tracking-wide mr-2">
                  🔔 {isEn ? 'PRIORITY PHONE CALLBACK:' : 'RECADO TELEFÓNICO PRIORITARIO (IA):'}
                </span>
                <span className="font-extrabold">
                  {cb.caller_name} ({cb.caller_phone})
                </span>
                <span className="mx-1.5 opacity-75">•</span>
                <span className="font-medium">{cb.reason_summary}</span>
                {cb.ticket_or_order_number && (
                  <span className="ml-2 px-2 py-0.5 rounded bg-white/20 text-[11px] font-bold">
                    Ticket: {cb.ticket_or_order_number}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={(e) => handleResolve(cb.id, e)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-rose-700 hover:bg-rose-50 text-xs font-black shadow-sm transition shrink-0"
            >
              <CheckCircle2 size={14} />
              {isEn ? 'Mark Resolved' : 'Marcar Atendido'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
