/**
 * @module api/phone/simulate
 * @description Endpoint interactivo con Streaming en Tiempo Real (NDJSON + PCM 24kHz) para el Simulador de Llamadas en `/admin/llamadas`.
 * Permite probar y demostrar cómo contesta la IA en cualquiera de las 15 sucursales de Tacos Gavilan usando el motor oficial
 * (`processPhoneAgentTurn`), herramientas reales en vivo y la misma voz neuronal `Kore 3.8`.
 *
 * @businessRules
 * - Control de acceso RBAC (`authorizePhoneModuleRequest`): `admin`/`supervisor` pueden simular las 15 tiendas;
 *   `manager`/`general_manager`/`asistente` únicamente su propia sucursal asignada.
 * - Aislamiento estricto `source = 'simulator'`: cualquier recado generado durante una prueba se guarda con `source = 'simulator'`
 *   en `phone_callback_requests`, por lo que JAMÁS enciende el banner rojo de emergencia en `/order-ready-board`.
 * - Soporta 4 acciones: `prewarm`, `start`, `turn` (con streaming NDJSON PCM 24kHz) y `end`.
 *
 * @dataFlow
 * - Simulador Web (`/admin/llamadas`) -> `POST /api/phone/simulate` (`stream: true`) -> NDJSON (`turn_meta` -> `audio_pcm`* -> `done`).
 *
 * @notes
 * - Restringido estrictamente a `callSid` con prefijo `SIM_`.
 * - Validación RBAC en una sola llamada, prewarm persistente en `after()`, validación de propiedad de `store_id` sobre `SIM_` `callSid` y Key 9 limpia antes o durante llamada.
 */

