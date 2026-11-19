/**
 * @module api/phone/respond
 * @description Webhook de continuación de conversación de Twilio (`POST /api/phone/respond`).
 * Recibe `SpeechResult` o `Digits` desde `<Gather>`, ejecuta `processPhoneAgentTurn()` con herramientas en vivo,
 * y responde con TwiML que reproduce la voz neuronal configurada (`<Play>`) o finaliza (`<Hangup>`).
 *
 * @businessRules
 * - Valida la firma criptográfica `X-Twilio-Signature`.
 * - Blindaje CIPA inquebrantable (\`preconsent=1\`): si el usuario presiona \`9\` cambia de idioma y escucha el aviso CIPA completo
 *   en el nuevo idioma antes de habilitar \`input="speech"\`; si presiona cualquier otra tecla durante el aviso inicial, reproduce
 *   el aviso legal completo sin interrupción antes de abrir el micrófono.
 * - Tecla \`9\` a mitad de llamada cambia de idioma de inmediato con confirmación ágil en el nuevo idioma (sin repetir el aviso CIPA inicial).
 * - Flujo de silencio en 2 pasos reales (\`silence=1\` -> pregunta \`"¿Sigues en la línea?"\` -> \`retry=1\` -> cierra llamada en DB + \`<Hangup/>\`).
 * - Toda escalación con el gerente registra una Alerta Prioritaria en la PC de la sucursal (`/order-ready-board` y `/admin/llamadas`),
 *   sin desviar ni transferir llamadas a teléfonos personales de los gerentes (`<Dial>` deshabilitado permanentemente por política).
 *
 * @dataFlow
 * - Twilio `<Gather>` -> `POST /api/phone/respond` -> `processPhoneAgentTurn()` -> TwiML.
 *
 * @notes
 * - Todos los `<Gather input="speech dtmf">` usan `buildTwilioGatherAttrs()` (`speechTimeout` adaptativo `"1"` estándar / `"3"` paciente + `timeout` `"4"`/`"8"` vía `isPromptExpectingPhoneOrDetails`, `speechModel="telephony"` + hints Tacos Gavilan).
 * - Optimización 2026-11-12: cero suplantación de Lynwood #14, `deferDbFlush: true`, cero doble TTS sobre `firstChunk` (solo pre-calienta `restChunk` en `after()`),
 *   tecla `9` concisa a mitad de llamada, DTMF `0`/no asignados seguros, `&retry=1` correcto tras silencio y rama defensiva heredada `<Dial>` desactivada por política.
 * - Auditoría 2026-11-18: respaldo `<Say>` con `Google.es-US-Chirp3-HD-Kore` / `Google.en-US-Chirp3-HD-Kore` (cero Amazon Polly), vía rápida SSE `fastLivePhone: true` en vivo, respuestas cortas sin dividir `<= 210` chars (cero pausas mudas entre oraciones) o síntesis paralela si excede `210`, y paciencia adaptativa para dictado de teléfonos.
 */

import { after } from 'next/server'
import { formatCustomerGreetingTarget, formatCustomerStoreName } from '@/lib/customer-store-names'
import {
  buildInitialGreeting,
  buildPhoneTtsUrl,
  buildTwilioFallbackSay,
  buildTwilioGatherAttrs,
  cleanPhoneStoreName,
  escapeXml,
  getPostDisclosurePrompt,
  getStorePhoneContext,
  isPromptExpectingPhoneOrDetails,
  PhoneLang,
  processPhoneAgentTurn,
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'
import { supabaseAdmin } from '@/lib/supabase'
import { getPhoneAgentSpeech, resolvePhoneFemaleVoice, splitPhoneReplyForStreaming, VoiceId } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'sfo1'

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
    try {
      const { data: callRow } = await supabaseAdmin
        .from('phone_calls')
        .select('store_id')
        .eq('call_sid', callSid)
        .maybeSingle()
      const realStoreId = Number(callRow?.store_id)
      if (Number.isFinite(realStoreId) && realStoreId > 0) {
        return await getStorePhoneContext(realStoreId)
      }
    } catch {
      return null
    }
  }
  return null
}

