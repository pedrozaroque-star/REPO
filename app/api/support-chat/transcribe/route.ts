/**
 * @module api/support-chat/transcribe
 * @description Endpoint de transcripción inteligente de voz a texto (ASR) para la burbuja TEG Assistant AI
 * y herramientas gerenciales internas, impulsado por `gemini-3.5-transcribe` sobre Gemini Interactions API.
 *
 * @businessRules
 * - Requiere autenticación de personal (`verifyStaffAuth`: Admin, Supervisor, Manager, Asistente).
 * - Usa modo `smart` con vocabulario de dominio de Tacos Gavilan (15 sucursales, platillos y sistemas)
 *   para limpiar muletillas, corregir dictados al vuelo y soportar español, inglés y Spanglish.
 * - Si el usuario ya tenía un borrador escrito (`sourceText`), aplica edición por voz (`voice editing`)
 *   integrando o corrigiendo el texto existente de forma natural.
 * - Tamaño máximo permitido por clip de audio: 4 MB (hasta 90 segundos en `SupportChatWidget`).
 *
 * @dataFlow
 * - Micrófono (`MediaRecorder` en `SupportChatWidget`) -> `POST /api/support-chat/transcribe` (FormData o JSON)
 *   -> `transcribeAudioWithGemini()` (`lib/gemini-interactions.ts`) -> `{ success: true, text, usedModel }`.
 *
 * @notes
 * - Soporta formatos nativos de escritorio, Android e iOS Safari (`audio/webm`, `audio/mp4`/`audio/m4a`, `audio/ogg`, `audio/wav`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { normalizeMediaMimeType, transcribeAudioWithGemini } from '@/lib/gemini-interactions'

export const maxDuration = 60

const MAX_AUDIO_BYTES = 4 * 1024 * 1024

export async function POST(req: NextRequest) {
  const auth = await verifyStaffAuth(req)
  if (!auth.authorized) {
    return auth.response!
  }
  if (auth.user?.role === 'planificador' || auth.user?.role === 'employee') {
    return NextResponse.json({ success: false, error: 'Acceso restringido.' }, { status: 403 })
  }

  try {
    const contentType = req.headers.get('content-type') || ''
    let base64Audio = ''
    let mimeType = 'audio/webm'
    let sourceText = ''
    let languageHint: 'es' | 'en' | 'auto' = 'auto'

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('audio') || formData.get('file')
      sourceText = String(formData.get('sourceText') || '').trim()
      const rawLang = String(formData.get('languageHint') || '').trim()
      if (rawLang === 'es' || rawLang === 'en') languageHint = rawLang

      if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
        return NextResponse.json(
          { success: false, error: 'No se recibió archivo de audio.' },
          { status: 400 }
        )
      }

      const blob = file as Blob
      if (blob.size === 0 || blob.size > MAX_AUDIO_BYTES) {
        return NextResponse.json(
          { success: false, error: 'El audio está vacío o supera el límite de 4 MB.' },
          { status: 400 }
        )
      }

      mimeType = normalizeMediaMimeType(blob.type || 'audio/webm', 'audio/webm')
      const buf = Buffer.from(await blob.arrayBuffer())
      base64Audio = buf.toString('base64')
    } else {
      const body = await req.json().catch(() => ({}))
      base64Audio = String(body?.base64Audio || '').replace(/^data:[^;]+;base64,/, '').trim()
      mimeType = normalizeMediaMimeType(String(body?.mimeType || 'audio/webm'), 'audio/webm')
      sourceText = String(body?.sourceText || '').trim()
      const rawLang = String(body?.languageHint || '').trim()
      if (rawLang === 'es' || rawLang === 'en') languageHint = rawLang

      if (!base64Audio) {
        return NextResponse.json(
          { success: false, error: 'No se recibió contenido de audio.' },
          { status: 400 }
        )
      }
      const approxBytes = Math.ceil((base64Audio.length * 3) / 4)
      if (approxBytes > MAX_AUDIO_BYTES) {
        return NextResponse.json(
          { success: false, error: 'El audio supera el límite de 4 MB.' },
          { status: 400 }
        )
      }
    }

    const result = await transcribeAudioWithGemini({
      base64Audio,
      mimeType,
      languageHint,
      sourceText: sourceText || undefined,
    })

    return NextResponse.json({
      success: true,
      text: result.text,
      usedModel: result.usedModel,
    })
  } catch (err: any) {
    console.error('[POST /api/support-chat/transcribe] Error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Error al transcribir el audio con Gemini.',
      },
      { status: 500 }
    )
  }
}