import { after, NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import {
  getPhoneAgentSpeech,
  resolvePhoneFemaleVoice,
  streamPhoneAgentSpeechPcm,
  VoiceId,
  warmPhoneSpeechFromStorageOnly
} from '@/lib/order-ready-tts'
import {
  buildInitialGreeting,
  buildPhoneTtsUrl,
  getStaticCanonicalWarmPhrases,
  getStorePhoneContext,
  loadStoreMenuItems,
  PhoneLang,
  processPhoneAgentTurn
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'sfo1'

const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no'
}

function createNdjsonStreamResponse(
  runner: (send: (obj: Record<string, any>) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder()
  let streamClosed = false
  const stream = new ReadableStream({
    cancel() {
      streamClosed = true
    },
    async start(controller) {
      const send = (obj: Record<string, any>) => {
        if (streamClosed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
        } catch {
          streamClosed = true
        }
      }
      try {
        await runner(send)
      } finally {
        if (!streamClosed) {
          streamClosed = true
          try {
            controller.close()
          } catch {
            // Ignorar cierre si el cliente abortó la conexión
          }
        }
      }
    }
  })
  return new Response(stream, { headers: STREAM_HEADERS })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 })
    }
    const action = String(body?.action || 'turn')
    const hasExplicitStoreId = body?.storeId !== undefined && body?.storeId !== null && body?.storeId !== ''
    const rawStoreId = Number(body?.storeId)
    if (hasExplicitStoreId && (!Number.isInteger(rawStoreId) || rawStoreId <= 0)) {
      return NextResponse.json({ error: 'storeId inválido' }, { status: 400 })
    }

    // Autorización RBAC en una sola llamada; luego validamos pertenencia exacta sobre storeId
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
    }

    const storeId = hasExplicitStoreId ? rawStoreId : auth.user.assignedStoreId || 14

    if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(storeId)) {
      return NextResponse.json(
        { error: `Acceso denegado: Tu cuenta solo tiene autorización sobre la sucursal #${auth.user.assignedStoreId}.` },
        { status: 403 }
      )
    }

    const lang: PhoneLang = body?.lang === 'en' ? 'en' : 'es'
    const voiceMode = String(body?.voiceMode || 'neural_turbo')
    const useStream = Boolean(body?.stream)

    if (action === 'prewarm') {
      const [ctx] = await Promise.all([getStorePhoneContext(storeId), loadStoreMenuItems(storeId)])
      const voiceId: VoiceId = resolvePhoneFemaleVoice(ctx.config.voice_id)
      const greetingText = buildInitialGreeting(
        ctx.store.name,
        lang,
        ctx.config.custom_greeting_es,
        ctx.config.custom_greeting_en,
        { scheduleEval: ctx.scheduleEval }
      )
      const switchedLang: PhoneLang = lang === 'en' ? 'es' : 'en'
      const conciseSwitch =
        switchedLang === 'en'
          ? 'Of course, we can continue in English! How can I help you today?'
          : 'Con gusto continuamos en español. ¿En qué te ayudo hoy?'
      const key9Greeting = buildInitialGreeting(
        ctx.store.name,
        switchedLang,
        ctx.config.custom_greeting_es,
        ctx.config.custom_greeting_en,
        { includeLanguageSwitchHint: false, scheduleEval: ctx.scheduleEval }
      )
      const staticPhrases = getStaticCanonicalWarmPhrases()
        .filter((p) => p.lang === lang)
        .slice(0, 12)
      const prewarmTask = async () => {
        await Promise.all([
          warmPhoneSpeechFromStorageOnly(greetingText, lang, voiceId),
          warmPhoneSpeechFromStorageOnly(key9Greeting, switchedLang, voiceId),
          warmPhoneSpeechFromStorageOnly(conciseSwitch, switchedLang, voiceId),
          ...staticPhrases.map((p) => warmPhoneSpeechFromStorageOnly(p.text, p.lang, voiceId))
        ])
      }
      try {
        after(() => prewarmTask().catch(() => null))
      } catch {
        void prewarmTask().catch(() => null)
      }
      return NextResponse.json({ ok: true, storeId: ctx.store.id })
    }

    if (action === 'start') {
      const reqStart = Date.now()
      const ctx = await getStorePhoneContext(storeId)
      const { store, config, scheduleEval } = ctx
      const callSid = `SIM_${store.id}_${Date.now()}`
      const voiceId: VoiceId = resolvePhoneFemaleVoice(config.voice_id)
      const greetingText = buildInitialGreeting(
        store.name,
        lang,
        config.custom_greeting_es,
        config.custom_greeting_en,
        { scheduleEval }
      )

      const initialTranscript = [
        {
          role: 'assistant',
          text: greetingText,
          timestamp: new Date().toISOString()
        }
      ]

      const audioUrl = buildPhoneTtsUrl('', greetingText, lang, voiceId)

      if (useStream) {
        const insertPromise = supabaseAdmin
          .from('phone_calls')
          .insert({
            call_sid: callSid,
            store_id: store.id,
            source: 'simulator',
            caller_number: auth.user.email || 'Simulador Web',
            to_number: store.phone,
            language: lang,
            status: 'in_progress',
            resolved_by_ai: false,
            turns_count: 0,
            summary: `Llamada iniciada en simulador (${store.name})`,
            transcript: initialTranscript,
            business_date: getCaliforniaBusinessDate(),
            shift: getCaliforniaShift()
          })
          .select('id')
          .single()

        return createNdjsonStreamResponse(async (send) => {
          try {
            send({
              type: 'start_meta',
              callSid,
              store: {
                id: store.id,
                name: store.name,
                phone: store.phone,
                address: store.address,
                hasDriveThru: store.has_drive_thru
              },
              scheduleEval,
              voiceId,
              language: lang,
              greetingText,
              audioUrl,
              transcript: initialTranscript,
              textMs: Date.now() - reqStart
            })

            let firstAudioMs = -1
            let fromCache = false
            let emittedAudioChunks = 0
            let streamCompletedCleanly = false
            if (voiceMode !== 'instant_local') {
              try {
                for await (const chunk of streamPhoneAgentSpeechPcm(greetingText, lang, voiceId, {
                  signal: request.signal,
                  skipStorageLookup: false,
                  fastLivePhone: true,
                  onStreamCompleted: (ok) => {
                    streamCompletedCleanly = ok
                  }
                })) {
                  emittedAudioChunks++
                  if (firstAudioMs === -1) {
                    firstAudioMs = Date.now() - reqStart
                    fromCache = chunk.fromCache
                  }
                  send({
                    type: 'audio_pcm',
                    pcmBase64: chunk.pcmChunk.toString('base64'),
                    sampleRate: chunk.sampleRate,
                    fromCache: chunk.fromCache
                  })
                }
              } catch (ttsErr: any) {
                console.warn('[api/phone/simulate start] TTS warning:', ttsErr?.message || ttsErr)
              }
              if (emittedAudioChunks === 0 && !request.signal.aborted) {
                send({ type: 'tts_fallback_required', text: greetingText, language: lang })
              } else if (emittedAudioChunks > 0 && !streamCompletedCleanly && !request.signal.aborted) {
                send({ type: 'audio_stream_truncated', text: greetingText, language: lang })
              }
            }

            const ins = await insertPromise
            if (ins.error || !ins.data) {
              throw ins.error || new Error('No se pudo registrar la llamada en phone_calls')
            }
            send({
              type: 'done',
              callId: ins.data.id,
              totalFirstAudioMs: firstAudioMs,
              fromCache
            })
          } catch (streamErr: any) {
            send({ type: 'error', error: streamErr?.message || 'Error en saludo de llamada' })
          }
        })
      }

      const [insertRes, greetingWav] = await Promise.all([
        supabaseAdmin
          .from('phone_calls')
          .insert({
            call_sid: callSid,
            store_id: store.id,
            source: 'simulator',
            caller_number: auth.user.email || 'Simulador Web',
            to_number: store.phone,
            language: lang,
            status: 'in_progress',
            resolved_by_ai: false,
            turns_count: 0,
            summary: `Llamada iniciada en simulador (${store.name})`,
            transcript: initialTranscript,
            business_date: getCaliforniaBusinessDate(),
            shift: getCaliforniaShift()
          })
          .select()
          .single(),
        voiceMode === 'instant_local'
          ? Promise.resolve(null)
          : getPhoneAgentSpeech(greetingText, lang, voiceId).catch(() => null)
      ])

      if (insertRes.error) throw insertRes.error
      const created = insertRes.data
      const audioDataUrl = greetingWav ? `data:audio/wav;base64,${greetingWav.toString('base64')}` : null

      return NextResponse.json({
        ok: true,
        callId: created.id,
        callSid,
        store: {
          id: store.id,
          name: store.name,
          phone: store.phone,
          address: store.address,
          hasDriveThru: store.has_drive_thru
        },
        scheduleEval,
        voiceId,
        language: lang,
        greetingText,
        audioUrl,
        audioDataUrl,
        transcript: initialTranscript
      })
    }

    if (action === 'end') {
      const callSid = String(body?.callSid || '').trim()
      if (callSid.startsWith('SIM_')) {
        const { data: existing, error: findErr } = await supabaseAdmin
          .from('phone_calls')
          .select('id, store_id, status, started_at, ended_at, turns_count')
          .eq('call_sid', callSid)
          .eq('source', 'simulator')
          .maybeSingle()
        if (findErr) throw findErr

        if (existing) {
          if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(Number(existing.store_id))) {
            return NextResponse.json({ error: 'Acceso denegado a esta llamada' }, { status: 403 })
          }
          const normStatus = String(existing.status || '').toLowerCase()
          const alreadyTerminated =
            Boolean(existing.ended_at) ||
            ['completed', 'canceled', 'cancelled', 'busy', 'failed', 'no-answer'].includes(normStatus)
          if (!alreadyTerminated) {
            const startedMs = existing.started_at ? new Date(existing.started_at).getTime() : Date.now()
            const durationSeconds = Math.min(1800, Math.max(5, Math.round((Date.now() - startedMs) / 1000)))
            const preservedStatus =
              existing.status === 'callback_requested' || existing.status === 'transferred'
                ? existing.status
                : 'completed'
            const updateObj: Record<string, any> = {
              status: preservedStatus,
              duration_seconds: durationSeconds,
              ended_at: new Date().toISOString()
            }
            if (Number(existing.turns_count || 0) === 0 || preservedStatus !== 'completed') {
              updateObj.resolved_by_ai = false
            }
            const { error: endUpdErr } = await supabaseAdmin
              .from('phone_calls')
              .update(updateObj)
              .eq('id', existing.id)
              .is('ended_at', null)
            if (endUpdErr) throw endUpdErr
          }
        }
      }
      return NextResponse.json({ ok: true })
    }

    // Default: action === 'turn'
    const rawCallSid = String(body?.callSid || '').trim()
    let callSid = rawCallSid.startsWith(`SIM_${storeId}_`) ? rawCallSid : `SIM_${storeId}_${Date.now()}`
    if (rawCallSid.startsWith('SIM_') && (!auth.user.isGlobalAdmin || !rawCallSid.startsWith(`SIM_${storeId}_`))) {
      const { data: ownerCheck, error: ownerErr } = await supabaseAdmin
        .from('phone_calls')
        .select('store_id')
        .eq('call_sid', rawCallSid)
        .eq('source', 'simulator')
        .maybeSingle()
      if (ownerErr) throw ownerErr
      if (ownerCheck) {
        if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(Number(ownerCheck.store_id))) {
          return NextResponse.json({ error: 'Acceso denegado a esta llamada simulada' }, { status: 403 })
        }
        if (Number(ownerCheck.store_id) !== storeId) {
          return NextResponse.json(
            { error: 'La llamada simulada pertenece a otra sucursal; inicia una nueva llamada.' },
            { status: 409 }
          )
        }
        callSid = rawCallSid
      }
    }
    const rawUserText = String(body?.userText || '').trim().slice(0, 1000)
    if (!rawUserText) {
      return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })
    }

    // Tecla 9 (igual que en Twilio): si ya inició la conversación, cambio ágil de idioma; si es inicio pre-llamada, aviso CIPA completo
    if (rawUserText === '9') {
      const reqStart = Date.now()
      const switchedLang: PhoneLang = lang === 'en' ? 'es' : 'en'
      const [ctx, existingRes] = await Promise.all([
        getStorePhoneContext(storeId),
        supabaseAdmin.from('phone_calls').select('id, store_id, status, ended_at, transcript, turns_count').eq('call_sid', callSid).maybeSingle()
      ])
      if (existingRes.error) throw existingRes.error
      const existing = existingRes.data
      const voiceId: VoiceId = resolvePhoneFemaleVoice(ctx.config.voice_id)
      const isMidCall = Boolean(existing && Number(existing.turns_count || 0) >= 1)
      const switchedReply = isMidCall
        ? switchedLang === 'en'
          ? 'Of course, we can continue in English! How can I help you today?'
          : 'Con gusto continuamos en español. ¿En qué te ayudo hoy?'
        : buildInitialGreeting(
            ctx.store.name,
            switchedLang,
            ctx.config.custom_greeting_es,
            ctx.config.custom_greeting_en,
            { includeLanguageSwitchHint: false, scheduleEval: ctx.scheduleEval }
          )
      const audioUrl = buildPhoneTtsUrl('', switchedReply, switchedLang, voiceId)

      const nextTranscript = [
        ...(Array.isArray(existing?.transcript) ? existing.transcript : []),
        { role: 'user' as const, text: '9', timestamp: new Date().toISOString() },
        { role: 'assistant' as const, text: switchedReply, timestamp: new Date().toISOString() }
      ]

      const dbUpdatePromise = (async () => {
        if (existing) {
          const { error: updErr } = await supabaseAdmin
            .from('phone_calls')
            .update({
              language: switchedLang,
              turns_count: Number(existing.turns_count || 0),
              transcript: nextTranscript
            })
            .eq('id', existing.id)
          if (updErr) throw updErr
          return existing.id
        }
        const { error: insErr } = await supabaseAdmin
          .from('phone_calls')
          .upsert(
            {
              call_sid: callSid,
              store_id: storeId,
              source: 'simulator',
              caller_number: auth.user?.email || 'Simulador Web',
              to_number: ctx.store.phone,
              language: switchedLang,
              status: 'in_progress',
              resolved_by_ai: false,
              turns_count: 0,
              summary: `Cambio de idioma (Tecla 9) en simulador (${ctx.store.name})`,
              transcript: nextTranscript,
              business_date: getCaliforniaBusinessDate(),
              shift: getCaliforniaShift()
            },
            { onConflict: 'call_sid', ignoreDuplicates: true }
          )
        if (insErr) throw insErr
        const { data: createdRow, error: fetchRowErr } = await supabaseAdmin
          .from('phone_calls')
          .select('id')
          .eq('call_sid', callSid)
          .single()
        if (fetchRowErr || !createdRow) throw fetchRowErr || new Error('No se encontró llamada tras cambio de idioma')
        return createdRow.id
      })()

      if (useStream) {
        return createNdjsonStreamResponse(async (send) => {
          try {
            send({
              type: 'turn_meta',
              callSid,
              replyText: switchedReply,
              language: switchedLang,
              languageSwitch: true,
              voiceId,
              audioUrl,
              toolsUsed: [],
              callbackCreated: null,
              shouldTransferToPhone: null,
              shouldHangup: false,
              transcript: nextTranscript,
              textMs: Date.now() - reqStart
            })

            let firstAudioMs = -1
            let fromCache = false
            let emittedAudioChunks = 0
            let streamCompletedCleanly = false
            if (voiceMode !== 'instant_local') {
              try {
                for await (const chunk of streamPhoneAgentSpeechPcm(switchedReply, switchedLang, voiceId, {
                  signal: request.signal,
                  skipStorageLookup: false,
                  fastLivePhone: true,
                  onStreamCompleted: (ok) => {
                    streamCompletedCleanly = ok
                  }
                })) {
                  emittedAudioChunks++
                  if (firstAudioMs === -1) {
                    firstAudioMs = Date.now() - reqStart
                    fromCache = chunk.fromCache
                  }
                  send({
                    type: 'audio_pcm',
                    pcmBase64: chunk.pcmChunk.toString('base64'),
                    sampleRate: chunk.sampleRate,
                    fromCache: chunk.fromCache
                  })
                }
              } catch (ttsErr: any) {
                console.warn('[api/phone/simulate key9] TTS warning:', ttsErr?.message || ttsErr)
              }
              if (emittedAudioChunks === 0 && !request.signal.aborted) {
                send({ type: 'tts_fallback_required', text: switchedReply, language: switchedLang })
              } else if (emittedAudioChunks > 0 && !streamCompletedCleanly && !request.signal.aborted) {
                send({ type: 'audio_stream_truncated', text: switchedReply, language: switchedLang })
              }
            }

            const callId = await dbUpdatePromise
            send({
              type: 'done',
              callId,
              totalFirstAudioMs: firstAudioMs,
              fromCache
            })
          } catch (err: any) {
            send({ type: 'error', error: err?.message || 'Error al cambiar idioma con tecla 9' })
          }
        })
      }

      const [callId, fullWav] = await Promise.all([
        dbUpdatePromise,
        voiceMode === 'instant_local'
          ? Promise.resolve(null)
          : getPhoneAgentSpeech(switchedReply, switchedLang, voiceId).catch(() => null)
      ])
      return NextResponse.json({
        ok: true,
        callId,
        callSid,
        replyText: switchedReply,
        language: switchedLang,
        languageSwitch: true,
        voiceId,
        audioUrl,
        audioDataUrl: fullWav ? `data:audio/wav;base64,${fullWav.toString('base64')}` : null,
        toolsUsed: [],
        callbackCreated: null,
        shouldTransferToPhone: null,
        shouldHangup: false,
        transcript: nextTranscript
      })
    }

    const userText =
      rawUserText === '0'
        ? lang === 'en'
          ? 'I would like to speak with the manager or leave a message for them.'
          : 'Necesito ayuda de un encargado o gerente de la sucursal por favor.'
        : rawUserText === '1'
          ? lang === 'en'
            ? 'What are your hours today and what is the address?'
            : '¿Cuál es el horario de hoy y la dirección?'
          : rawUserText === '2'
            ? lang === 'en'
              ? 'Tell me about Fiesta Platters and prices.'
              : '¿Cuáles son los precios y tamaños de las charolas Fiesta Platter?'
            : rawUserText === '3'
              ? lang === 'en'
                ? 'I need to leave a message for the store manager.'
                : 'Necesito dejarle un recado urgente al gerente de la sucursal.'
              : rawUserText

    if (useStream) {
      const reqStart = Date.now()
      return createNdjsonStreamResponse(async (send) => {
        try {
          const turn = await processPhoneAgentTurn({
            callSid,
            storeId,
            userText,
            source: 'simulator',
            callerNumber: body?.callerNumber || auth.user?.email || 'Simulador Web',
            preferredLang: body?.lang ? (body.lang === 'en' ? 'en' : 'es') : undefined,
            deferDbFlush: true
          })

          const textMs = Date.now() - reqStart
          const audioUrl = buildPhoneTtsUrl('', turn.replyText, turn.language, turn.voiceId)

          send({
            type: 'turn_meta',
            callId: turn.callId,
            callSid,
            replyText: turn.replyText,
            language: turn.language,
            voiceId: turn.voiceId,
            audioUrl,
            toolsUsed: turn.toolsUsed,
            callbackCreated: turn.callbackCreated,
            shouldTransferToPhone: turn.shouldTransferToPhone,
            shouldHangup: turn.shouldHangup,
            transcript: turn.transcript,
            textMs
          })

          let firstAudioMs = -1
          let fromCache = false
          let emittedAudioChunks = 0
          let streamCompletedCleanly = false
          if (voiceMode !== 'instant_local') {
            try {
              for await (const chunk of streamPhoneAgentSpeechPcm(turn.replyText, turn.language, turn.voiceId, {
                signal: request.signal,
                skipStorageLookup: !turn.isCanonicalReply,
                fastLivePhone: true,
                onStreamCompleted: (ok) => {
                  streamCompletedCleanly = ok
                }
              })) {
                emittedAudioChunks++
                if (firstAudioMs === -1) {
                  firstAudioMs = Date.now() - reqStart
                  fromCache = chunk.fromCache
                }
                send({
                  type: 'audio_pcm',
                  pcmBase64: chunk.pcmChunk.toString('base64'),
                  sampleRate: chunk.sampleRate,
                  fromCache: chunk.fromCache
                })
              }
            } catch (ttsErr: any) {
              console.warn('[api/phone/simulate turn] TTS warning:', ttsErr?.message || ttsErr)
            }
            if (emittedAudioChunks === 0 && !request.signal.aborted) {
              send({ type: 'tts_fallback_required', text: turn.replyText, language: turn.language })
            } else if (emittedAudioChunks > 0 && !streamCompletedCleanly && !request.signal.aborted) {
              send({ type: 'audio_stream_truncated', text: turn.replyText, language: turn.language })
            }
          }

          if (turn.flushDbPromise) {
            await turn.flushDbPromise
          }

          send({
            type: 'done',
            totalFirstAudioMs: firstAudioMs,
            textMs,
            fromCache
          })
        } catch (streamErr: any) {
          console.error('[api/phone/simulate stream] Error:', streamErr)
          send({
            type: 'error',
            error: streamErr?.message || 'Error procesando turno en streaming'
          })
        }
      })
    }

    const turn = await processPhoneAgentTurn({
      callSid,
      storeId,
      userText,
      source: 'simulator',
      callerNumber: body?.callerNumber || auth.user.email || 'Simulador Web',
      preferredLang: body?.lang ? (body.lang === 'en' ? 'en' : 'es') : undefined
    })

    const audioUrl = buildPhoneTtsUrl('', turn.replyText, turn.language, turn.voiceId)
    let audioDataUrl: string | null = null

    if (voiceMode !== 'instant_local') {
      const fullWav = await getPhoneAgentSpeech(turn.replyText, turn.language, turn.voiceId).catch(() => null)
      if (fullWav) {
        audioDataUrl = `data:audio/wav;base64,${fullWav.toString('base64')}`
      }
    }

    return NextResponse.json({
      ok: true,
      callId: turn.callId,
      callSid,
      replyText: turn.replyText,
      language: turn.language,
      voiceId: turn.voiceId,
      audioUrl,
      audioDataUrl,
      nextAudioUrl: null,
      toolsUsed: turn.toolsUsed,
      callbackCreated: turn.callbackCreated,
      shouldTransferToPhone: turn.shouldTransferToPhone,
      shouldHangup: turn.shouldHangup,
      transcript: turn.transcript
    })
  } catch (err: any) {
    console.error('[api/phone/simulate] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error procesando turno en simulador' }, { status: 500 })
  }
}
