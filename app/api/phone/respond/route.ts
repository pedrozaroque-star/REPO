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
 * - Todos los `<Gather input="speech dtmf">` usan `buildTwilioGatherAttrs()` (`speechTimeout` adaptativo `"1"` estándar / `"3"` paciente + `timeout` `"4"`/`"7"` vía `isPromptExpectingPhoneOrDetails`, `speechModel="phone_call"`/`"default"` + hints Tacos Gavilan).
 * - Optimización 2026-11-12: cero suplantación de Lynwood #14, `deferDbFlush: true`, tecla `9` concisa a mitad de llamada, DTMF `0`/no asignados seguros, `&retry=1` correcto tras silencio y rama muerta `<Dial>` eliminada definitivamente por política.
 * - Blindaje Cross-Lambda 2026-11-19: todas las respuestas `<Play>` (incluyendo dinámicas) persisten en Supabase Storage con `awaitStoragePersist: true` antes de emitir TwiML; `restChunk` solo emite `<Play>` cuando su síntesis y persistencia confirmaron éxito (de lo contrario emite `<Say>` Google Chirp3-HD-Kore, cero drops 502 silenciosos); presupuesto TTS estrictamente acotado a `11.5s` de reloj; y respaldo de `TWILIO_WEBHOOK_BASE_URL`.
 * - Ultra-Velocidad Caché Storage 2026-11-19: cuando `turn.isCanonicalReply` o respuesta determinista corta (`<= 220` chars) sin `geminiFailed` es verdadero, `synthesizeRespondPlayOrFallback` y el flujo `<Play>` operan con `opts.dynamic = false` (`skipStorageLookup: false`) para servir la 2ª llamada en `~80 ms` directo desde `phone_v6/Kore/`.
 * - Retención Efímera 2026-11-20: los clips dinámicos irrepetibles (`isDynamic === true`, `dyn=1`) se guardan en `phone_v6_tmp/` (`ephemeral: true`) para que `/api/cron/retention-cleanup` los depure cada 24h, manteniendo intacto `phone_v6/` permanente para saludos y respuestas rápidas canónicas.
 */

import { after } from 'next/server'
import { formatCustomerGreetingTarget } from '@/lib/customer-store-names'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import {
  buildInitialGreeting,
  buildPhoneTtsUrl,
  buildTwilioFallbackSay,
  buildTwilioGatherAttrs,
  escapeXml,
  getPostDisclosurePrompt,
  getStorePhoneContext,
  isPromptExpectingPhoneOrDetails,
  PhoneLang,
  processPhoneAgentTurn,
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'
import { SUPABASE_PHONE_LIVE_BRIDGE_WSS_URL, signTwilioStreamParams } from '@/lib/phone-live-kore'
import { resolvePhoneCallerIdentity } from '@/lib/phone-caller-id'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getPhoneAgentSpeech,
  isPhoneSpeechInRamCache,
  resolvePhoneFemaleVoice,
  splitPhoneReplyForStreaming,
  VoiceId
} from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'sfo1'

function resolvePublicWebhookBaseUrl(request: Request): string {
  const envBase = (process.env.TWILIO_WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '')
  if (envBase) {
    try {
      const parsed = new URL(envBase)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin
      }
    } catch {
      // Ignorar TWILIO_WEBHOOK_BASE_URL malformada
    }
  }
  const reqUrl = new URL(request.url)
  const rawProto = (request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '')).split(',')[0].trim().toLowerCase()
  const proto = rawProto === 'http' || rawProto === 'https' ? rawProto : 'https'
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || reqUrl.host
  const host = rawHost.split(',')[0].trim()
  return `${proto}://${host}`
}

