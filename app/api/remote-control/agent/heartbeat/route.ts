/**
 * @module api/remote-control/agent/heartbeat
 * @description Endpoint de latido y telemetría de hardware/audio para el agente Windows (`teg-agent.ps1`).
 *
 * @businessRules
 * - Autenticado exclusivamente mediante token único por PC (`authenticateWindowsAgent`).
 * - Actualiza `last_heartbeat_at`, `last_ip`, `agent_version` y `telemetry` (CPU, RAM, Disco, Volumen, Mute, Chrome).
 * - Devuelve `desiredConfig` vigente para que la PC mantenga su Watchdog sincronizado automáticamente.
 *
 * @dataFlow
 * - PC Windows (`teg-agent.ps1`, cada 60s) -> POST `/api/remote-control/agent/heartbeat` -> Supabase (`remote_fleet_devices`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sanitizePcWatchdogConfig } from '@/lib/remote-control'
import { authenticateWindowsAgent, extractClientIp } from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await authenticateWindowsAgent(request)
  if (!auth.authenticated || !auth.device) return auth.response!

  try {
    const body = await request.json().catch(() => ({}))
    const agentVersion =
      typeof body?.agentVersion === 'string' ? body.agentVersion.trim().slice(0, 32) : auth.device.agent_version

    const incomingTelemetry =
      body?.telemetry && typeof body.telemetry === 'object' ? body.telemetry : {}

    const mergedTelemetry = {
      ...(auth.device.telemetry || {}),
      ...incomingTelemetry,
    }

    const nowIso = new Date().toISOString()
    const clientIp = extractClientIp(request)

    const { error } = await supabaseAdmin
      .from('remote_fleet_devices')
      .update({
        last_heartbeat_at: nowIso,
        last_ip: clientIp,
        agent_version: agentVersion || '1.0.0',
        telemetry: mergedTelemetry,
        enrollment_status: 'enrolled',
        updated_at: nowIso,
      })
      .eq('id', auth.device.id)

    if (error) throw error

    return NextResponse.json({
      success: true,
      serverTime: nowIso,
      desiredConfig: sanitizePcWatchdogConfig(auth.device.desired_config),
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/agent/heartbeat] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error registrando heartbeat' }, { status: 500 })
  }
}