export async function POST(request: Request) {
  const reqStartMs = Date.now()
  const getRespondTtsBudgetMs = () => Math.max(3000, Math.min(3900, 10500 - (Date.now() - reqStartMs)))
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
    const isTurn0 = reqUrl.searchParams.get('turn0') === '1'
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
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${buildTwilioFallbackSay(errMsg, currentLang)}
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    const storeId = ctx.store.id
    const voice: VoiceId = resolvePhoneFemaleVoice(ctx.config.voice_id)

    if (!ctx.config.is_enabled && isTurn0) {
      const greetingTarget = formatCustomerGreetingTarget(ctx.store, currentLang) || ctx.store.name
      const disabledMsg =
        currentLang === 'en'
          ? `Thank you for calling Tacos Gavilan ${greetingTarget}. ${ctx.scheduleEval.statusMessageEn} You can also order online at tacosgavilan.com.`
          : `Gracias por llamar a Tacos Gavilan ${greetingTarget}. ${ctx.scheduleEval.statusMessageEs} También puedes ordenar en línea en tacosgavilan.com.`
      let disabledTag = buildTwilioFallbackSay(disabledMsg, currentLang)
      try {
        await getPhoneAgentSpeech(disabledMsg, currentLang, voice, false, {
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: getRespondTtsBudgetMs()
        })
        disabledTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, disabledMsg, currentLang, voice))}</Play>`
      } catch {
        // Fallback seguro a Google Chirp3-HD-Kore <Say> si TTS falla
      }
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${disabledTag}
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    // Respaldo post-<Dial>: si el gerente contestó, cerramos limpio; si estaba ocupado o no alcanzó a contestar en 20s,
    // confirmamos al cliente que su alerta prioritaria ya está en la pantalla del gerente y cerramos con calidez.
    if (isDialFallback) {
      const dialStatus = (params.DialCallStatus || '').trim().toLowerCase()
      const dialDuration = Number(params.DialCallDuration || 0)
      const answeredBy = (params.AnsweredBy || '').trim().toLowerCase()

      const answeredLive =
        (dialStatus === 'completed' || dialStatus === 'answered') &&
        dialDuration >= 12 &&
        !answeredBy.includes('machine') &&
        !answeredBy.includes('fax')
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

      const spokenStore = formatCustomerStoreName(ctx.store, currentLang, { style: 'spoken_compact' }) || cleanPhoneStoreName(ctx.store.name) || ctx.store.name
      const fallbackMsg =
        currentLang === 'en'
          ? `Our ${spokenStore} manager is assisting guests at the counter right now, so your priority alert is saved on their screen and they will reach out to you as soon as possible. Thank you for calling Tacos Gavilan!`
          : `En este instante el gerente de ${spokenStore} está atendiendo en mostrador, pero tu alerta prioritaria ya quedó activa en su pantalla y se comunicará contigo en cuanto sea posible. ¡Gracias por llamar a Tacos Gavilan!`

      await supabaseAdmin
        .from('phone_calls')
        .update({
          status: 'callback_requested',
          resolved_by_ai: false,
          ended_at: new Date().toISOString()
        })
        .eq('call_sid', callSid)

      let dialFallbackTag = buildTwilioFallbackSay(fallbackMsg, currentLang)
      try {
        await getPhoneAgentSpeech(fallbackMsg, currentLang, voice, false, {
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: getRespondTtsBudgetMs()
        })
        dialFallbackTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, fallbackMsg, currentLang, voice))}</Play>`
      } catch {
        // Fallback seguro a Google Chirp3-HD-Kore <Say> para no devolver error en <Play> si TTS falla
      }

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${dialFallbackTag}
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    // Cambio de idioma con tecla 9:
    // - En turno inicial (`turn0=1`): reproduce el aviso legal CIPA completo + estado abierto/cerrado en el nuevo idioma antes de escuchar voz.
    // - A mitad de llamada: confirma brevemente y continúa sin repetir todo el aviso inicial.
    if (digits === '9') {
      const switchedLang: PhoneLang = currentLang === 'en' ? 'es' : 'en'
      const nextUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${switchedLang}`

      if (isTurn0) {
        const fullDisclosure = buildInitialGreeting(
          ctx.store.name,
          switchedLang,
          ctx.config.custom_greeting_es,
          ctx.config.custom_greeting_en,
          { omitTrailingQuestion: true, includeLanguageSwitchHint: false }
        )
        const postQuestion = getPostDisclosurePrompt(switchedLang, ctx.scheduleEval)
        const fullGreeting = buildInitialGreeting(
          ctx.store.name,
          switchedLang,
          ctx.config.custom_greeting_es,
          ctx.config.custom_greeting_en,
          { includeLanguageSwitchHint: false, scheduleEval: ctx.scheduleEval }
        )

        const switchBudgetMs = getRespondTtsBudgetMs()
        const [discRes, qRes] = await Promise.allSettled([
          getPhoneAgentSpeech(fullDisclosure, switchedLang, voice, false, {
            skipSseAttempt: false,
            fastLivePhone: true,
            awaitStoragePersist: true,
            maxTotalMs: switchBudgetMs
          }),
          getPhoneAgentSpeech(postQuestion, switchedLang, voice, false, {
            skipSseAttempt: false,
            fastLivePhone: true,
            awaitStoragePersist: true,
            maxTotalMs: switchBudgetMs
          })
        ])
        const discTag =
          discRes.status === 'fulfilled'
            ? `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, fullDisclosure, switchedLang, voice))}</Play>`
            : buildTwilioFallbackSay(fullDisclosure, switchedLang)
        const qTag =
          qRes.status === 'fulfilled'
            ? `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, postQuestion, switchedLang, voice))}</Play>`
            : buildTwilioFallbackSay(postQuestion, switchedLang)

        scheduleBackgroundTask(async () => {
          await Promise.all([
            discRes.status !== 'fulfilled'
              ? getPhoneAgentSpeech(fullDisclosure, switchedLang, voice, false, {
                  skipSseAttempt: false,
                  awaitStoragePersist: true,
                  maxTotalMs: 12000
                }).catch(() => null)
              : Promise.resolve(),
            qRes.status !== 'fulfilled'
              ? getPhoneAgentSpeech(postQuestion, switchedLang, voice, false, {
                  skipSseAttempt: false,
                  awaitStoragePersist: true,
                  maxTotalMs: 12000
                }).catch(() => null)
              : Promise.resolve(),
            supabaseAdmin
              .from('phone_calls')
              .update({
                language: switchedLang,
                transcript: [{ role: 'assistant', text: fullGreeting, timestamp: new Date().toISOString() }]
              })
              .eq('call_sid', callSid)
              .eq('turns_count', 0)
          ])
        })

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${discTag}
  <Gather ${buildTwilioGatherAttrs(switchedLang, nextUrl)}>
    ${qTag}
  </Gather>
  <Redirect method="POST">${escapeXml(nextUrl)}&amp;silence=1</Redirect>
</Response>`,
          { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
        )
      }

      const conciseSwitchReply =
        switchedLang === 'en'
          ? 'Of course, we can continue in English! How can I help you today?'
          : 'Con gusto continuamos en español. ¿En qué te ayudo hoy?'

      let switchTag = buildTwilioFallbackSay(conciseSwitchReply, switchedLang)
      let switchPlayedKore38 = false
      try {
        await getPhoneAgentSpeech(conciseSwitchReply, switchedLang, voice, false, {
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: getRespondTtsBudgetMs()
        })
        switchTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, conciseSwitchReply, switchedLang, voice))}</Play>`
        switchPlayedKore38 = true
      } catch {
        // Fallback seguro a Google Chirp3-HD-Kore <Say>
      }

      scheduleBackgroundTask(async () => {
        const [{ data: existingCall }] = await Promise.all([
          supabaseAdmin.from('phone_calls').select('id, transcript, turns_count').eq('call_sid', callSid).maybeSingle(),
          !switchPlayedKore38
            ? getPhoneAgentSpeech(conciseSwitchReply, switchedLang, voice, false, {
                skipSseAttempt: false,
                awaitStoragePersist: true,
                maxTotalMs: 12000
              }).catch(() => null)
            : Promise.resolve()
        ])
        if (existingCall) {
          const prevTr = Array.isArray(existingCall.transcript) ? existingCall.transcript : []
          await supabaseAdmin
            .from('phone_calls')
            .update({
              language: switchedLang,
              turns_count: Number(existingCall.turns_count || 0),
              transcript: [
                ...prevTr,
                { role: 'user', text: '9', timestamp: new Date().toISOString() },
                { role: 'assistant', text: conciseSwitchReply, timestamp: new Date().toISOString() }
              ]
            })
            .eq('id', existingCall.id)
        }
      })

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(switchedLang, nextUrl)}>
    ${switchTag}
  </Gather>
  <Redirect method="POST">${escapeXml(nextUrl)}&amp;silence=1</Redirect>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    // Si el usuario oprimió una tecla distinta de 9 durante el aviso inicial (`preconsent=1`),
    // reproducir sin interrupción la frase legal de transcripción antes de abrir captura de voz (`input="speech"`).
    if (isPreconsent && digits && digits !== '9') {
      const mandatoryCipaSentence =
        currentLang === 'en'
          ? "You're speaking with our virtual assistant on a transcribed line."
          : 'Hablas con nuestra asistente virtual en una llamada transcrita para atenderte.'
      const postQ = getPostDisclosurePrompt(currentLang, ctx.scheduleEval)
      const nextUrlAfterConsent = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${currentLang}${isTurn0 ? '&turn0=1' : ''}`
      const cipaBudgetMs = getRespondTtsBudgetMs()
      const [cipaRes, postQRes] = await Promise.allSettled([
        getPhoneAgentSpeech(mandatoryCipaSentence, currentLang, voice, false, {
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: cipaBudgetMs
        }),
        getPhoneAgentSpeech(postQ, currentLang, voice, false, {
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: cipaBudgetMs
        })
      ])
      const cipaPlayTag =
        cipaRes.status === 'fulfilled'
          ? `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, mandatoryCipaSentence, currentLang, voice))}</Play>`
          : buildTwilioFallbackSay(mandatoryCipaSentence, currentLang)
      const qPlayTag =
        postQRes.status === 'fulfilled'
          ? `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, postQ, currentLang, voice))}</Play>`
          : buildTwilioFallbackSay(postQ, currentLang)
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${cipaPlayTag}
  <Gather ${buildTwilioGatherAttrs(currentLang, nextUrlAfterConsent)}>
    ${qPlayTag}
  </Gather>
  <Redirect method="POST">${escapeXml(nextUrlAfterConsent)}&amp;silence=1</Redirect>
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
      let invalidKeyTag = buildTwilioFallbackSay(invalidKeyMsg, currentLang)
      try {
        await getPhoneAgentSpeech(invalidKeyMsg, currentLang, voice, false, {
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: getRespondTtsBudgetMs()
        })
        invalidKeyTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, invalidKeyMsg, currentLang, voice))}</Play>`
      } catch {
        // Fallback seguro a Google Chirp3-HD-Kore <Say>
      }
      const nextUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${currentLang}${isTurn0 ? '&turn0=1' : ''}`
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(currentLang, nextUrl)}>
    ${invalidKeyTag}
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
        let goodbyeTag = buildTwilioFallbackSay(goodbyeText, currentLang)
        try {
          await getPhoneAgentSpeech(goodbyeText, currentLang, voice, false, {
            skipSseAttempt: false,
            fastLivePhone: true,
            awaitStoragePersist: true,
            maxTotalMs: getRespondTtsBudgetMs()
          })
          goodbyeTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, goodbyeText, currentLang, voice))}</Play>`
        } catch {
          // Fallback seguro a Google Chirp3-HD-Kore <Say>
        }

        const { data: existingCall } = await supabaseAdmin
          .from('phone_calls')
          .select('id, status, ended_at, turns_count')
          .eq('call_sid', callSid)
          .maybeSingle()

        if (existingCall) {
          const normExisting = String(existingCall.status || '').toLowerCase()
          const alreadyClosed =
            Boolean(existingCall.ended_at) ||
            ['completed', 'canceled', 'cancelled', 'busy', 'failed', 'no-answer'].includes(normExisting)
          if (!alreadyClosed) {
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
            await supabaseAdmin
              .from('phone_calls')
              .update(updateObj)
              .eq('id', existingCall.id)
              .is('ended_at', null)
          }
        }

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${goodbyeTag}\n  <Hangup/>\n</Response>`,
          { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
        )
      }

      const promptAgain =
        currentLang === 'en'
          ? 'Are you still there? You can ask me about our hours, menu prices, Fiesta Platters, or leave a message for the manager.'
          : '¿Sigues en la línea? Puedes preguntarme por nuestro horario, precios del menú, charolas para fiestas o dejarle un recado al gerente.'
      let promptTag = buildTwilioFallbackSay(promptAgain, currentLang)
      try {
        await getPhoneAgentSpeech(promptAgain, currentLang, voice, false, {
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: getRespondTtsBudgetMs()
        })
        promptTag = `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, promptAgain, currentLang, voice))}</Play>`
      } catch {
        // Fallback seguro a Google Chirp3-HD-Kore <Say>
      }
      const retryUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${currentLang}&retry=1${isTurn0 ? '&turn0=1' : ''}`

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(currentLang, retryUrl)}>
    ${promptTag}
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

    // Solo dividir respuestas muy largas (> 210 chars); respuestas ágiles van en un solo <Play> para eliminar
    // pausas mudas entre oraciones y evitar llamadas TTS duplicadas en tiempo real.
    const { firstChunk, restChunk } =
      turn.replyText.length > 210
        ? splitPhoneReplyForStreaming(turn.replyText)
        : { firstChunk: turn.replyText, restChunk: null }

    const ttsBudgetMs = getRespondTtsBudgetMs()
    const firstSynthPromise = getPhoneAgentSpeech(firstChunk, turn.language, turn.voiceId, false, {
      skipStorageLookup: false,
      skipStoragePersist: false,
      skipSseAttempt: false,
      fastLivePhone: true,
      awaitStoragePersist: true,
      maxTotalMs: ttsBudgetMs
    })
    const restSynthPromise = restChunk
      ? getPhoneAgentSpeech(restChunk, turn.language, turn.voiceId, false, {
          skipStorageLookup: false,
          skipStoragePersist: false,
          skipSseAttempt: false,
          fastLivePhone: true,
          awaitStoragePersist: true,
          maxTotalMs: ttsBudgetMs + 1500
        }).catch(() => null)
      : null

    let playTags: string
    let usedFirstChunkPlay = false
    try {
      await firstSynthPromise
      usedFirstChunkPlay = true
      if (restSynthPromise) {
        // Esperar brevemente a que termine la síntesis paralela de restChunk para garantizar reproducción continua
        await Promise.race([restSynthPromise, new Promise<null>((r) => setTimeout(() => r(null), 1200))])
      }
      const firstAudioUrl = buildPhoneTtsUrl(baseUrl, firstChunk, turn.language, turn.voiceId, {
        rate: 8000,
        dynamic: false
      })
      const restAudioUrl = restChunk
        ? buildPhoneTtsUrl(baseUrl, restChunk, turn.language, turn.voiceId, { rate: 8000, dynamic: false })
        : null
      playTags = restAudioUrl
        ? `    <Play>${escapeXml(firstAudioUrl)}</Play>\n    <Play>${escapeXml(restAudioUrl)}</Play>`
        : `    <Play>${escapeXml(firstAudioUrl)}</Play>`
    } catch {
      playTags = `    ${buildTwilioFallbackSay(turn.replyText, turn.language)}`
    }

    scheduleBackgroundTask(async () => {
      await Promise.all([
        (turn.flushDbPromise || Promise.resolve()).catch((err) => {
          console.error('[api/phone/respond] Error en flushDbPromise diferido:', err?.message || err)
        }),
        !usedFirstChunkPlay
          ? getPhoneAgentSpeech(firstChunk, turn.language, turn.voiceId, false, {
              skipStorageLookup: false,
              skipStoragePersist: false,
              skipSseAttempt: false,
              awaitStoragePersist: true,
              maxTotalMs: 11000
            }).catch(() => null)
          : Promise.resolve(),
        restSynthPromise ?? Promise.resolve()
      ])
    })

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
    const needsPatientGather = isPromptExpectingPhoneOrDetails(turn.replyText)

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather ${buildTwilioGatherAttrs(turn.language, nextRespondUrl, { patient: needsPatientGather })}>
${playTags}
  </Gather>
  <Redirect method="POST">${escapeXml(nextRespondUrl)}&amp;silence=1</Redirect>
</Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
    )
  } catch (err: any) {
    console.error('[api/phone/respond] Error:', err)
    const isEnReq = (() => {
      try {
        return new URL(request.url).searchParams.get('lang') === 'en'
      } catch {
        return false
      }
    })()
    const errSay = isEnReq
      ? buildTwilioFallbackSay(
          'Sorry, we had a brief technical issue. You can find all our menu and store hours at tacosgavilan dot com.',
          'en'
        )
      : buildTwilioFallbackSay(
          'Disculpa, tuvimos un inconveniente técnico. Puedes consultar toda nuestra información en tacosgavilan punto com.',
          'es'
        )
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${errSay}
  <Hangup/>
</Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
    )
  }
}
