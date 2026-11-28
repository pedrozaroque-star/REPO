/**
 * @module api/remote-control/screen-session
 * @description Endpoint administrativo para iniciar, mantener activa (keepalive), enviar eventos
 *              interactivos de ratón/teclado y cerrar sesiones del Visor de Pantalla en Vivo
 *              100% nativo dentro de SM TEG (`/admin/control-remoto`).
 *
 * @businessRules
 * - Acceso exclusivo para administradores activos (`requireActiveAdmin`).
 * - Solo admite equipos `windows_pc` con `enrollment_status = 'enrolled'`.
 * - Cierra automáticamente sesiones previas del mismo equipo antes de abrir una nueva.
 * - Encola el comando `start_screen_session` (TTL 3 min) para despertar la transmisión del agente.
 * - Valida estrictamente cada evento de ratón/teclado con `sanitizeScreenInputEvent` y topa la cola a 25 eventos.
 *
 * @dataFlow
 * - Modal `LiveScreenModal` -> POST/PATCH/DELETE `/api/remote-control/screen-session` -> Supabase (`remote_fleet_screen_sessions`, `remote_fleet_commands`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getRemoteScreenBroadcastTopic,
  sanitizeScreenInputEvent,
  type RemoteScreenInputEvent,
} from '@/lib/remote-control'
import { requireActiveAdmin } from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_INPUT_QUEUE = 25

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export async function POST(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const body = await request.json().catch(() => ({}))
    const deviceId = String(body?.deviceId || '').trim()
    if (!UUID_REGEX.test(deviceId)) {
      return NextResponse.json({ error: 'deviceId inválido' }, { status: 400 })
    }

    const { data: device, error: devErr } = await supabaseAdmin
      .from('remote_fleet_devices')
      .select('id, store_code, device_type, enrollment_status, display_name, agent_version')
      .eq('id', deviceId)
      .maybeSingle()

    if (devErr) throw devErr
    if (!device) {
      return NextResponse.json({ error: 'Dispositivo no encontrado' }, { status: 404 })
    }
    if (device.device_type !== 'windows_pc' || device.enrollment_status !== 'enrolled') {
      return NextResponse.json(
        { error: 'El visor nativo solo aplica a PCs Windows enroladas con TEG Agent.' },
        { status: 400 }
      )
    }

    const quality = clampInt(body?.quality, 25, 85, 55)
    const maxWidth = clampInt(body?.maxWidth, 640, 1920, 1280)
    const nowIso = new Date().toISOString()

    // Cerrar sesiones activas previas de esta PC
    await supabaseAdmin
      .from('remote_fleet_screen_sessions')
      .update({ status: 'ended', ended_at: nowIso })
      .eq('device_id', device.id)
      .in('status', ['starting', 'active'])

    // Crear nueva sesión con UUID criptográfico (sessionId)
    const { data: session, error: insErr } = await supabaseAdmin
      .from('remote_fleet_screen_sessions')
      .insert({
        device_id: device.id,
        store_code: device.store_code,
        requested_by_user_id: auth.userId || null,
        requested_by_name: auth.userName || 'Admin',
        status: 'starting',
        quality,
        max_width: maxWidth,
        input_queue: [],
        last_viewer_ping_at: nowIso,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
      .select('id, device_id, store_code, status, quality, max_width, created_at, expires_at')
      .single()

    if (insErr) throw insErr

    // Cancelar comandos start_screen_session viejos pendientes y encolar el nuevo (TTL 3 min)
    await supabaseAdmin
      .from('remote_fleet_commands')
      .update({ status: 'cancelled', completed_at: nowIso })
      .eq('device_id', device.id)
      .eq('command_type', 'start_screen_session')
      .in('status', ['pending', 'dispatched'])

    await supabaseAdmin.from('remote_fleet_commands').insert({
      device_id: device.id,
      store_code: device.store_code,
      device_type: 'windows_pc',
      command_type: 'start_screen_session',
      payload: {
        sessionId: session.id,
        quality,
        maxWidth,
      },
      status: 'pending',
      requested_by_user_id: auth.userId || null,
      requested_by_name: auth.userName || 'Admin',
      expires_at: new Date(Date.now() + 3 * 60_000).toISOString(),
    })

    return NextResponse.json(
      {
        success: true,
        session,
        broadcastTopic: getRemoteScreenBroadcastTopic(device.id, session.id),
        agentVersion: device.agent_version || null,
      },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('❌ [api/remote-control/screen-session POST] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error iniciando sesión de pantalla en vivo' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '').trim()
    if (!UUID_REGEX.test(sessionId)) {
      return NextResponse.json({ error: 'sessionId inválido' }, { status: 400 })
    }

    const { data: session, error: findErr } = await supabaseAdmin
      .from('remote_fleet_screen_sessions')
      .select('id, status, quality, max_width, input_queue')
      .eq('id', sessionId)
      .maybeSingle()

    if (findErr) throw findErr
    if (!session || session.status === 'ended') {
      return NextResponse.json({ error: 'Sesión finalizada o inexistente' }, { status: 404 })
    }

    const nowIso = new Date().toISOString()
    const updates: Record<string, any> = {
      last_viewer_ping_at: nowIso,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }

    if (body?.quality !== undefined) {
      updates.quality = clampInt(body.quality, 25, 85, session.quality)
    }
    if (body?.maxWidth !== undefined) {
      updates.max_width = clampInt(body.maxWidth, 640, 1920, session.max_width)
    }

    const rawEvents: unknown[] = Array.isArray(body?.events)
      ? body.events
      : body?.event
        ? [body.event]
        : []

    if (rawEvents.length > 0) {
      const sanitized: RemoteScreenInputEvent[] = []
      for (const rawEv of rawEvents.slice(0, 10)) {
        const clean = sanitizeScreenInputEvent(rawEv)
        if (clean) sanitized.push(clean)
      }
      if (sanitized.length > 0) {
        const currentQueue = Array.isArray(session.input_queue) ? session.input_queue : []
        updates.input_queue = [...currentQueue, ...sanitized].slice(-MAX_INPUT_QUEUE)
      }
    }

    const { error: updErr } = await supabaseAdmin
      .from('remote_fleet_screen_sessions')
      .update(updates)
      .eq('id', sessionId)

    if (updErr) throw updErr

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('❌ [api/remote-control/screen-session PATCH] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error actualizando sesión de pantalla' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const { searchParams } = new URL(request.url)
    let sessionId = searchParams.get('sessionId')?.trim() || ''
    if (!sessionId) {
      const body = await request.json().catch(() => ({}))
      sessionId = String(body?.sessionId || '').trim()
    }
    if (!UUID_REGEX.test(sessionId)) {
      return NextResponse.json({ error: 'sessionId inválido' }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    await supabaseAdmin
      .from('remote_fleet_screen_sessions')
      .update({ status: 'ended', ended_at: nowIso, input_queue: [] })
      .eq('id', sessionId)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('❌ [api/remote-control/screen-session DELETE] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error cerrando sesión de pantalla' },
      { status: 500 }
    )
  }
}
