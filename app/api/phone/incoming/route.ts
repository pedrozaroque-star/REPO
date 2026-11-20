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
 * - Cachea el mapa de teléfonos de las 15 sucursales (60 s TTL), usa `buildTwilioGatherAttrs` (`speechTimeout` adaptativo `"1"` estándar / `"3"` paciente, `speechModel="phone_call"`/`"default"`
 *   + `hints`), `<Gather input="dtmf" numDigits="1" timeout="1">` válido (sin Error 13313 por `timeout="0"`), vía rápida SSE `fastLivePhone: true`, respaldo de emergencia `<Say>` exclusivamente con `Google.es-US-Chirp3-HD-Kore` / `Google.en-US-Chirp3-HD-Kore` (cero Amazon Polly)
 *   y coordina atómicamente el `upsert` inicial de `phone_calls` (`ignoreDuplicates: true` + backfill seguro de `transcript`)
 *   para no perder cierres rápidos de `/api/phone/status` ni barge-in inmediato de tecla `9`.
 */

import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { getPhoneAgentSpeech, isPhoneSpeechInRamCache, resolvePhoneFemaleVoice, VoiceId } from '@/lib/order-ready-tts'
import { formatCustomerGreetingTarget } from '@/lib/customer-store-names'
import {
  buildInitialGreeting,
  buildPhoneTtsUrl,
  buildTwilioFallbackSay,
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
import { SUPABASE_PHONE_LIVE_BRIDGE_WSS_URL, signTwilioStreamParams } from '@/lib/phone-live-kore'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'sfo1'

function normalizeDigits10(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

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

async function synthesizeIncomingPlayOrFallback(
  baseUrl: string,
  text: string,
  lang: PhoneLang,
  voice: VoiceId,
  budgetMs: number
): Promise<{ tag: string; playedKore38: boolean }> {
  const canTryTts = budgetMs >= 1200 || isPhoneSpeechInRamCache(text, lang, voice)
  if (!canTryTts) {
    return { tag: buildTwilioFallbackSay(text, lang), playedKore38: false }
  }
  try {
    await getPhoneAgentSpeech(text, lang, voice, false, {
      skipSseAttempt: false,
      fastLivePhone: true,
      awaitStoragePersist: true,
      maxTotalMs: Math.max(1200, budgetMs)
    })
    return {
      tag: `<Play>${escapeXml(buildPhoneTtsUrl(baseUrl, text, lang, voice))}</Play>`,
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

export async function POST(request: Request) {
  const reqStartMs = Date.now()
  const getIncomingTtsBudgetMs = () => Math.max(0, Math.min(7500, 11000 - (Date.now() - reqStartMs)))
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
      const { tag: unassignedTag } = await synthesizeIncomingPlayOrFallback(
        baseUrl,
        unassignedMsg,
        'es',
        'Kore',
        getIncomingTtsBudgetMs()
      )
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
      const { tag: disabledTag, playedKore38: disabledPlayedKore38 } = await synthesizeIncomingPlayOrFallback(
        baseUrl,
        disabledMsg,
        lang,
        voice,
        getIncomingTtsBudgetMs()
      )
      scheduleBackgroundTask(async () => {
        await Promise.all([
          !disabledPlayedKore38
            ? getPhoneAgentSpeech(disabledMsg, lang, voice, false, {
                skipSseAttempt: false,
                awaitStoragePersist: true,
                maxTotalMs: 12000
              }).catch(() => null)
            : Promise.resolve(),
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

    const greetingBudgetMs = getIncomingTtsBudgetMs()
    const [discRes, qRes] = await Promise.all([
      synthesizeIncomingPlayOrFallback(baseUrl, disclosureOnlyText, lang, voice, greetingBudgetMs),
      synthesizeIncomingPlayOrFallback(baseUrl, questionOnlyText, lang, voice, greetingBudgetMs)
    ])
    const disclosureTag = discRes.tag
    const questionTag = qRes.tag

    // Dar una breve ventana (<=350ms) para que el insert inicial concluya antes de enviar TwiML y evitar carrera con tecla 9 inmediata
    await Promise.race([initialCallPersistPromise, new Promise<void>((r) => setTimeout(r, 350))])

    scheduleBackgroundTask(async () => {
      await Promise.all([
        initialCallPersistPromise,
        !discRes.playedKore38
          ? getPhoneAgentSpeech(disclosureOnlyText, lang, voice, false, {
              skipSseAttempt: false,
              awaitStoragePersist: true,
              maxTotalMs: 12000
            }).catch(() => null)
          : Promise.resolve(),
        !qRes.playedKore38
          ? getPhoneAgentSpeech(questionOnlyText, lang, voice, false, {
              skipSseAttempt: false,
              awaitStoragePersist: true,
              maxTotalMs: 12000
            }).catch(() => null)
          : Promise.resolve(),
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
    // El primer <Gather input="dtmf" numDigits="1" timeout="1"> escucha ÚNICAMENTE tonos de teclado (tecla 9 tras "For English, press nine.")
    // con CERO captura de voz (0 speech). timeout="1" es el entero positivo mínimo válido en Twilio (evita Error 13313 y su fallback de 5s de silencio).
    const respondUrl = `${baseUrl}/api/phone/respond?storeId=${store.id}&lang=${lang}&turn0=1`
    const streamTs = Date.now()
    const streamSig =
      process.env.PHONE_LIVE_BRIDGE_DISABLED === '1'
        ? ''
        : signTwilioStreamParams({ callSid, storeId: store.id, lang, ts: streamTs })
    const liveStreamBlock = streamSig
      ? `\n  <Connect>
    <Stream url="${escapeXml(SUPABASE_PHONE_LIVE_BRIDGE_WSS_URL)}">
      <Parameter name="callSid" value="${escapeXml(callSid)}" />
      <Parameter name="storeId" value="${store.id}" />
      <Parameter name="lang" value="${lang}" />
      <Parameter name="callerNumber" value="${escapeXml(fromNumber)}" />
      <Parameter name="toNumber" value="${escapeXml(toNumber)}" />
      <Parameter name="forwardedFrom" value="${escapeXml(forwardedFrom)}" />
      <Parameter name="ts" value="${streamTs}" />
      <Parameter name="sig" value="${escapeXml(streamSig)}" />
    </Stream>
  </Connect>`
      : ''

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="1" action="${escapeXml(respondUrl)}&amp;preconsent=1" method="POST">
    ${disclosureTag}
  </Gather>${liveStreamBlock}
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
  ${buildTwilioFallbackSay('Gracias por llamar a Tacos Gavilan. Por favor visita tacosgavilan punto com para consultar nuestro menú y horarios.', 'es')}
  <Hangup/>
</Response>`
    return new Response(fallbackTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    })
  }
}
