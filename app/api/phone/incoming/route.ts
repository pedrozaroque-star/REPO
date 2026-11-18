/**
 * @module api/phone/incoming
 * @description Webhook principal de entrada de llamadas de Twilio (`POST /api/phone/incoming`) para las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - Valida la firma criptográfica `X-Twilio-Signature` antes de procesar cualquier llamada.
 * - Identifica con exactitud a cuál de las 15 sucursales entró la llamada comparando `?storeId=` válido, `To` (`twilio_phone_number`)
 *   o `ForwardedFrom` (`stores.phone`). Si un número de Twilio aún no ha sido asignado a ninguna tienda, reproduce un mensaje
 *   institucional cortés de Tacos Gavilan sin suplantar a Lynwood #14 ni marcar desvíos falsos.
 * - Marca `forwarding_status = 'verified'` únicamente cuando la llamada llega desviada desde el teléfono real de esa sucursal,
 *   invalidando de inmediato la caché RAM del contexto telefónico.
 * - Reproduce el saludo oficial con la voz neuronal `Kore` (`<Play>` desde `/api/phone/tts`) cumpliendo con California AB 2905
 *   y CIPA (Penal Code §§ 631, 632 y 632.7 — "Before Interception Rule"), y abre `<Gather input="speech dtmf" numDigits="1">`.
 *
 * @dataFlow
 * - Llamada entrante Twilio -> `POST /api/phone/incoming` -> Registro en `phone_calls` (`resolved_by_ai: false`) -> TwiML.
 *
 * @notes
 * - El `<Redirect>` de respaldo tras el primer `<Gather>` envía `&silence=1` (no `retry=1`) para que el primer silencio
 *   pregunte amablemente `"¿Sigues en la línea?"` antes de colgar.
 * - Cachea el mapa de teléfonos de las 15 sucursales (60 s TTL), usa `buildTwilioGatherAttrs` (`speechTimeout="1" speechModel="telephony"`
 *   + `hints`) y coordina atómicamente el `upsert` inicial de `phone_calls` (`ignoreDuplicates: true` + backfill seguro de `transcript`)
 *   para no perder cierres rápidos de `/api/phone/status` que lleguen antes del registro diferido.
 */

