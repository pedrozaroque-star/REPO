/**
 * @module api/phone/respond
 * @description Webhook de continuación de conversación de Twilio (`POST /api/phone/respond`).
 * Recibe `SpeechResult` o `Digits` desde `<Gather>`, ejecuta `processPhoneAgentTurn()` con herramientas en vivo,
 * y responde con TwiML que reproduce la voz neuronal `Kore` (`<Play>`), transfiere al gerente (`<Dial>`) o finaliza (`<Hangup>`).
 *
 * @businessRules
 * - Valida la firma `X-Twilio-Signature`.
 * - Si el usuario presionó dígitos (`Digits`), traduce atajos rápidos: `1` = Horarios y Dirección, `2` = Fiesta Platters,
 *   `3` = Hablar con el gerente / Dejar recado, `9` = Cambiar a Inglés/Español.
 *
 * @dataFlow
 * - Twilio `<Gather>` -> `POST /api/phone/respond` -> `processPhoneAgentTurn()` -> TwiML (`<Play>` + `<Gather>` / `<Dial>` / `<Hangup>`).
 *
 * @notes
 * - Incluye protección contra silencios prolongados (`retry=1`) para no cortar la llamada al primer silencio.
 */

import {
  escapeXml,
  PhoneLang,
  processPhoneAgentTurn,
  verifyTwilioWebhookSignature
} from '@/lib/phone-agent'
import { getPhoneAgentSpeech, splitPhoneReplyForStreaming } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function translateDtmfToText(digits: string, lang: PhoneLang): string {
  switch (digits.trim()) {
    case '1':
      return lang === 'en' ? 'What are your hours today and what is the address?' : '¿Cuál es el horario de hoy y la dirección?'
    case '2':
      return lang === 'en' ? 'Tell me about Fiesta Platters and prices.' : '¿Cuáles son los precios y tamaños de las charolas Fiesta Platter?'
    case '3':
      return lang === 'en' ? 'I need to leave a message for the store manager.' : 'Necesito dejarle un recado urgente al gerente de la sucursal.'
    case '9':
      return lang === 'en' ? 'Quiero hablar en español por favor.' : 'I would like to speak in English please.'
    default:
      return ''
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
    const proto = request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '')
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || reqUrl.host
    const baseUrl = `${proto}://${host}`

    const storeId = Number(reqUrl.searchParams.get('storeId') || 14)
    const currentLang = (reqUrl.searchParams.get('lang') === 'en' ? 'en' : 'es') as PhoneLang
    const isRetry = reqUrl.searchParams.get('retry') === '1'

    const callSid = params.CallSid || `TWILIO_${Date.now()}`
    const speechResult = (params.SpeechResult || '').trim()
    const digits = (params.Digits || '').trim()
    const userText = speechResult || (digits ? translateDtmfToText(digits, currentLang) : '')

    if (!userText) {
      if (isRetry) {
        const goodbyeText =
          currentLang === 'en'
            ? 'We did not hear a response. Thank you for calling Tacos Gavilan, have a great day!'
            : 'No alcanzamos a escucharte. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!'
        const goodbyeAudio = `${baseUrl}/api/phone/tts?lang=${currentLang}&voice=Kore&text=${encodeURIComponent(goodbyeText)}`
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Play>${escapeXml(goodbyeAudio)}</Play>\n  <Hangup/>\n</Response>`,
          { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
        )
      }

      const promptAgain =
        currentLang === 'en'
          ? 'Are you still there? You can ask me about our hours, menu prices, Fiesta Platters, or leave a message for the manager.'
          : '¿Sigues en la línea? Puedes preguntarme por nuestro horario, precios del menú, charolas para fiestas o dejarle un recado al gerente.'
      const promptAudio = `${baseUrl}/api/phone/tts?lang=${currentLang}&voice=Kore&text=${encodeURIComponent(promptAgain)}`
      const nextUrl = `${baseUrl}/api/phone/respond?storeId=${storeId}&lang=${currentLang}`
      const gatherLang = currentLang === 'en' ? 'en-US' : 'es-US'

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech dtmf" language="${gatherLang}" speechTimeout="auto" action="${escapeXml(nextUrl)}" method="POST">
    <Play>${escapeXml(promptAudio)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(nextUrl)}&amp;retry=1</Redirect>
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
      preferredLang: digits === '9' ? (currentLang === 'en' ? 'es' : 'en') : undefined
    })

    const { firstChunk, restChunk } = splitPhoneReplyForStreaming(turn.replyText)
    // Pre-iniciar generación en paralelo de ambos fragmentos en RAM
    void getPhoneAgentSpeech(firstChunk, turn.language, turn.voiceId, false, { skipStorageLookup: true }).catch(() => null)
    if (restChunk) {
      void getPhoneAgentSpeech(restChunk, turn.language, turn.voiceId, false, { skipStorageLookup: true }).catch(() => null)
    }

    const firstAudioUrl = `${baseUrl}/api/phone/tts?lang=${turn.language}&voice=${encodeURIComponent(turn.voiceId)}&text=${encodeURIComponent(firstChunk)}`
    const restAudioUrl = restChunk
      ? `${baseUrl}/api/phone/tts?lang=${turn.language}&voice=${encodeURIComponent(turn.voiceId)}&text=${encodeURIComponent(restChunk)}`
      : null
    const playTags = restAudioUrl
      ? `    <Play>${escapeXml(firstAudioUrl)}</Play>\n    <Play>${escapeXml(restAudioUrl)}</Play>`
      : `    <Play>${escapeXml(firstAudioUrl)}</Play>`

    if (turn.shouldTransferToPhone) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${playTags}
  <Dial>${escapeXml(turn.shouldTransferToPhone)}</Dial>
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
    const gatherLang = turn.language === 'en' ? 'en-US' : 'es-US'

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech dtmf" language="${gatherLang}" speechTimeout="auto" action="${escapeXml(nextRespondUrl)}" method="POST">
${playTags}
  </Gather>
  <Redirect method="POST">${escapeXml(nextRespondUrl)}&amp;retry=1</Redirect>
</Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
    )
  } catch (err: any) {
    console.error('[api/phone/respond] Error:', err)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-MX">Disculpa, tuvimos un inconveniente técnico. Puedes consultar toda nuestra información en tacosgavilan punto com.</Say>
</Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
    )
  }
}
