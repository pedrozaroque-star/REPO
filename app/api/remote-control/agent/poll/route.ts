/**
 * @module api/remote-control/agent/poll
 * @description Endpoint de consulta de comandos pendientes para el agente Windows (`teg-agent.ps1`).
 *
 * @businessRules
 * - Autenticado exclusivamente por token único de dispositivo (`authenticateWindowsAgent`).
 * - Expira primero cualquier comando vencido (`expires_at < now()`) del equipo.
 * - Entrega en orden FIFO hasta 5 comandos `pending`, marcándolos atómicamente como `dispatched`.
 *
 * @dataFlow
 * - PC Windows (`teg-agent.ps1`, cada 15s) -> GET `/api/remote-control/agent/poll` -> Supabase (`remote_fleet_commands`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authenticateWindowsAgent } from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await authenticateWindowsAgent(request)
  if (!auth.authenticated || !auth.device) return auth.response!

  try {
    // `.gt('expires_at', nowIso)` ya excluye comandos vencidos sin ejecutar un UPDATE innecesario en cada latido
    const nowIso = new Date().toISOString()
    const { data: pending, error } = await supabaseAdmin
      .from('remote_fleet_commands')
      .select('id, command_type, payload, created_at, expires_at')
      .eq('device_id', auth.device.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(5)

    if (error) throw error

    const commands = pending || []
    if (commands.length > 0) {
      const ids = commands.map((c) => c.id)
      await supabaseAdmin
        .from('remote_fleet_commands')
        .update({ status: 'dispatched', dispatched_at: nowIso })
        .in('id', ids)
        .eq('status', 'pending')
    }

    return NextResponse.json({
      success: true,
      commands,
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/agent/poll] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error consultando comandos' }, { status: 500 })
  }
}
