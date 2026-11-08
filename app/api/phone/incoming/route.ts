/**
 * @module api/phone/incoming
 * @description Webhook principal de entrada de llamadas de Twilio (`POST /api/phone/incoming`) para las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - Valida la firma criptográfica `X-Twilio-Signature` antes de procesar cualquier llamada.
 * - Identifica automáticamente a cuál de las 15 sucursales entró la llamada comparando `To` (número Twilio de la tienda),
 *   `ForwardedFrom` (línea de la tienda que desvió) o el parámetro `?storeId=`.
 * - Si la sucursal tenía el desvío pendiente de verificación, marca automáticamente `forwarding_status = 'verified'`
 *   al recibir la primera llamada desviada real.
 * - Reproduce el saludo oficial con la voz neuronal `Kore` (`<Play>` desde `/api/phone/tts`) cumpliendo con California AB 2905
 *   y Penal Code §632, y abre `<Gather input="speech dtmf">` hacia `/api/phone/respond`.
 *
 * @dataFlow
 * - Llamada entrante Twilio -> `POST /api/phone/incoming` -> Registro en `phone_calls` -> TwiML (`<Gather>` + `<Play>`).
 *
 * @notes
 * - Si la contestadora está apagada (`is_enabled = false`) en una tienda, responde con un mensaje cortés indicando
 *   el horario y sitio web de esa sucursal.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import {
  buildInitialGreeting,
  escapeXml,
  getStorePhoneContext,
  PhoneLang,
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function normalizeDigits(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

async function resolveStoreIdFromCall(
  queryStoreId: string | null,
  toNumber: string,
  forwardedFrom: string
): Promise<number> {
  if (queryStoreId && Number.isFinite(Number(queryStoreId))) {
    return Number(queryStoreId)
  }

  const toDigits = normalizeDigits(toNumber)
  const fwdDigits = normalizeDigits(forwardedFrom)

  const [{ data: configs }, { data: stores }] = await Promise.all([
    supabaseAdmin.from('phone_agent_config').select('store_id, twilio_phone_number'),
    supabaseAdmin.from('stores').select('id, phone')
  ])

  if (toDigits && configs) {
    const matchByTwilio = configs.find(
      (c) => c.twilio_phone_number && normalizeDigits(c.twilio_phone_number) === toDigits
    )
    if (matchByTwilio) return matchByTwilio.store_id
  }

  if (fwdDigits && stores) {
    const matchByForwarded = stores.find((s) => s.phone && normalizeDigits(s.phone) === fwdDigits)
    if (matchByForwarded) return matchByForwarded.id
  }

  // Fallback seguro a Lynwood #14 si no se especificó número aún
  return 14
}

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

    const reqUrl = new URL(request.url)
    const proto = request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '')
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || reqUrl.host
    const baseUrl = `${proto}://${host}`

    const callSid = params.CallSid || `TWILIO_${Date.now()}`
    const fromNumber = params.From || ''
    const toNumber = params.To || ''
    const forwardedFrom = params.ForwardedFrom || ''

    const storeId = await resolveStoreIdFromCall(
      reqUrl.searchParams.get('storeId'),
      toNumber,
      forwardedFrom
    )

    const ctx = await getStorePhoneContext(storeId)
    const { store, config, scheduleEval } = ctx
    const lang: PhoneLang = (config.default_language === 'en' ? 'en' : 'es') as PhoneLang
    const voice = config.voice_id || 'Kore'

    // Si la llamada llegó desviada desde la tienda, marcar el desvío como verificado automáticamente
    if (config.forwarding_status !== 'verified') {
      await supabaseAdmin
        .from('phone_agent_config')
        .update({
          forwarding_status: 'verified',
          forwarding_verified_at: new Date().toISOString()
        })
        .eq('store_id', store.id)
    }

    if (!config.is_enabled) {
      const disabledMsg =
        lang === 'en'
          ? `Thank you for calling Tacos Gavilan ${store.name}. ${scheduleEval.statusMessageEn} You can also order online at tacosgavilan.com.`
          : `Gracias por llamar a Tacos Gavilan sucursal ${store.name}. ${scheduleEval.statusMessageEs} También puedes ordenar en línea en tacosgavilan.com.`
      const ttsUrl = `${baseUrl}/api/phone/tts?lang=${lang}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(disabledMsg)}`
      const twimlDisabled = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(ttsUrl)}</Play>
  <Hangup/>
</Response>`
      return new Response(twimlDisabled, {
        status: 200,
        headers: { 'Content-Type': 'text/xml; charset=utf-8' }
      })
    }

    const greetingText = buildInitialGreeting(
      store.name,
      lang,
      config.custom_greeting_es,
      config.custom_greeting_en
    )

    // Registrar inicio de llamada en `phone_calls`
    await supabaseAdmin.from('phone_calls').upsert(
      {
        call_sid: callSid,
        store_id: store.id,
        source: 'twilio',
        caller_number: fromNumber || null,
        to_number: toNumber || null,
        forwarded_from: forwardedFrom || null,
        language: lang,
        status: 'in_progress',
        turns_count: 0,
        transcript: [
          {
            role: 'assistant',
            text: greetingText,
            timestamp: new Date().toISOString()
          }
        ],
        business_date: getCaliforniaBusinessDate(),
        shift: getCaliforniaShift()
      },
      { onConflict: 'call_sid' }
    )

    const greetingAudioUrl = `${baseUrl}/api/phone/tts?lang=${lang}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(greetingText)}`
    const respondUrl = `${baseUrl}/api/phone/respond?storeId=${store.id}&lang=${lang}`
    const gatherLang = lang === 'en' ? 'en-US' : 'es-US'

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech dtmf" language="${gatherLang}" speechTimeout="auto" action="${escapeXml(respondUrl)}" method="POST">
    <Play>${escapeXml(greetingAudioUrl)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(respondUrl)}&amp;retry=1</Redirect>
</Response>`

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    })
  } catch (err: any) {
    console.error('[api/phone/incoming] Error:', err)
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-MX">Gracias por llamar a Tacos Gavilan. Por favor visita tacosgavilan punto com para ver nuestro menú y horarios.</Say>
</Response>`
    return new Response(fallbackTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    })
  }
}
