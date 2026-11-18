/**
 * @module api/phone/status
 * @description Webhook de cierre y estado terminal de llamada de Twilio (`POST /api/phone/status`).
 * Actualiza la duración real y el estado final de la llamada en `public.phone_calls`.
 *
 * @businessRules
 * - Valida la firma criptográfica `X-Twilio-Signature`.
 * - Ignora eventos transitorios (`queued`, `initiated`, `ringing`, `in-progress`) para nunca sellar `ended_at` antes de tiempo.
 * - Preserva siempre `status = 'callback_requested'` o `status = 'transferred'` para trazabilidad gerencial.
 * - Si `turns_count === 0` (colgaron durante el saludo sin hacer preguntas), mantiene `resolved_by_ai = false`.
 *
 * @dataFlow
 * - Twilio StatusCallback -> `POST /api/phone/status` -> `upsertPhoneCallStatusTombstone` -> `reconcileCallWithTerminalTombstone` -> `public.phone_calls`.
 *
 * @notes
 * - Registra `duration_seconds` autoritativo reportado por Twilio (`CallDuration`), reemplazando cualquier duración provisional
 *   previa (ej. `shouldHangup` o sucursal apagada) sin reabrir jamás llamadas ya terminadas.
 * - Un evento sin `CallDuration` (`authoritativeDuration === null`) jamás reemplaza una duración válida existente con `NULL` ni `0`
 *   (ni en `phone_call_status_tombstones` ni en `phone_calls`).
 * - Integridad transaccional estricta: si falla cualquier operación necesaria de base de datos (incluyendo `UPDATE` de `phone_calls`),
 *   el tombstone permanece intacto en `phone_call_status_tombstones` para reintento y el endpoint responde HTTP 500 (`{ ok: false }`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import {
  getPhoneRoutingDirectory,
  reconcileCallWithTerminalTombstone,
  resolveStoreFromIncomingCall,
  upsertPhoneCallStatusTombstone,
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 15
export const preferredRegion = 'sfo1'

const NON_TERMINAL_TWILIO_STATUSES = new Set(['queued', 'initiated', 'ringing', 'in-progress'])

export async function POST(request: Request) {
  try {
    const formData = await request.formData().catch(() => null)
    const params: Record<string, string> = {}
    if (formData) {
      formData.forEach((value, key) => {
        params[key] = String(value)
      })
    }

    const sigCheck = verifyTwilioWebhookSignature(request, params)
    if (!sigCheck.valid) {
      return new Response('Forbidden: Invalid X-Twilio-Signature', { status: 403 })
    }

    const callSid = (params.CallSid || '').trim()
    const callStatus = (params.CallStatus || '').trim().toLowerCase()

    if (!callSid || NON_TERMINAL_TWILIO_STATUSES.has(callStatus)) {
      return NextResponse.json({ ok: true, ignored: Boolean(callStatus) })
    }

    const rawDuration = params.CallDuration ?? params.Duration
    const trimmedDuration = rawDuration !== undefined && rawDuration !== null ? String(rawDuration).trim() : ''
    const parsedDuration = trimmedDuration !== '' ? Number(trimmedDuration) : NaN
    const hasAuthoritativeDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0
    const authoritativeDuration = hasAuthoritativeDuration
      ? Math.min(7200, Math.max(0, Math.round(parsedDuration)))
      : null
    const terminalStatus = callStatus === 'completed' ? 'completed' : callStatus || 'completed'
    const endedIso = new Date().toISOString()

    // 1. Persistir primero el tombstone terminal de forma atómica (nunca reemplaza duration_seconds válida con NULL)
    const savedTombstone = await upsertPhoneCallStatusTombstone({
      callSid,
      terminalStatus,
      authoritativeDuration,
      callerNumber: (params.From || '').trim() || null,
      toNumber: (params.To || '').trim() || null,
      forwardedFrom: (params.ForwardedFrom || '').trim() || null,
      endedAt: endedIso
    })

    // 2. Buscar fila existente en phone_calls (o crearla si store_id ya es identificable)
    let { data: existing, error: lookupErr } = await supabaseAdmin
      .from('phone_calls')
      .select('id, status, turns_count, duration_seconds, resolved_by_ai, ended_at')
      .eq('call_sid', callSid)
      .maybeSingle()

    if (lookupErr) throw lookupErr

    if (!existing) {
      const reqUrl = new URL(request.url)
      const queryStoreId = reqUrl.searchParams.get('storeId')
      const routingDir = await getPhoneRoutingDirectory()
      const resolved = await resolveStoreFromIncomingCall({
        queryStoreId,
        toNumber: (params.To || '').trim() || null,
        forwardedFrom: (params.ForwardedFrom || '').trim() || null,
        directory: routingDir
      })

      if (resolved.storeId) {
        const tombDur =
          savedTombstone?.duration_seconds !== null &&
          savedTombstone?.duration_seconds !== undefined &&
          Number.isFinite(Number(savedTombstone.duration_seconds)) &&
          Number(savedTombstone.duration_seconds) >= 0
            ? Math.round(Number(savedTombstone.duration_seconds))
            : authoritativeDuration ?? 0

        const { error: preInsertErr } = await supabaseAdmin.from('phone_calls').upsert(
          {
            call_sid: callSid,
            store_id: resolved.storeId,
            source: 'twilio',
            caller_number: (params.From || '').trim() || savedTombstone?.caller_number || null,
            to_number: (params.To || '').trim() || savedTombstone?.to_number || null,
            forwarded_from: (params.ForwardedFrom || '').trim() || savedTombstone?.forwarded_from || null,
            language: 'es',
            status: savedTombstone?.terminal_status || terminalStatus,
            resolved_by_ai: false,
            turns_count: 0,
            duration_seconds: tombDur,
            ended_at: savedTombstone?.ended_at || endedIso,
            transcript: [],
            business_date: getCaliforniaBusinessDate(),
            shift: getCaliforniaShift()
          },
          { onConflict: 'call_sid', ignoreDuplicates: true }
        )
        if (preInsertErr) throw preInsertErr
      }

      // Re-lectura simétrica tras guardar tombstone (por si incoming insertó justo en paralelo)
      const secondLookup = await supabaseAdmin
        .from('phone_calls')
        .select('id, status, turns_count, duration_seconds, resolved_by_ai, ended_at')
        .eq('call_sid', callSid)
        .maybeSingle()
      if (secondLookup.error) throw secondLookup.error
      existing = secondLookup.data

      if (!existing) {
        // La sucursal aún no es identificable e incoming aún no inserta phone_calls:
        // el tombstone ya quedó persistido y reconciliará status + CallDuration apenas se cree la llamada.
        return NextResponse.json({ ok: true, deferredViaTombstone: true })
      }
    }

    // 3. Reconciliar atómicamente phone_calls desde el tombstone:
    //    - Si el UPDATE de phone_calls falla, reconcileCallWithTerminalTombstone conserva el tombstone y lanza error -> HTTP 500
    //    - Si no llegó CallDuration, preserva intacta cualquier duration_seconds válida previa
    //    - Jamás reabre llamadas terminadas
    const reconciled = await reconcileCallWithTerminalTombstone(callSid)
    if (!reconciled) {
      throw new Error(`No se pudo reconciliar el cierre de phone_calls para CallSid=${callSid}`)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/phone/status] Error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al registrar cierre de llamada' },
      { status: 500 }
    )
  }
}
