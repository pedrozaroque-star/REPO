/**
 * @module api/phone/respond
 * @description Webhook de continuación de conversación de Twilio (`POST /api/phone/respond`).
 * Recibe `SpeechResult` o `Digits` desde `<Gather>`, ejecuta `processPhoneAgentTurn()` con herramientas en vivo,
 * y responde con TwiML que reproduce la voz neuronal configurada (`<Play>`), transfiere al gerente (`<Dial>`) o finaliza (`<Hangup>`).
 *
 * @businessRules
 * - Valida la firma criptográfica `X-Twilio-Signature`.
 * - Blindaje CIPA inquebrantable (`preconsent=1`): si el usuario presiona `9` cambia de idioma y escucha el aviso CIPA completo
 *   en el nuevo idioma antes de habilitar `input="speech"`; si presiona cualquier otra tecla durante el aviso inicial, reproduce
 *   el aviso legal completo sin interrupción antes de abrir el micrófono.
 * - Tecla `9` a mitad de llamada cambia de idioma de inmediato reproduciendo también el aviso CIPA del nuevo idioma.
 * - Flujo de silencio en 2 pasos reales (`silence=1` -> pregunta `"¿Sigues en la línea?"` -> `retry=1` -> cierra llamada en DB + `<Hangup/>`).
 * - Transferencia en vivo `<Dial timeout="20" action="...&dialFallback=1">` con respaldo automático si el gerente no alcanza a contestar.
 *
 * @dataFlow
 * - Twilio `<Gather>` / `<Dial>` -> `POST /api/phone/respond` -> `processPhoneAgentTurn()` -> TwiML.
 *
 * @notes
 * - Todos los `<Gather input="speech dtmf">` usan `buildTwilioGatherAttrs()` (`speechTimeout="1" speechModel="phone_call" enhanced="true"` + hints Tacos Gavilan).
 * - Optimización 2026-11-12: cero suplantación de Lynwood #14, `deferDbFlush: true`, cero doble TTS sobre `firstChunk` (solo pre-calienta `restChunk` en `after()`),
 *   tecla `9` concisa a mitad de llamada, DTMF `0`/no asignados seguros, `&retry=1` correcto tras silencio y resolución automática de callback cuando `<Dial>` es contestado.
 */

