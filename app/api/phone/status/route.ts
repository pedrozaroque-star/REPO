/**
 * @module api/phone/status
 * @description Webhook de cierre y estado de llamada de Twilio (`POST /api/phone/status`).
 * Actualiza la duración final y el estado de la llamada en `public.phone_calls`.
 *
 * @businessRules
 * - Valida la firma `X-Twilio-Signature`.
 * - Si la llamada ya tenía `status = 'callback_requested'`, preserva ese estado para seguimiento gerencial.
 *
 * @dataFlow
 * - Twilio StatusCallback -> `POST /api/phone/status` -> `UPDATE public.phone_calls`.
 *
 * @notes
 * - Registra `duration_seconds` y `ended_at` reales reportados por Twilio.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyTwilioWebhookSignature } from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'

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

    const callSid = params.CallSid
    const callStatus = (params.CallStatus || '').toLowerCase()
    const duration = Number(params.CallDuration || params.Duration || 0)

    if (callSid) {
      const { data: existing } = await supabaseAdmin
        .from('phone_calls')
        .select('id, status')
        .eq('call_sid', callSid)
        .maybeSingle()

      if (existing) {
        const finalStatus =
          existing.status === 'callback_requested'
            ? 'callback_requested'
            : callStatus === 'completed'
              ? 'completed'
              : callStatus || 'completed'

        await supabaseAdmin
          .from('phone_calls')
          .update({
            status: finalStatus,
            duration_seconds: Number.isFinite(duration) && duration > 0 ? duration : 10,
            ended_at: new Date().toISOString()
          })
          .eq('id', existing.id)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/phone/status] Error:', err?.message)
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 })
  }
}
