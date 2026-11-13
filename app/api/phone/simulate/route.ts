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
import { getPhoneAgentSpeech, resolvePhoneFemaleVoice, streamPhoneAgentSpeechPcm, VoiceId } from '@/lib/order-ready-tts'
import {
  buildInitialGreeting,
  buildPhoneTtsUrl,
  getStorePhoneContext,
  loadStoreMenuItems,
  PhoneLang,
  processPhoneAgentTurn
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 })
    }
    const action = String(body?.action || 'turn')
    const rawStoreId = Number(body?.storeId)

    // Autorización RBAC en una sola llamada; luego validamos pertenencia exacta sobre storeId
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
    }

    const storeId =
      Number.isFinite(rawStoreId) && rawStoreId > 0
        ? rawStoreId
        : auth.user.assignedStoreId || 14

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
          : 'Con gusto continuamos en español. ¿En qué te puedo ayudar?'
      const prewarmTask = async () => {
        await Promise.all([
          getPhoneAgentSpeech(greetingText, lang, voiceId, false, { awaitStoragePersist: true }),
          getPhoneAgentSpeech(conciseSwitch, switchedLang, voiceId, false, { awaitStoragePersist: true })
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
        const encoder = new TextEncoder()
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

        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: Record<string, any>) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
            }
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
              if (voiceMode !== 'instant_local') {
                for await (const chunk of streamPhoneAgentSpeechPcm(greetingText, lang, voiceId, {
                  signal: request.signal
                })) {
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
              }

              const ins = await insertPromise
              if (ins.error) {
                console.error('[api/phone/simulate start] Error al insertar llamada:', ins.error.message)
              }
              send({
                type: 'done',
                callId: ins.data?.id || null,
                totalFirstAudioMs: firstAudioMs,
                fromCache
              })
            } catch (streamErr: any) {
              send({ type: 'error', error: streamErr?.message || 'Error en saludo de llamada' })
            } finally {
              controller.close()
            }
          }
        })

        return new Response(stream, { headers: STREAM_HEADERS })
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
      const callSid = String(body?.callSid || '')
      if (callSid.startsWith('SIM_')) {
        const { data: existing } = await supabaseAdmin
          .from('phone_calls')
          .select('id, store_id, status, started_at, turns_count')
          .eq('call_sid', callSid)
          .maybeSingle()

        if (existing) {
          if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(Number(existing.store_id))) {
            return NextResponse.json({ error: 'Acceso denegado a esta llamada' }, { status: 403 })
          }
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
          await supabaseAdmin.from('phone_calls').update(updateObj).eq('id', existing.id)
        }
      }
      return NextResponse.json({ ok: true })
    }

    // Default: action === 'turn'
    const rawCallSid = String(body?.callSid || '').trim()
    const callSid = rawCallSid.startsWith('SIM_') ? rawCallSid : `SIM_${storeId}_${Date.now()}`
    if (rawCallSid.startsWith('SIM_')) {
      const { data: ownerCheck } = await supabaseAdmin
        .from('phone_calls')
        .select('store_id')
        .eq('call_sid', callSid)
        .maybeSingle()
      if (ownerCheck && Number(ownerCheck.store_id) !== storeId) {
        if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(Number(ownerCheck.store_id))) {
          return NextResponse.json({ error: 'Acceso denegado a esta llamada simulada' }, { status: 403 })
        }
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
      const [ctx, { data: existing }] = await Promise.all([
        getStorePhoneContext(storeId),
        supabaseAdmin.from('phone_calls').select('id, store_id, transcript, turns_count').eq('call_sid', callSid).maybeSingle()
      ])
      const voiceId: VoiceId = resolvePhoneFemaleVoice(ctx.config.voice_id)
      const isMidCall = Boolean(existing && Number(existing.turns_count || 0) >= 1)
      const switchedReply = isMidCall
        ? switchedLang === 'en'
          ? 'Of course, we can continue in English! How can I help you today?'
          : 'Con gusto continuamos en español. ¿En qué te puedo ayudar?'
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
          await supabaseAdmin
            .from('phone_calls')
            .update({
              language: switchedLang,
              turns_count: Number(existing.turns_count || 0) + 1,
              transcript: nextTranscript
            })
            .eq('id', existing.id)
          return existing.id
        }
        const { data: createdRow } = await supabaseAdmin
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
              turns_count: 1,
              summary: `Cambio de idioma (Tecla 9) en simulador (${ctx.store.name})`,
              transcript: nextTranscript,
              business_date: getCaliforniaBusinessDate(),
              shift: getCaliforniaShift()
            },
            { onConflict: 'call_sid' }
          )
          .select('id')
          .maybeSingle()
        return createdRow?.id || null
      })()

      if (useStream) {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: Record<string, any>) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
            }
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
              if (voiceMode !== 'instant_local') {
                for await (const chunk of streamPhoneAgentSpeechPcm(switchedReply, switchedLang, voiceId, {
                  signal: request.signal
                })) {
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
            } finally {
              controller.close()
            }
          }
        })
        return new Response(stream, { headers: STREAM_HEADERS })
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
      rawUserText === '1'
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
      const encoder = new TextEncoder()

      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: Record<string, any>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
          }
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
            if (voiceMode !== 'instant_local') {
              for await (const chunk of streamPhoneAgentSpeechPcm(turn.replyText, turn.language, turn.voiceId, {
                signal: request.signal
              })) {
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
          } finally {
            controller.close()
          }
        }
      })

      return new Response(stream, { headers: STREAM_HEADERS })
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
