/**
 * @module api/phone/simulate
 * @description Endpoint interactivo para el Simulador de Llamadas en Vivo en `/admin/llamadas`.
 * Permite probar y demostrar al dueño cómo contesta la IA en cualquiera de las 15 sucursales de Tacos Gavilan
 * usando exactamente el mismo motor (`processPhoneAgentTurn`), herramientas en vivo y voz neuronal `Kore`
 * sin requerir línea telefónica de Twilio.
 *
 * @businessRules
 * - Soporta 3 acciones:
 *   1. `start`: Inicia una llamada simulada a la tienda elegida (`storeId`), crea el registro en `phone_calls` (`SIM-...`),
 *      y devuelve el saludo oficial con su URL de audio `/api/phone/tts`.
 *   2. `turn`: Procesa lo que dijo el usuario (por micrófono o botón rápido), ejecuta las herramientas reales contra
 *      Supabase y devuelve la respuesta hablada, herramientas invocadas y recados generados.
 *   3. `end`: Finaliza la llamada simulada actualizando la duración total en `phone_calls`.
 *
 * @dataFlow
 * - Simulador Web (`/admin/llamadas`) -> `POST /api/phone/simulate` -> `processPhoneAgentTurn()` -> Respuesta JSON + URL Audio WAV.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` para uso administrativo y gerencial.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import {
  getPhoneAgentSpeech
} from '@/lib/order-ready-tts'
import {
  buildInitialGreeting,
  getStorePhoneContext,
  PhoneLang,
  processPhoneAgentTurn
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  try {
    const staff = await verifyStaffAuth(request)
    if (!staff.authorized) {
      return staff.response || NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const action = String(body?.action || 'turn')
    const storeId = Number(body?.storeId || 14)
    const lang: PhoneLang = body?.lang === 'en' ? 'en' : 'es'
    const voiceMode = String(body?.voiceMode || 'neural_turbo')

    if (action === 'start') {
      const ctx = await getStorePhoneContext(storeId)
      const { store, config, scheduleEval } = ctx
      const callSid = `SIM_${store.id}_${Date.now()}`
      const voiceId = config.voice_id || 'Kore'
      const greetingText = buildInitialGreeting(
        store.name,
        lang,
        config.custom_greeting_es,
        config.custom_greeting_en
      )

      const initialTranscript = [
        {
          role: 'assistant',
          text: greetingText,
          timestamp: new Date().toISOString()
        }
      ]

      // Ejecutar inserción de llamada y obtención de audio pre-cacheado en paralelo
      const [insertRes, greetingWav] = await Promise.all([
        supabaseAdmin
          .from('phone_calls')
          .insert({
            call_sid: callSid,
            store_id: store.id,
            source: 'simulator',
            caller_number: staff.user?.email || 'Simulador Web',
            to_number: store.phone,
            language: lang,
            status: 'in_progress',
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

      const audioUrl = `/api/phone/tts?lang=${lang}&voice=${encodeURIComponent(voiceId)}&text=${encodeURIComponent(greetingText)}`
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
      if (callSid) {
        const { data: existing } = await supabaseAdmin
          .from('phone_calls')
          .select('id, status, started_at')
          .eq('call_sid', callSid)
          .maybeSingle()

        if (existing) {
          const startedMs = existing.started_at ? new Date(existing.started_at).getTime() : Date.now()
          const durationSeconds = Math.max(5, Math.round((Date.now() - startedMs) / 1000))
          await supabaseAdmin
            .from('phone_calls')
            .update({
              status: existing.status === 'callback_requested' ? 'callback_requested' : 'completed',
              duration_seconds: durationSeconds,
              ended_at: new Date().toISOString()
            })
            .eq('id', existing.id)
        }
      }
      return NextResponse.json({ ok: true })
    }

    // Default: action === 'turn'
    const callSid = String(body?.callSid || `SIM_${storeId}_${Date.now()}`)
    const userText = String(body?.userText || '').trim()
    if (!userText) {
      return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })
    }

    const turn = await processPhoneAgentTurn({
      callSid,
      storeId,
      userText,
      source: 'simulator',
      callerNumber: body?.callerNumber || staff.user?.email || 'Simulador Web',
      preferredLang: body?.lang ? (body.lang === 'en' ? 'en' : 'es') : undefined
    })

    const audioUrl = `/api/phone/tts?lang=${turn.language}&voice=${encodeURIComponent(turn.voiceId)}&text=${encodeURIComponent(turn.replyText)}`

    let audioDataUrl: string | null = null
    const nextAudioUrl: string | null = null

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
      nextAudioUrl,
      toolsUsed: turn.toolsUsed,
      callbackCreated: turn.callbackCreated,
      shouldHangup: turn.shouldHangup,
      transcript: turn.transcript
    })
  } catch (err: any) {
    console.error('[api/phone/simulate] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error procesando turno en simulador' },
      { status: 500 }
    )
  }
}
