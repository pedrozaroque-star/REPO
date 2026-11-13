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
 * - Cachea el mapa de teléfonos de las 15 sucursales (60 s TTL), usa `buildTwilioGatherAttrs` (`speechTimeout="1" speechModel="phone_call" enhanced="true"`
 *   + `hints`) y difiere el `upsert` inicial de `phone_calls` a `after()` junto con `awaitStoragePersist: true` en los clips de saludo.
 */

import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { getPhoneAgentSpeech, resolvePhoneFemaleVoice } from '@/lib/order-ready-tts'
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
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface RoutingDirectoryCacheEntry {
  fetchedAt: number
  configs: Array<{ store_id: number; twilio_phone_number: string | null }>
  activeStores: Array<{ id: number; phone: string | null; is_active: boolean | null }>
}

const ROUTING_DIR_TTL_MS = 60_000
let routingDirectoryCache: RoutingDirectoryCacheEntry | null = null

async function getRoutingDirectory(): Promise<RoutingDirectoryCacheEntry> {
  const now = Date.now()
  if (routingDirectoryCache && now - routingDirectoryCache.fetchedAt < ROUTING_DIR_TTL_MS) {
    return routingDirectoryCache
  }
  const [{ data: configs, error: cfgErr }, { data: stores, error: storeErr }] = await Promise.all([
    supabaseAdmin.from('phone_agent_config').select('store_id, twilio_phone_number'),
    supabaseAdmin.from('stores').select('id, phone, is_active')
  ])
  if ((cfgErr || storeErr) && routingDirectoryCache) {
    return routingDirectoryCache
  }
  const entry: RoutingDirectoryCacheEntry = {
    fetchedAt: now,
    configs: (configs || []) as Array<{ store_id: number; twilio_phone_number: string | null }>,
    activeStores: ((stores || []) as Array<{ id: number; phone: string | null; is_active: boolean | null }>).filter(
      (s) => s.is_active !== false
    )
  }
  routingDirectoryCache = entry
  return entry
}

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

