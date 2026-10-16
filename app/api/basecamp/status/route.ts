/**
 * @module api/basecamp/status
 * @description Ruta GET que verifica el estado global de la integración de Basecamp.
 *              Determina si existe un token de acceso guardado en Supabase.
 *
 * @businessRules
 * - **Estado Global**: La integración es a nivel de cuenta (global). Si existe algún token
 *   válido en `bc_oauth_tokens`, el sistema se considera "autorizado".
 * - **Seguridad**: No expone el token en sí, solo un indicador booleano.
 *
 * @dataFlow
 * - GET /api/basecamp/status → Consulta bc_oauth_tokens (service role) → Retorna { authorized: boolean, last_updated: string }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    )

    const [tokenRes, lastSuccessSyncRes, latestSyncRes] = await Promise.all([
      supabase
        .from('bc_oauth_tokens')
        .select('updated_at, expires_at')
        .order('updated_at', { ascending: false })
        .limit(1),
      supabase
        .from('bc_sync_log')
        .select('id, started_at, completed_at, records_synced, status')
        .in('status', ['completed', 'completed_with_errors'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('bc_sync_log')
        .select('id, status, started_at, completed_at, error_message')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (tokenRes.error) {
      throw tokenRes.error
    }

    const authorized = Boolean(tokenRes.data && tokenRes.data.length > 0)
    const lastSuccessAt = lastSuccessSyncRes.data?.completed_at || lastSuccessSyncRes.data?.started_at || null
    const ageMs = lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() : Infinity
    const isStale = ageMs > 3 * 60 * 1000 // Stale if older than 3 minutes
    const isRunning =
      latestSyncRes.data?.status === 'running' &&
      Date.now() - new Date(latestSyncRes.data.started_at).getTime() < 15 * 60 * 1000

    return NextResponse.json({
      authorized,
      token_expires_at: authorized ? tokenRes.data![0].expires_at : null,
      last_updated: lastSuccessAt || (authorized ? tokenRes.data![0].updated_at : null),
      last_synced_at: lastSuccessAt,
      last_sync_status: latestSyncRes.data?.status || null,
      last_sync_error: latestSyncRes.data?.status === 'failed' ? latestSyncRes.data?.error_message : null,
      is_running: Boolean(isRunning),
      is_stale: isStale,
      age_seconds: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null,
    })
  } catch (error: any) {
    console.error('❌ [Basecamp Status] Error checking status:', error.message)
    return NextResponse.json(
      { error: `Failed to check status: ${error.message}` },
      { status: 500 }
    )
  }
}