async function synthesizeRespondPlayOrFallback(
  baseUrl: string,
  text: string,
  lang: PhoneLang,
  voice: VoiceId,
  budgetMs: number,
  opts?: { dynamic?: boolean }
): Promise<{ tag: string; playedKore38: boolean }> {
  const isDynamic = Boolean(opts?.dynamic)
  const canTryTts = budgetMs >= 1200 || isPhoneSpeechInRamCache(text, lang, voice, isDynamic)
  if (!canTryTts) {
    return { tag: buildTwilioFallbackSay(text, lang), playedKore38: false }
  }
  try {
    await getPhoneAgentSpeech(text, lang, voice, false, {
      skipStorageLookup: isDynamic,
      skipStoragePersist: false,
      skipSseAttempt: false,
      ephemeral: isDynamic,
      fastLivePhone: true,
      awaitStoragePersist: true,
      maxTotalMs: Math.max(1200, budgetMs)
    })
    return {
      tag: `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, text, lang, voice, { rate: 8000, dynamic: isDynamic }))}</Play>`,
      playedKore38: true
    }
  } catch {
    return { tag: buildTwilioFallbackSay(text, lang), playedKore38: false }
  }
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
  const getRespondTtsBudgetMs = () => Math.max(0, Math.min(4500, 11500 - (Date.now() - reqStartMs)))
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
    const baseUrl = resolvePublicWebhookBaseUrl(request)

    const currentLang = (reqUrl.searchParams.get('lang') === 'en' ? 'en' : 'es') as PhoneLang
    const isRetry = reqUrl.searchParams.get('retry') === '1'
    const isTurn0 = reqUrl.searchParams.get('turn0') === '1'
    const isPreconsent = reqUrl.searchParams.get('preconsent') === '1'

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
      const { tag: disabledTag } = await synthesizeRespondPlayOrFallback(
        baseUrl,
        disabledMsg,
        currentLang,
        voice,
        getRespondTtsBudgetMs()
      )
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${disabledTag}
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
        const [discRes, qRes] = await Promise.all([
          synthesizeRespondPlayOrFallback(baseUrl, fullDisclosure, switchedLang, voice, switchBudgetMs),
          synthesizeRespondPlayOrFallback(baseUrl, postQuestion, switchedLang, voice, switchBudgetMs)
        ])
        const discTag = discRes.tag
        const qTag = qRes.tag

        scheduleBackgroundTask(async () => {
          const switchedTranscript = [{ role: 'assistant', text: fullGreeting, timestamp: new Date().toISOString() }]
          await Promise.all([
            !discRes.playedKore38
              ? getPhoneAgentSpeech(fullDisclosure, switchedLang, voice, false, {
                  skipSseAttempt: false,
                  awaitStoragePersist: true,
                  maxTotalMs: 12000
                }).catch(() => null)
              : Promise.resolve(),
            !qRes.playedKore38
              ? getPhoneAgentSpeech(postQuestion, switchedLang, voice, false, {
                  skipSseAttempt: false,
                  awaitStoragePersist: true,
                  maxTotalMs: 12000
                }).catch(() => null)
              : Promise.resolve(),
            (async () => {
              // Tolerar barge-in inmediato de tecla 9 antes de que /api/phone/incoming complete el upsert inicial
              const { data: updatedRows } = await supabaseAdmin
                .from('phone_calls')
                .update({
                  language: switchedLang,
                  transcript: switchedTranscript
                })
                .eq('call_sid', callSid)
                .eq('turns_count', 0)
                .select('id')
              if (!updatedRows || updatedRows.length === 0) {
                await supabaseAdmin.from('phone_calls').upsert(
                  {
                    call_sid: callSid,
                    store_id: storeId,
                    source: 'twilio',
                    caller_number: (params.From || '').trim() || null,
                    to_number: (params.To || '').trim() || null,
                    forwarded_from: (params.ForwardedFrom || '').trim() || null,
                    language: switchedLang,
                    status: 'in_progress',
                    resolved_by_ai: false,
                    turns_count: 0,
                    transcript: switchedTranscript,
                    business_date: getCaliforniaBusinessDate(),
                    shift: getCaliforniaShift()
                  },
                  { onConflict: 'call_sid', ignoreDuplicates: true }
                )
                await supabaseAdmin
                  .from('phone_calls')
                  .update({
                    language: switchedLang,
                    transcript: switchedTranscript
                  })
                  .eq('call_sid', callSid)
                  .eq('turns_count', 0)
              }
            })()
          ])
        })

        const streamTs = Date.now()
        const streamSig =
          process.env.PHONE_LIVE_BRIDGE_DISABLED === '1'
            ? ''
            : signTwilioStreamParams({ callSid, storeId, lang: switchedLang, ts: streamTs })
        const switchedLiveStreamBlock = streamSig
          ? `\n  <Connect>
    <Stream url="${escapeXml(SUPABASE_PHONE_LIVE_BRIDGE_WSS_URL)}">
      <Parameter name="callSid" value="${escapeXml(callSid)}" />
      <Parameter name="storeId" value="${storeId}" />
      <Parameter name="lang" value="${switchedLang}" />
      <Parameter name="callerNumber" value="${escapeXml((params.From || '').trim())}" />
      <Parameter name="callerName" value="${escapeXml((params.CallerName || '').trim())}" />
      <Parameter name="toNumber" value="${escapeXml((params.To || '').trim())}" />
      <Parameter name="forwardedFrom" value="${escapeXml((params.ForwardedFrom || '').trim())}" />
      <Parameter name="ts" value="${streamTs}" />
      <Parameter name="sig" value="${escapeXml(streamSig)}" />
    </Stream>
  </Connect>`
          : ''

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${discTag}${switchedLiveStreamBlock}
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

      const { tag: switchTag, playedKore38: switchPlayedKore38 } = await synthesizeRespondPlayOrFallback(
        baseUrl,
        conciseSwitchReply,
        switchedLang,
        voice,
        getRespondTtsBudgetMs()
      )

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
      const [cipaRes, postQRes] = await Promise.all([
        synthesizeRespondPlayOrFallback(baseUrl, mandatoryCipaSentence, currentLang, voice, cipaBudgetMs),
        synthesizeRespondPlayOrFallback(baseUrl, postQ, currentLang, voice, cipaBudgetMs)
      ])
      const cipaPlayTag = cipaRes.tag
      const qPlayTag = postQRes.tag
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
      const { tag: invalidKeyTag } = await synthesizeRespondPlayOrFallback(
        baseUrl,
        invalidKeyMsg,
        currentLang,
        voice,
        getRespondTtsBudgetMs()
      )
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
        const { tag: goodbyeTag } = await synthesizeRespondPlayOrFallback(
          baseUrl,
          goodbyeText,
          currentLang,
          voice,
          getRespondTtsBudgetMs()
        )

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
      const { tag: promptTag } = await synthesizeRespondPlayOrFallback(
        baseUrl,
        promptAgain,
        currentLang,
        voice,
        getRespondTtsBudgetMs()
      )
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

    const resolvedCaller = params.From
      ? await resolvePhoneCallerIdentity({
          phone: params.From,
          twilioCallerName: params.CallerName || null,
          allowTwilioLookup: false
        }).catch(() => null)
      : null
    const turn = await processPhoneAgentTurn({
      callSid,
      storeId,
      userText,
      source: 'twilio',
      callerNumber: params.From || null,
      callerName: resolvedCaller?.displayName || null,
      callerNameSource: resolvedCaller?.source || null,
      toNumber: params.To || null,
      forwardedFrom: params.ForwardedFrom || null,
      preferredLang: currentLang,
      deferDbFlush: true
    })

    // Solo dividir respuestas muy largas (> 220 chars); respuestas ágiles van en un solo <Play> vía synthesizeRespondPlayOrFallback
    // para eliminar pausas mudas entre oraciones y reutilizar al 100% la caché de Supabase Storage (~80 ms en la 2ª llamada).
    const { firstChunk, restChunk } =
      turn.replyText.length > 220
        ? splitPhoneReplyForStreaming(turn.replyText)
        : { firstChunk: turn.replyText, restChunk: null }

    const ttsBudgetMs = getRespondTtsBudgetMs()
    const isCacheableTurnAudio =
      !turn.geminiFailed &&
      Boolean(turn.isCanonicalReply || (turn.isDeterministicFastReply && turn.replyText.length <= 220))
    const isDynamicTurnAudio = !isCacheableTurnAudio
    const canTryFirstTts = ttsBudgetMs >= 1200 || isPhoneSpeechInRamCache(firstChunk, turn.language, turn.voiceId)

    let playTags: string
    let usedFirstChunkPlay = false
    let restSynthStatus: 'pending' | 'ready' | 'failed' = restChunk ? 'pending' : 'ready'
    let restSynthPromise: Promise<Buffer | null> | null = null

    if (!restChunk) {
      const singleRes = await synthesizeRespondPlayOrFallback(
        baseUrl,
        firstChunk,
        turn.language,
        turn.voiceId,
        ttsBudgetMs,
        { dynamic: isDynamicTurnAudio }
      )
      usedFirstChunkPlay = singleRes.playedKore38
      playTags = `    ${singleRes.tag}`
    } else if (canTryFirstTts) {
      const firstSynthPromise = getPhoneAgentSpeech(firstChunk, turn.language, turn.voiceId, false, {
        skipStorageLookup: isDynamicTurnAudio,
        // Persistir SIEMPRE en Supabase Storage (privado) y esperar confirmación acotada para que cualquier Lambda en /api/phone/tts acierte en caché;
        // si es dinámico irrepetible (`isDynamicTurnAudio`), va a `phone_v6_tmp/` (TTL 24h) en vez de `phone_v6/` permanente.
        skipStoragePersist: false,
        skipSseAttempt: false,
        ephemeral: isDynamicTurnAudio,
        fastLivePhone: true,
        awaitStoragePersist: true,
        maxTotalMs: Math.max(1200, ttsBudgetMs)
      })
      restSynthPromise = restChunk
        ? getPhoneAgentSpeech(restChunk, turn.language, turn.voiceId, false, {
            skipStorageLookup: isDynamicTurnAudio,
            skipStoragePersist: false,
            skipSseAttempt: false,
            ephemeral: isDynamicTurnAudio,
            fastLivePhone: true,
            awaitStoragePersist: true,
            maxTotalMs: Math.max(1200, Math.min(6200, ttsBudgetMs + 1600))
          })
            .then((wav) => {
              restSynthStatus = 'ready'
              return wav
            })
            .catch(() => {
              restSynthStatus = 'failed'
              return null
            })
        : null

      try {
        await firstSynthPromise
        usedFirstChunkPlay = true
        if (restSynthPromise && restSynthStatus === 'pending') {
          const restWaitMs = Math.min(1800, Math.max(0, 11500 - (Date.now() - reqStartMs)))
          if (restWaitMs > 50) {
            await Promise.race([restSynthPromise, new Promise<null>((r) => setTimeout(() => r(null), restWaitMs))])
          }
        }
        const firstAudioUrl = buildPhoneTtsUrl(baseUrl, firstChunk, turn.language, turn.voiceId, {
          rate: 8000,
          dynamic: isDynamicTurnAudio
        })
        if (restChunk) {
          if (restSynthStatus === 'ready') {
            const restAudioUrl = buildPhoneTtsUrl(baseUrl, restChunk, turn.language, turn.voiceId, {
              rate: 8000,
              dynamic: isDynamicTurnAudio
            })
            playTags = `    <Play>${escapeXml(firstAudioUrl)}</Play>\n    <Play>${escapeXml(restAudioUrl)}</Play>`
          } else {
            // Nunca emitir <Play> para un restChunk que falló o no confirmó Storage; ceder a Google Chirp3-HD-Kore <Say> (cero silencio 502)
            playTags = `    <Play>${escapeXml(firstAudioUrl)}</Play>\n    ${buildTwilioFallbackSay(restChunk, turn.language)}`
          }
        } else {
          playTags = `    <Play>${escapeXml(firstAudioUrl)}</Play>`
        }
      } catch {
        playTags = `    ${buildTwilioFallbackSay(turn.replyText, turn.language)}`
      }
    } else {
      playTags = `    ${buildTwilioFallbackSay(turn.replyText, turn.language)}`
    }

    scheduleBackgroundTask(async () => {
      await Promise.all([
        (turn.flushDbPromise || Promise.resolve()).catch((err) => {
          console.error('[api/phone/respond] Error en flushDbPromise diferido:', err?.message || err)
        }),
        !usedFirstChunkPlay && !isDynamicTurnAudio
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
