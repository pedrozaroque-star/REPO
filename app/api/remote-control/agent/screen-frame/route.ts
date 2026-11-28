/**
 * @module api/remote-control/agent/screen-frame
 * @description Endpoint de alta velocidad para recibir un cuadro JPEG desde `TEG Store Agent` v1.1+,
 *              reenviarlo en RAM vía Supabase Realtime Broadcast al visor del Administrador (CERO escritura
 *              de blobs en disco/Postgres) y devolver en la misma respuesta los eventos pendientes de
 *              ratón/teclado para ejecutar en la PC de sucursal.
 *
 * @businessRules
 * - Autenticado estrictamente por token criptográfico por PC (`authenticateWindowsAgent`).
 * - Valida que la sesión `sessionId` pertenezca al mismo `device_id` autenticado (anti-IDOR).
 * - Si el Administrador cerró el modal o pasaron > 45 segundos sin `last_viewer_ping_at` (o venció `expires_at`),
 *   cierra la sesión y responde `{ active: false }` para que la PC deje de transmitir al instante.
 * - Rechaza imágenes mayores a 230 KB Base64 para proteger la cuota de Realtime Broadcast.
 *
 * @dataFlow
 * - PC Windows (`teg-agent.ps1` v1.1) -> POST `/api/remote-control/agent/screen-frame` -> `broadcastRemoteScreenFrame` (RAM) -> Modal Admin; responde `{ active, quality, maxWidth, inputEvents }`.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  authenticateWindowsAgent,
  broadcastRemoteScreenFrame,
} from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VIEWER_IDLE_TIMEOUT_MS = 45_000
const MAX_BASE64_CHARS = 235_000

export async function POST(request: Request) {
  const auth = await authenticateWindowsAgent(request)
  if (!auth.authenticated || !auth.device) return auth.response!

  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '').trim()
    if (!UUID_REGEX.test(sessionId)) {
      return NextResponse.json({ active: false, error: 'sessionId inválido' }, { status: 400 })
    }

    const { data: session, error: findErr } = await supabaseAdmin
      .from('remote_fleet_screen_sessions')
      .select('id, device_id, status, quality, max_width, input_queue, frames_sent, last_viewer_ping_at, expires_at')
      .eq('id', sessionId)
      .eq('device_id', auth.device.id)
      .maybeSingle()

    if (findErr) throw findErr
    if (!session || session.status === 'ended') {
      return NextResponse.json({ active: false })
    }

    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const lastPingMs = new Date(session.last_viewer_ping_at).getTime()
    const expiresMs = new Date(session.expires_at).getTime()

    if (
      !Number.isFinite(lastPingMs) ||
      nowMs - lastPingMs > VIEWER_IDLE_TIMEOUT_MS ||
      (Number.isFinite(expiresMs) && nowMs >= expiresMs)
    ) {
      await supabaseAdmin
        .from('remote_fleet_screen_sessions')
        .update({ status: 'ended', ended_at: nowIso, input_queue: [] })
        .eq('id', session.id)
      return NextResponse.json({ active: false })
    }

    const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64.trim() : ''
    if (!imageBase64 || imageBase64.length > MAX_BASE64_CHARS) {
      return NextResponse.json(
        {
          active: true,
          quality: Math.min(session.quality, 42),
          maxWidth: Math.min(session.max_width, 1024),
          inputEvents: [],
        },
        { status: 200 }
      )
    }

    const nextSeq = (Number(session.frames_sent) || 0) + 1
    const origWidth = Math.max(1, Math.round(Number(body?.origWidth) || 1920))
    const origHeight = Math.max(1, Math.round(Number(body?.origHeight) || 1080))
    const sentWidth = Math.max(1, Math.round(Number(body?.sentWidth) || session.max_width))
    const sentHeight = Math.max(1, Math.round(Number(body?.sentHeight) || 720))
    const byteSize = Math.max(0, Math.round(Number(body?.byteSize) || Math.floor((imageBase64.length * 3) / 4)))
    const capturedAt = typeof body?.capturedAt === 'string' ? body.capturedAt : nowIso

    const pendingInputs = Array.isArray(session.input_queue) ? session.input_queue : []

    // Enviar cuadro en RAM por Realtime Broadcast + vaciar input_queue en paralelo
    await Promise.all([
      broadcastRemoteScreenFrame({
        deviceId: auth.device.id,
        sessionId: session.id,
        frameSeq: nextSeq,
        imageBase64,
        origWidth,
        origHeight,
        sentWidth,
        sentHeight,
        byteSize,
        capturedAt,
      }),
      supabaseAdmin
        .from('remote_fleet_screen_sessions')
        .update({
          status: 'active',
          frames_sent: nextSeq,
          last_frame_at: nowIso,
          input_queue: [],
        })
        .eq('id', session.id),
    ])

    return NextResponse.json({
      active: true,
      quality: session.quality,
      maxWidth: session.max_width,
      inputEvents: pendingInputs,
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/agent/screen-frame] Error:', err)
    return NextResponse.json(
      { active: false, error: err?.message || 'Error procesando cuadro de pantalla' },
      { status: 500 }
    )
  }
}
