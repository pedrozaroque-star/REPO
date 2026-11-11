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
 * - Twilio StatusCallback -> `POST /api/phone/status` -> `UPDATE public.phone_calls`.
 *
 * @notes
 * - Registra `duration_seconds` real reportado por Twilio sin inflar llamadas de 0 s con valores ficticios.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyTwilioWebhookSignature } from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'

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
    const parsedDuration = rawDuration !== undefined && rawDuration !== '' ? Number(rawDuration) : NaN

    const { data: existing } = await supabaseAdmin
      .from('phone_calls')
      .select('id, status, turns_count, duration_seconds, resolved_by_ai')
      .eq('call_sid', callSid)
      .maybeSingle()

    if (existing) {
      const preservedStatus =
        existing.status === 'callback_requested' || existing.status === 'transferred'
          ? existing.status
          : callStatus === 'completed'
            ? 'completed'
            : callStatus || 'completed'

      const turnsCount = Number(existing.turns_count || 0)
      const finalDuration =
        Number.isFinite(parsedDuration) && parsedDuration >= 0
          ? Math.round(parsedDuration)
          : Number(existing.duration_seconds || 0)

      const updatePayload: Record<string, any> = {
        status: preservedStatus,
        duration_seconds: finalDuration,
        ended_at: new Date().toISOString()
      }

      if (turnsCount === 0 || preservedStatus === 'callback_requested' || preservedStatus === 'transferred') {
        updatePayload.resolved_by_ai = false
      }

      await supabaseAdmin.from('phone_calls').update(updatePayload).eq('id', existing.id)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/phone/status] Error:', err?.message)
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 })
  }
}