async function resolveStoreFromCall(
  queryStoreId: string | null,
  toNumber: string,
  forwardedFrom: string
): Promise<{ storeId: number | null; matchedStorePhone: string | null }> {
  const { configs, activeStores } = await getRoutingDirectory()
  const storeById = new Map<number, any>(activeStores.map((s: any) => [Number(s.id), s]))

  if (queryStoreId && Number.isFinite(Number(queryStoreId))) {
    const candidate = Number(queryStoreId)
    const found = storeById.get(candidate)
    if (found) {
      return { storeId: candidate, matchedStorePhone: found.phone || null }
    }
  }

  const toDigits = normalizeDigits10(toNumber)
  if (toDigits && configs) {
    const matchByTwilio = configs.find(
      (c: any) => c.twilio_phone_number && normalizeDigits10(c.twilio_phone_number) === toDigits
    )
    if (matchByTwilio && storeById.has(Number(matchByTwilio.store_id))) {
      const s = storeById.get(Number(matchByTwilio.store_id))
      return { storeId: Number(matchByTwilio.store_id), matchedStorePhone: s?.phone || null }
    }
  }

  const fwdDigits = normalizeDigits10(forwardedFrom)
  if (fwdDigits) {
    const matchByForwarded = activeStores.find((s: any) => s.phone && normalizeDigits10(s.phone) === fwdDigits)
    if (matchByForwarded) {
      return { storeId: Number(matchByForwarded.id), matchedStorePhone: matchByForwarded.phone || null }
    }
  }

  return { storeId: null, matchedStorePhone: null }
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

    const { storeId, matchedStorePhone } = await resolveStoreFromCall(
      reqUrl.searchParams.get('storeId'),
      toNumber,
      forwardedFrom
    )

    // Si el número receptor de Twilio todavía no está vinculado a ninguna de las 15 tiendas, contestar sin suplantar otra tienda
    if (!storeId) {
      const unassignedMsg =
        'Gracias por llamar a Tacos Gavilan. Puedes consultar el menú, ubicación y horario en vivo de nuestras quince sucursales en tacosgavilan.com.'
      const unassignedAudio = buildPhoneTtsUrl(baseUrl, unassignedMsg, 'es', 'Kore')
      scheduleBackgroundTask(() => getPhoneAgentSpeech(unassignedMsg, 'es', 'Kore'))
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(unassignedAudio)}</Play>
  <Hangup/>
</Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
      )
    }

    const ctx = await getStorePhoneContext(storeId)
    const { store, config, scheduleEval } = ctx
    const lang: PhoneLang = (config.default_language === 'en' ? 'en' : 'es') as PhoneLang
    const voice = resolvePhoneFemaleVoice(config.voice_id)

    // Marcar desvío como verificado ÚNICAMENTE cuando `ForwardedFrom` coincide con el teléfono de esta sucursal (o venía explícito)
    const fwdDigits = normalizeDigits10(forwardedFrom)
    const storePhoneDigits = normalizeDigits10(matchedStorePhone || store.phone)
    if (
      fwdDigits.length === 10 &&
      config.forwarding_status !== 'verified' &&
      (!storePhoneDigits || fwdDigits === storePhoneDigits)
    ) {
      await supabaseAdmin
        .from('phone_agent_config')
        .update({
          forwarding_status: 'verified',
          forwarding_verified_at: new Date().toISOString()
        })
        .eq('store_id', store.id)
      invalidateStorePhoneContextCache(store.id)
    }

    if (!config.is_enabled) {
      const spokenStoreName = cleanPhoneStoreName(store.name) || store.name
      const disabledMsg =
        lang === 'en'
          ? `Thank you for calling Tacos Gavilan ${spokenStoreName}. ${scheduleEval.statusMessageEn} You can also order online at tacosgavilan.com.`
          : `Gracias por llamar a Tacos Gavilan sucursal ${spokenStoreName}. ${scheduleEval.statusMessageEs} También puedes ordenar en línea en tacosgavilan.com.`
      const ttsUrl = buildPhoneTtsUrl(baseUrl, disabledMsg, lang, voice)
      scheduleBackgroundTask(async () => {
        await Promise.all([
          getPhoneAgentSpeech(disabledMsg, lang, voice, false, { awaitStoragePersist: true }),
          supabaseAdmin.from('phone_calls').upsert(
            {
              call_sid: callSid,
              store_id: store.id,
              source: 'twilio',
              caller_number: fromNumber || null,
              to_number: toNumber || null,
              forwarded_from: forwardedFrom || null,
              language: lang,
              status: 'completed',
              resolved_by_ai: false,
              turns_count: 0,
              duration_seconds: 5,
              summary: `Contestadora apagada en sucursal (${spokenStoreName})`,
              transcript: [{ role: 'assistant', text: disabledMsg, timestamp: new Date().toISOString() }],
              business_date: getCaliforniaBusinessDate(),
              shift: getCaliforniaShift(),
              ended_at: new Date().toISOString()
            },
            { onConflict: 'call_sid' }
          )
        ])
      })

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

    // Pre-calentar en paralelo los dos clips de bienvenida (persistiendo en Storage) y registrar la llamada en `after()` sin frenar el primer <Play>
    scheduleBackgroundTask(async () => {
      await Promise.all([
        getPhoneAgentSpeech(disclosureOnlyText, lang, voice, false, { awaitStoragePersist: true }),
        getPhoneAgentSpeech(questionOnlyText, lang, voice, false, { awaitStoragePersist: true }),
        supabaseAdmin.from('phone_calls').upsert(
          {
            call_sid: callSid,
            store_id: store.id,
            source: 'twilio',
            caller_number: fromNumber || null,
            to_number: toNumber || null,
            forwarded_from: forwardedFrom || null,
            language: lang,
            status: 'in_progress',
            resolved_by_ai: false,
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
      ])
    })

    // REGLA CIPA CALIFORNIA (§§ 631, 632 y 632.7 — "Before Interception Rule"):
    // El aviso legal de IA + grabación/transcripción DEBE reproducirse completo SIN activar `input="speech"` (solo `dtmf`
    // por si oprimen 9 para cambiar de idioma). Recién al concluir el aviso legal se abre `<Gather input="speech dtmf">`.
    const disclosureAudioUrl = buildPhoneTtsUrl(baseUrl, disclosureOnlyText, lang, voice)
    const questionAudioUrl = buildPhoneTtsUrl(baseUrl, questionOnlyText, lang, voice)
    const preconsentUrl = `${baseUrl}/api/phone/respond?storeId=${store.id}&lang=${lang}&preconsent=1`
    const respondUrl = `${baseUrl}/api/phone/respond?storeId=${store.id}&lang=${lang}`

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="1" action="${escapeXml(preconsentUrl)}" method="POST">
    <Play>${escapeXml(disclosureAudioUrl)}</Play>
  </Gather>
  <Gather ${buildTwilioGatherAttrs(lang, respondUrl)}>
    <Play>${escapeXml(questionAudioUrl)}</Play>
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
</Response>`
    return new Response(fallbackTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    })
  }
}
