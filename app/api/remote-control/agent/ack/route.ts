/**
 * @module api/remote-control/agent/ack
 * @description Confirma la ejecución de un comando remoto desde el agente Windows (`teg-agent.ps1`)
 *              guardando estado final (`succeeded` / `failed`), código de salida, salida estándar y telemetría fresca.
 *
 * @businessRules
 * - Valida propiedad estricta (`device_id = auth.device.id`) para impedir alteración cruzada entre sucursales (IDOR).
 * - Trunca la salida estándar de forma segura a 16 KB para proteger el Spend Cap de Supabase.
 *
 * @dataFlow
 * - PC Windows -> POST `/api/remote-control/agent/ack` -> Supabase (`remote_fleet_commands`, `remote_fleet_devices`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  authenticateWindowsAgent,
  extractClientIp,
  truncateCommandOutput,
} from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_ACK_STATUS = new Set(['running', 'succeeded', 'failed'])

export async function POST(request: Request) {
  const auth = await authenticateWindowsAgent(request)
  if (!auth.authenticated || !auth.device) return auth.response!

  try {
    const body = await request.json()
    const commandId = String(body?.commandId || '').trim()
    if (!UUID_REGEX.test(commandId)) {
      return NextResponse.json({ error: 'commandId inválido' }, { status: 400 })
    }

    const status = String(body?.status || '').trim().toLowerCase()
    if (!ALLOWED_ACK_STATUS.has(status)) {
      return NextResponse.json({ error: 'Estado ACK inválido' }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    const exitCode = Number.isFinite(Number(body?.exitCode)) ? Math.round(Number(body.exitCode)) : null
    const output = truncateCommandOutput(body?.output)
    const errorMessage = body?.errorMessage ? truncateCommandOutput(body.errorMessage, 2000) : null

    const { data: updatedCmd, error: cmdErr } = await supabaseAdmin
      .from('remote_fleet_commands')
      .update({
        status,
        completed_at: status === 'running' ? null : nowIso,
        result_exit_code: exitCode,
        result_output: output,
        error_message: errorMessage,
      })
      .eq('id', commandId)
      .eq('device_id', auth.device.id)
      .select('id, status')
      .maybeSingle()

    if (cmdErr) throw cmdErr
    if (!updatedCmd) {
      return NextResponse.json({ error: 'Comando no encontrado para este dispositivo' }, { status: 404 })
    }

    const deviceUpdates: Record<string, any> = {
      last_heartbeat_at: nowIso,
      last_command_ack_at: nowIso,
      last_ip: extractClientIp(request),
      updated_at: nowIso,
    }
    if (body?.telemetry && typeof body.telemetry === 'object') {
      deviceUpdates.telemetry = {
        ...(auth.device.telemetry || {}),
        ...body.telemetry,
      }
    }

    await supabaseAdmin
      .from('remote_fleet_devices')
      .update(deviceUpdates)
      .eq('id', auth.device.id)

    return NextResponse.json({ success: true, command: updatedCmd })
  } catch (err: any) {
    console.error('❌ [api/remote-control/agent/ack] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error registrando ACK' }, { status: 500 })
  }
}