import { after } from 'next/server'
import {
  buildInitialGreeting,
  buildPhoneTtsUrl,
  buildTwilioGatherAttrs,
  cleanPhoneStoreName,
  escapeXml,
  getPostDisclosurePrompt,
  getStorePhoneContext,
  PhoneLang,
  processPhoneAgentTurn,
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'
import { supabaseAdmin } from '@/lib/supabase'
import { getPhoneAgentSpeech, resolvePhoneFemaleVoice, splitPhoneReplyForStreaming, VoiceId } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function scheduleBackgroundTask(task: () => Promise<any>) {
  try {
    after(async () => {
      await task().catch(() => null)
    })
  } catch {
    void task().catch(() => null)
  }
}

function translateDtmfToText(digits: string, lang: PhoneLang): string {
  switch (digits.trim()) {
    case '0':
      return lang === 'en'
        ? 'I would like to speak with the manager or leave a message for them.'
        : 'Necesito ayuda de un encargado o gerente de la sucursal por favor.'
    case '1':
      return lang === 'en' ? 'What are your hours today and what is the address?' : '¿Cuál es el horario de hoy y la dirección?'
    case '2':
      return lang === 'en' ? 'Tell me about Fiesta Platters and prices.' : '¿Cuáles son los precios y tamaños de las charolas Fiesta Platter?'
    case '3':
      return lang === 'en' ? 'I need to leave a message for the store manager.' : 'Necesito dejarle un recado urgente al gerente de la sucursal.'
    default:
      return ''
  }
}

async function loadSafeStoreContext(rawStoreId: number | null, callSid?: string) {
  if (rawStoreId && Number.isFinite(rawStoreId) && rawStoreId > 0) {
    try {
      return await getStorePhoneContext(rawStoreId)
    } catch {
      await new Promise((r) => setTimeout(r, 120))
      try {
        return await getStorePhoneContext(rawStoreId)
      } catch {
        // Intentar resolver desde el registro real de la llamada en DB sin suplantar otra tienda
      }
    }
  }
  if (callSid) {
    const { data: callRow } = await supabaseAdmin
      .from('phone_calls')
      .select('store_id')
      .eq('call_sid', callSid)
      .maybeSingle()
    const realStoreId = Number(callRow?.store_id)
    if (Number.isFinite(realStoreId) && realStoreId > 0) {
      return await getStorePhoneContext(realStoreId)
    }
  }
  return null
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

    const currentLang = (reqUrl.searchParams.get('lang') === 'en' ? 'en' : 'es') as PhoneLang
    const isRetry = reqUrl.searchParams.get('retry') === '1'
    const isPreconsent = reqUrl.searchParams.get('preconsent') === '1'
    const isDialFallback = reqUrl.searchParams.get('dialFallback') === '1'

    const callSid = (params.CallSid || `TWILIO_${Date.now()}`).trim()
    const speechResult = (params.SpeechResult || '').trim()
    const digits = (params.Digits || '').trim()

    const parsedStoreId = Number(reqUrl.searchParams.get('storeId'))
    const requestedStoreId = Number.isFinite(parsedStoreId) && parsedStoreId > 0 ? parsedStoreId : null
    const ctx = await loadSafeStoreContext(requestedStoreId, callSid)
    if (!ctx) {
      const errMsg =
        currentLang === 'en'
          ? 'Sorry, we are experiencing a brief connection issue right now. Please visit tacosgavilan.com for our menu and store hours. Thank you!'
          : 'Disculpa, tuvimos un breve problema de conexión en esta línea. Puedes consultar nuestro menú y horarios en tacosgavilan punto com. ¡Gracias por llamar!'
      const errAudioUrl = buildPhoneTtsUrl(baseUrl, errMsg, currentLang, 'Kore')
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(errAudioUrl)}</Play>
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    const storeId = ctx.store.id
    const voice: VoiceId = resolvePhoneFemaleVoice(ctx.config.voice_id)

    // Respaldo post-<Dial>: si el gerente contestó, cerramos limpio; si estaba ocupado o no alcanzó a contestar en 20s,
    // confirmamos al cliente que su alerta prioritaria ya está en la pantalla del gerente y cerramos con calidez.
    if (isDialFallback) {
      const dialStatus = (params.DialCallStatus || '').trim().toLowerCase()
      const dialDuration = Number(params.DialCallDuration || 0)

      const answeredLive = (dialStatus === 'completed' || dialStatus === 'answered') && dialDuration >= 5
      if (answeredLive) {
        const nowIso = new Date().toISOString()
        const { data: callRow } = await supabaseAdmin
          .from('phone_calls')
          .update({
            status: 'transferred',
            resolved_by_ai: false,
            ended_at: nowIso
          })
          .eq('call_sid', callSid)
          .select('id')
          .maybeSingle()

        // Si el gerente contestó en vivo al cliente, resolver automáticamente el recado pendiente de esta llamada
        if (callRow?.id) {
          await supabaseAdmin
            .from('phone_callback_requests')
            .update({
              status: 'resolved',
              resolved_at: nowIso,
              resolved_by: 'Transferencia telefónica en vivo contestada'
            })
            .eq('call_id', callRow.id)
            .eq('status', 'pending')
        }

        return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup/>\n</Response>`, {
          status: 200,
          headers: { 'Content-Type': 'text/xml; charset=utf-8' }
        })
      }

      const spokenStore = cleanPhoneStoreName(ctx.store.name) || ctx.store.name
      const fallbackMsg =
        currentLang === 'en'
          ? `Our ${spokenStore} manager is assisting guests at the counter right now, so your priority alert is saved on their screen to call you back very shortly. Thank you for calling Tacos Gavilan!`
          : `En este instante el gerente de ${spokenStore} está atendiendo en mostrador, pero tu alerta prioritaria ya quedó activa en su pantalla para devolverte la llamada enseguida. ¡Gracias por llamar a Tacos Gavilan!`

      await supabaseAdmin
        .from('phone_calls')
        .update({
          status: 'callback_requested',
          resolved_by_ai: false,
          ended_at: new Date().toISOString()
        })
        .eq('call_sid', callSid)

      scheduleBackgroundTask(() => getPhoneAgentSpeech(fallbackMsg, currentLang, voice, false, { awaitStoragePersist: true }))
      const fallbackUrl = buildPhoneTtsUrl(baseUrl, fallbackMsg, currentLang, voice)

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(fallbackUrl)}</Play>
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    // Blindaje CIPA durante el aviso inicial (`preconsent=1`):
    // - Si presionó `9`: cambia de idioma y reproduce el aviso legal CIPA completo en el nuevo idioma sin abrir `speech`.
    // - Si presionó cualquier otra tecla durante el aviso inicial: termina de reproducir el aviso legal CIPA completo
    //   sin interrupción (`<Play>` fuera de `<Gather>`) antes de activar `input="speech"`.
    if (isPreconsent) {
      const targetLang: PhoneLang = digits === '9' ? (currentLang === 'en' ? 'es' : 'en') : currentLang
      const includeHint = digits !== '9'
      const fullDisclosure = buildInitialGreeting(
        ctx.store.name,
        targetLang,
        ctx.config.custom_greeting_es,
        ctx.config.custom_greeting_en,
        { omitTrailingQuestion: true, includeLanguageSwitchHint: includeHint }
      )
      const postQuestion = getPostDisclosurePrompt(targetLang, ctx.scheduleEval)
      const fullGreeting = buildInitialGreeting(
        ctx.store.name,
        targetLang,
        ctx.config.custom_greeting_es,
        ctx.config.custom_greeting_en,
        { includeLanguageSwitchHint: includeHint, scheduleEval: ctx.scheduleEval }
      )

      if (digits === '9') {
        await supabaseAdmin
          .from('phone_calls')
          .update({
            language: targetLang,
            transcript: [
              {
                role: 'assistant',
                text: fullGreeting,
                timestamp: new Date().toISOString()
              }
            ]
          })
          .eq('call_sid', callSid)
      }

      scheduleBackgroundTask(async () => {
        await Promise.all([
          getPhoneAgentSpeech(fullDisclosure, targetLang, voice, false, { awaitStoragePersist: true }),
          getPhoneAgentSpeech(postQuestion, targetLang, voice, false, { awaitStoragePersist: true })
        ])
      })

      const discUrl = buildPhoneTtsUrl(baseUrl, fullDisclosure, targetLang, voice)
      const qUrl = buildPhoneTtsUrl(baseUrl, postQuestion, targetLang, voice)
      const nextUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${targetLang}`

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(discUrl)}</Play>
  <Gather ${buildTwilioGatherAttrs(targetLang, nextUrl)}>
    <Play>${escapeXml(qUrl)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(nextUrl)}&amp;silence=1</Redirect>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    // Cambio de idioma con tecla 9 a mitad de llamada: el aviso CIPA ya sonó al inicio, responder de forma ágil y cálida
    if (digits === '9') {
      const switchedLang: PhoneLang = currentLang === 'en' ? 'es' : 'en'
      const conciseSwitchReply =
        switchedLang === 'en'
          ? 'Of course, we can continue in English! How can I help you today?'
          : 'Con gusto continuamos en español. ¿En qué te puedo ayudar?'

      scheduleBackgroundTask(async () => {
        const [{ data: existingCall }] = await Promise.all([
          supabaseAdmin.from('phone_calls').select('id, transcript, turns_count').eq('call_sid', callSid).maybeSingle(),
          getPhoneAgentSpeech(conciseSwitchReply, switchedLang, voice, false, { awaitStoragePersist: true })
        ])
        if (existingCall) {
          const prevTr = Array.isArray(existingCall.transcript) ? existingCall.transcript : []
          await supabaseAdmin
            .from('phone_calls')
            .update({
              language: switchedLang,
              turns_count: Number(existingCall.turns_count || 0) + 1,
              transcript: [
                ...prevTr,
                { role: 'user', text: '9', timestamp: new Date().toISOString() },
                { role: 'assistant', text: conciseSwitchReply, timestamp: new Date().toISOString() }
              ]
            })
            .eq('id', existingCall.id)
        }
      })

      const switchUrl = buildPhoneTtsUrl(baseUrl, conciseSwitchReply, switchedLang, voice)
      const nextUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${switchedLang}`

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(switchedLang, nextUrl)}>
    <Play>${escapeXml(switchUrl)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(nextUrl)}&amp;silence=1</Redirect>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    const userText = speechResult || (digits ? translateDtmfToText(digits, currentLang) : '')

    // Tecla no asignada (4-8, *, #) sin voz: orientar amablemente en vez de tratar como silencio o colgar
    if (!userText && digits) {
      const invalidKeyMsg =
        currentLang === 'en'
          ? 'You can ask your question out loud, press 1 for hours, 2 for Fiesta Platters, 3 for the manager, or 9 for Spanish.'
          : 'Puedes decirme tu pregunta con tu voz, o presionar 1 para horarios, 2 para Fiesta Platters, 3 para recado al gerente o 9 para inglés.'
      const invalidKeyUrl = buildPhoneTtsUrl(baseUrl, invalidKeyMsg, currentLang, voice)
      const nextUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${currentLang}`
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(currentLang, nextUrl)}>
    <Play>${escapeXml(invalidKeyUrl)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(nextUrl)}&amp;silence=1</Redirect>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    if (!userText) {
      if (isRetry) {
        const goodbyeText =
          currentLang === 'en'
            ? 'We did not hear a response. Thank you for calling Tacos Gavilan, have a great day!'
            : 'No alcanzamos a escucharte. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!'
        scheduleBackgroundTask(() => getPhoneAgentSpeech(goodbyeText, currentLang, voice, false, { awaitStoragePersist: true }))
        const goodbyeAudio = buildPhoneTtsUrl(baseUrl, goodbyeText, currentLang, voice)

        const { data: existingCall } = await supabaseAdmin
          .from('phone_calls')
          .select('id, status, turns_count')
          .eq('call_sid', callSid)
          .maybeSingle()

        if (existingCall) {
          const finalStatus =
            existingCall.status === 'callback_requested' || existingCall.status === 'transferred'
              ? existingCall.status
              : 'completed'
          const updateObj: Record<string, any> = {
            status: finalStatus,
            ended_at: new Date().toISOString()
          }
          if (Number(existingCall.turns_count || 0) === 0 || finalStatus !== 'completed') {
            updateObj.resolved_by_ai = false
          }
          await supabaseAdmin.from('phone_calls').update(updateObj).eq('id', existingCall.id)
        }

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Play>${escapeXml(goodbyeAudio)}</Play>\n  <Hangup/>\n</Response>`,
          { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
        )
      }

      const promptAgain =
        currentLang === 'en'
          ? 'Are you still there? You can ask me about our hours, menu prices, Fiesta Platters, or leave a message for the manager.'
          : '¿Sigues en la línea? Puedes preguntarme por nuestro horario, precios del menú, charolas para fiestas o dejarle un recado al gerente.'
      scheduleBackgroundTask(() => getPhoneAgentSpeech(promptAgain, currentLang, voice, false, { awaitStoragePersist: true }))
      const promptAudio = buildPhoneTtsUrl(baseUrl, promptAgain, currentLang, voice)
      const retryUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${currentLang}&retry=1`

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(currentLang, retryUrl)}>
    <Play>${escapeXml(promptAudio)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(retryUrl)}</Redirect>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    const turn = await processPhoneAgentTurn({
      callSid,
      storeId,
      userText,
      source: 'twilio',
      callerNumber: params.From || null,
      toNumber: params.To || null,
      forwardedFrom: params.ForwardedFrom || null,
      preferredLang: currentLang,
      deferDbFlush: true
    })

    const { firstChunk, restChunk } = splitPhoneReplyForStreaming(turn.replyText)
    // NO sintetizar firstChunk aquí (Twilio solicita /api/phone/tts para firstChunk ~50ms después: evitar doble llamada TTS).
    // En background: guardar el turno en DB y pre-generar + subir restChunk si la respuesta tiene 2 partes.
    scheduleBackgroundTask(async () => {
      await Promise.all([
        turn.flushDbPromise || Promise.resolve(),
        restChunk
          ? getPhoneAgentSpeech(restChunk, turn.language, turn.voiceId, false, { awaitStoragePersist: true })
          : Promise.resolve(null)
      ])
    })

    const firstAudioUrl = buildPhoneTtsUrl(baseUrl, firstChunk, turn.language, turn.voiceId)
    const restAudioUrl = restChunk ? buildPhoneTtsUrl(baseUrl, restChunk, turn.language, turn.voiceId) : null
    const playTags = restAudioUrl
      ? `    <Play>${escapeXml(firstAudioUrl)}</Play>\n    <Play>${escapeXml(restAudioUrl)}</Play>`
      : `    <Play>${escapeXml(firstAudioUrl)}</Play>`

    if (turn.shouldTransferToPhone) {
      const ringTimeout = Math.min(45, Math.max(10, Number(ctx.config.ring_timeout_seconds) || 20))
      const dialFallbackUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${turn.language}&dialFallback=1`
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${playTags}
  <Dial timeout="${ringTimeout}" action="${escapeXml(dialFallbackUrl)}" method="POST">${escapeXml(turn.shouldTransferToPhone)}</Dial>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    if (turn.shouldHangup) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${playTags}
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    const nextRespondUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${turn.language}`

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(turn.language, nextRespondUrl)}>
${playTags}
  </Gather>
  <Redirect method="POST">${escapeXml(nextRespondUrl)}&amp;silence=1</Redirect>
</Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
    )
  } catch (err: any) {
    console.error('[api/phone/respond] Error:', err)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">Disculpa, tuvimos un inconveniente técnico. Puedes consultar toda nuestra información en tacosgavilan punto com.</Say>
</Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
    )
  }
}
