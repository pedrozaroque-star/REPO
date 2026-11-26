/**
 * @module api/remote-control/agent/script
 * @description Entrega la última versión oficial de `teg-agent.ps1` a agentes Windows autenticados
 *              para permitir auto-actualización remota (`update_agent`) sin visitar ninguna sucursal.
 *
 * @businessRules
 * - Autenticado estrictamente por token de agente (`authenticateWindowsAgent`).
 * - Responde `text/plain; charset=utf-8` sin caché (`Cache-Control: no-store`).
 *
 * @dataFlow
 * - PC Windows (`update_agent`) -> GET `/api/remote-control/agent/script` -> `buildWindowsAgentScriptSource()`.
 */

import { NextResponse } from 'next/server'
import { authenticateWindowsAgent } from '@/lib/remote-control-server'
import { buildWindowsAgentScriptSource } from '@/lib/remote-control-agent-script'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await authenticateWindowsAgent(request)
  if (!auth.authenticated) return auth.response!

  const source = buildWindowsAgentScriptSource()
  return new NextResponse(source, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