import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { getPhoneAgentSpeech, resolvePhoneFemaleVoice } from '@/lib/order-ready-tts'
import { formatCustomerGreetingTarget } from '@/lib/customer-store-names'
import {
  buildInitialGreeting,
  buildPhoneTtsUrl,
  buildTwilioGatherAttrs,
  cleanPhoneStoreName,
  escapeXml,
  getPostDisclosurePrompt,
  getStorePhoneContext,
  invalidateStorePhoneContextCache,
  PhoneLang,
  reconcileCallWithTerminalTombstone,
  resolveStoreFromIncomingCall,
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 20
export const preferredRegion = 'sfo1'

function normalizeDigits10(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

function scheduleBackgroundTask(task: () => Promise<any>) {
  try {
    after(async () => {
      await task().catch(() => null)
    })
  } catch {
    void task().catch(() => null)
  }
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
    const rawProto = request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '')
    const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || reqUrl.host
    const proto = rawProto.split(',')[0].trim() || 'https'
    const host = rawHost.split(',')[0].trim()
    const baseUrl = `${proto}://${host}`

    const callSid = (params.CallSid || `TWILIO_${Date.now()}`).trim()
    const fromNumber = (params.From || '').trim()
    const toNumber = (params.To || '').trim()
    const forwardedFrom = (params.ForwardedFrom || '').trim()

    const { storeId, matchedStorePhone } = await resolveStoreFromIncomingCall({
      queryStoreId: reqUrl.searchParams.get('storeId'),
      toNumber,
      forwardedFrom
    })

    // Si el número receptor de Twilio todavía no está vinculado a ninguna de las 15 tiendas, contestar sin suplantar otra tienda
    if (!storeId) {
      const unassignedMsg =
        'Gracias por llamar a Tacos Gavilan. Puedes consultar el menú, ubicación y horario en vivo de nuestras quince sucursales en tacosgavilan.com.'
      let unassignedTag = `<Say voice="Polly.Mia-Neural" language="es-MX">${escapeXml(unassignedMsg)}</Say>`
      try {
        await getPhoneAgentSpeech(unassignedMsg, 'es', 'Kore', false, { skipSseAttempt: true, maxTotalMs: 3500 })
        unassignedTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, unassignedMsg, 'es', 'Kore'))}</Play>`
      } catch {
        // Fallback seguro a <Say> para no cortar con HTTP 502
      }
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${unassignedTag}
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    const ctx = await getStorePhoneContext(storeId)
    const { store, config, scheduleEval } = ctx
    const lang: PhoneLang = (config.default_language === 'en' ? 'en' : 'es') as PhoneLang
    const voice = resolvePhoneFemaleVoice(config.voice_id)

    // Verificar si `ForwardedFrom` coincide con el teléfono real de esta sucursal para marcar desvío sin frenar el TwiML inicial
    const fwdDigits = normalizeDigits10(forwardedFrom)
    const storePhoneDigits = normalizeDigits10(matchedStorePhone || store.phone)
    const shouldVerifyForwarding =
      fwdDigits.length === 10 &&
      Boolean(storePhoneDigits) &&
      config.forwarding_status !== 'verified' &&
      fwdDigits === storePhoneDigits

    const persistIncomingCallWithoutOverwritingClose = async (opts: {
      initialStatus: 'in_progress' | 'completed'
      initialTranscript: Array<{ role: 'assistant' | 'user'; text: string; timestamp: string }>
      summary?: string
      fallbackDuration?: number
      markEnded?: boolean
    }) => {
      const nowIso = new Date().toISOString()
      const { error: upsertErr } = await supabaseAdmin.from('phone_calls').upsert(
        {
          call_sid: callSid,
          store_id: store.id,
          source: 'twilio',
          caller_number: fromNumber || null,
          to_number: toNumber || null,
          forwarded_from: forwardedFrom || null,
          language: lang,
          status: opts.initialStatus,
          resolved_by_ai: false,
          turns_count: 0,
          ...(opts.fallbackDuration !== undefined ? { duration_seconds: opts.fallbackDuration } : {}),
          ...(opts.summary ? { summary: opts.summary } : {}),
          ...(opts.markEnded ? { ended_at: nowIso } : {}),
          transcript: opts.initialTranscript,
          business_date: getCaliforniaBusinessDate(),
          shift: getCaliforniaShift()
        },
        { onConflict: 'call_sid', ignoreDuplicates: true }
      )
      if (upsertErr) throw upsertErr

      // Si /api/phone/status insertó primero una fila cerrada con transcript vacío, completar metadatos sin pisar status/ended_at
      const { data: currentRow, error: curErr } = await supabaseAdmin
        .from('phone_calls')
        .select('id, turns_count, transcript')
        .eq('call_sid', callSid)
        .maybeSingle()
      if (curErr) throw curErr

      if (
        currentRow &&
        Number(currentRow.turns_count || 0) === 0 &&
        (!Array.isArray(currentRow.transcript) || currentRow.transcript.length === 0)
      ) {
        const backfillPayload: Record<string, any> = {
          store_id: store.id,
          language: lang,
          caller_number: fromNumber || null,
          to_number: toNumber || null,
          forwarded_from: forwardedFrom || null,
          transcript: opts.initialTranscript
        }
        if (opts.summary) backfillPayload.summary = opts.summary
        const { error: bfErr } = await supabaseAdmin
          .from('phone_calls')
          .update(backfillPayload)
          .eq('id', currentRow.id)
        if (bfErr) throw bfErr
      }

      // Si /api/phone/status llegó antes de que existiera phone_calls (incluso sin poder identificar store_id),
      // reconciliar de inmediato el estado cerrado y CallDuration autoritativo desde phone_call_status_tombstones.
      // Si falla el UPDATE, reconcileCallWithTerminalTombstone conserva el tombstone intacto para reintento.
      await reconcileCallWithTerminalTombstone(callSid)
    }

    if (!config.is_enabled) {
      const spokenStoreName = cleanPhoneStoreName(store.name) || store.name
      const greetingTarget = formatCustomerGreetingTarget(store, lang)
      const disabledMsg =
        lang === 'en'
          ? `Thank you for calling Tacos Gavilan ${greetingTarget}. ${scheduleEval.statusMessageEn} You can also order online at tacosgavilan.com.`
          : `Gracias por llamar a Tacos Gavilan ${greetingTarget}. ${scheduleEval.statusMessageEs} También puedes ordenar en línea en tacosgavilan.com.`
      const sayVoiceDisabled = lang === 'en' ? 'Polly.Joanna-Neural' : 'Polly.Mia-Neural'
      const sayLangDisabled = lang === 'en' ? 'en-US' : 'es-MX'
      let disabledTag = `<Say voice="${sayVoiceDisabled}" language="${sayLangDisabled}">${escapeXml(disabledMsg)}</Say>`
      try {
        await getPhoneAgentSpeech(disabledMsg, lang, voice, false, { skipSseAttempt: true, maxTotalMs: 3200 })
        disabledTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, disabledMsg, lang, voice))}</Play>`
      } catch {
        // Fallback seguro a <Say> para jamás devolver HTTP 502 si TTS falla cuando la sucursal está apagada
      }
      scheduleBackgroundTask(async () => {
        await Promise.all([
          getPhoneAgentSpeech(disabledMsg, lang, voice, false, { awaitStoragePersist: true }).catch(() => null),
          persistIncomingCallWithoutOverwritingClose({
            initialStatus: 'completed',
            initialTranscript: [{ role: 'assistant', text: disabledMsg, timestamp: new Date().toISOString() }],
            summary: `Contestadora apagada en sucursal (${spokenStoreName})`,
            fallbackDuration: 5,
            markEnded: true
          })
        ])
      })

      const twimlDisabled = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${disabledTag}
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
      config.custom_greeting_en,
      { includeLanguageSwitchHint: true, scheduleEval }
    )
    const disclosureOnlyText = buildInitialGreeting(
      store.name,
      lang,
      config.custom_greeting_es,
      config.custom_greeting_en,
      { omitTrailingQuestion: true, includeLanguageSwitchHint: true }
    )
    const questionOnlyText = getPostDisclosurePrompt(lang, scheduleEval)
    const initialTranscript = [
      {
        role: 'assistant' as const,
        text: greetingText,
        timestamp: new Date().toISOString()
      }
    ]
    // Arrancar la escritura inicial en paralelo desde t=0 (sin bloquear el TwiML si TTS ya está en caché)
    const initialCallPersistPromise = persistIncomingCallWithoutOverwritingClose({
      initialStatus: 'in_progress',
      initialTranscript
    }).catch((e) => {
      console.error('[api/phone/incoming] Initial call persist warning:', e?.message || e)
    })

    const sayVoice = lang === 'en' ? 'Polly.Joanna-Neural' : 'Polly.Mia-Neural'
    const sayLang = lang === 'en' ? 'en-US' : 'es-MX'
    let disclosureTag: string
    let questionTag: string
    try {
      await Promise.all([
        getPhoneAgentSpeech(disclosureOnlyText, lang, voice, false, { skipSseAttempt: true, maxTotalMs: 3600 }),
        getPhoneAgentSpeech(questionOnlyText, lang, voice, false, { skipSseAttempt: true, maxTotalMs: 3600 })
      ])
      disclosureTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, disclosureOnlyText, lang, voice))}</Play>`
      questionTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, questionOnlyText, lang, voice))}</Play>`
    } catch {
      disclosureTag = `<Say voice="${sayVoice}" language="${sayLang}">${escapeXml(disclosureOnlyText)}</Say>`
      questionTag = `<Say voice="${sayVoice}" language="${sayLang}">${escapeXml(questionOnlyText)}</Say>`
    }

    scheduleBackgroundTask(async () => {
      await Promise.all([
        initialCallPersistPromise,
        getPhoneAgentSpeech(disclosureOnlyText, lang, voice, false, { awaitStoragePersist: true }).catch(() => null),
        getPhoneAgentSpeech(questionOnlyText, lang, voice, false, { awaitStoragePersist: true }).catch(() => null),
        shouldVerifyForwarding
          ? supabaseAdmin
              .from('phone_agent_config')
              .update({
                forwarding_status: 'verified',
                forwarding_verified_at: new Date().toISOString()
              })
              .eq('store_id', store.id)
              .then(() => {
                invalidateStorePhoneContextCache(store.id)
              })
          : Promise.resolve()
      ])
    })

    // REGLA CIPA CALIFORNIA (§§ 631, 632 y 632.7 — "Before Interception Rule"):
    // El primer <Gather input="dtmf" timeout="0"> escucha ÚNICAMENTE tonos de teclado (tecla 9 tras "For English, press nine.")
    // con CERO captura de voz (0 speech), pasando en 0 ms a <Gather input="speech dtmf"> al concluir el aviso de llamada transcrita.
    const respondUrl = `${baseUrl}/api/phone/respond?storeId=${store.id}&lang=${lang}&turn0=1`

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="0" action="${escapeXml(respondUrl)}&amp;preconsent=1" method="POST">
    ${disclosureTag}
  </Gather>
  <Gather ${buildTwilioGatherAttrs(lang, respondUrl)}>
    ${questionTag}
  </Gather>
  <Redirect method="POST">${escapeXml(respondUrl)}&amp;silence=1</Redirect>
</Response>`

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    })
  } catch (err: any) {
    console.error('[api/phone/incoming] Error:', err)
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">Gracias por llamar a Tacos Gavilan. Por favor visita tacosgavilan punto com para consultar nuestro menú y horarios.</Say>
  <Hangup/>
</Response>`
    return new Response(fallbackTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    })
  }
}
