/**
 * @module api/basecamp/status
 * @description Rutas GET y POST que gestionan el estado operativo y el modo de autonomía (`hybrid` | `standalone`)
 *              del módulo Basecamp de Tacos Gavilan sobre `public.bc_system_config`.
 *
 * @businessRules
 * - **Cero Bloqueo OAuth (`authorized`)**: `authorized` es `true` siempre que exista conexión OAuth
 *   (`oauth_connected`), el modo sea `standalone`, o existan proyectos locales en Supabase (`has_local_data`).
 *   Así `/basecamp` jamás bloquea al personal cuando se cancela la suscripción externa de Basecamp 3.
 * - **Lectura (`GET`)**: Accesible para personal autorizado incluyendo el rol `'basecamp'` (`BASECAMP_STAFF_ALLOWED_ROLES`).
 * - **Mutación (`POST`)**: Estrictamente restringida a Administradores activos (`verifyAdminAuth`, `allowCron: false`)
 *   para alternar `runtime_mode` (`'hybrid' | 'standalone'`) y `auto_cutover_enabled`.
 *
 * @dataFlow
 * - GET /api/basecamp/status -> `bc_system_config` + `bc_oauth_tokens` + `bc_sync_log` + `bc_projects(count)` -> Estado completo
 * - POST /api/basecamp/status -> `verifyAdminAuth` -> `updateBasecampSystemConfig` -> Estado actualizado
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerUser, verifyAdminAuth, verifyStaffAuth } from '@/lib/auth-server'
import {
  BASECAMP_STAFF_ALLOWED_ROLES,
  getBasecampSystemConfig,
  updateBasecampSystemConfig,
  type BasecampRuntimeMode,
  type BasecampSystemConfig,
} from '@/lib/basecamp-api'

export const dynamic = 'force-dynamic'

function getStatusSupabase() {
  return createClient(
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
}

async function buildStatusPayload(supabase: any, configOverride?: BasecampSystemConfig) {
  const [systemConfig, tokenRes, lastSuccessSyncRes, latestSyncRes, projectsCountRes] = await Promise.all([
    configOverride ? Promise.resolve(configOverride) : getBasecampSystemConfig(),
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
    supabase.from('bc_projects').select('id', { count: 'exact', head: true }),
  ])

  if (tokenRes.error) {
    throw tokenRes.error
  }

  const oauthConnected = Boolean(tokenRes.data && tokenRes.data.length > 0)
  const runtimeMode: BasecampRuntimeMode =
    systemConfig.runtime_mode === 'standalone' ? 'standalone' : 'hybrid'
  const standalone = runtimeMode === 'standalone'
  const projectsCount = projectsCountRes.count ?? 0
  const hasLocalData = projectsCount > 0

  // CRITICAL: Never block staff when standalone is active or local project data exists in Supabase
  const authorized = Boolean(oauthConnected || standalone || hasLocalData)

  const lastSuccessAt =
    lastSuccessSyncRes.data?.completed_at || lastSuccessSyncRes.data?.started_at || null
  const ageMs = lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() : Infinity
  const isStale = standalone ? false : ageMs > 3 * 60 * 1000
  const isRunning = standalone
    ? false
    : latestSyncRes.data?.status === 'running' &&
      Date.now() - new Date(latestSyncRes.data.started_at).getTime() < 15 * 60 * 1000

  return {
    authorized,
    oauth_connected: oauthConnected,
    runtime_mode: runtimeMode,
    standalone,
    auto_cutover_enabled: Boolean(systemConfig.auto_cutover_enabled),
    standalone_activated_at: systemConfig.standalone_activated_at || null,
    standalone_reason: systemConfig.standalone_reason || null,
    updated_by: systemConfig.updated_by || null,
    has_local_data: hasLocalData,
    projects_count: projectsCount,
    token_expires_at: oauthConnected ? tokenRes.data![0].expires_at : null,
    last_updated:
      lastSuccessAt ||
      systemConfig.updated_at ||
      (oauthConnected ? tokenRes.data![0].updated_at : null),
    last_synced_at: lastSuccessAt,
    last_sync_status: latestSyncRes.data?.status || null,
    last_sync_error:
      standalone
        ? null
        : latestSyncRes.data?.status === 'failed'
        ? latestSyncRes.data?.error_message
        : null,
    is_running: Boolean(isRunning),
    is_stale: isStale,
    age_seconds: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null,
  }
}

export async function GET(request: Request) {
  const auth = verifyStaffAuth(request, {
    allowCron: false,
    allowedRoles: BASECAMP_STAFF_ALLOWED_ROLES,
  })
  if (!auth.authorized) {
    return auth.response!
  }

  try {
    const supabase = getStatusSupabase()
    const payload = await buildStatusPayload(supabase)
    return NextResponse.json(payload)
  } catch (error: any) {
    console.error('❌ [Basecamp Status] Error checking status:', error.message)
    return NextResponse.json(
      { error: `Failed to check status: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const adminAuth = verifyAdminAuth(request, { allowCron: false })
  if (!adminAuth.authorized) {
    return adminAuth.response!
  }

  const serverUser = await getServerUser(request)
  const serverRole = String(serverUser?.role || '').trim().toLowerCase()
  if (!serverUser || (serverRole !== 'admin' && serverRole !== 'administrador')) {
    return NextResponse.json(
      { error: 'Acceso denegado: Se requieren permisos de Administrador' },
      { status: 403 }
    )
  }

  try {
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const rawMode = body?.runtime_mode ?? body?.runtimeMode
    const rawAutoCutover = body?.auto_cutover_enabled ?? body?.autoCutoverEnabled

    if (rawMode !== undefined && rawMode !== 'hybrid' && rawMode !== 'standalone') {
      return NextResponse.json(
        { error: "Invalid runtime_mode. Expected 'hybrid' or 'standalone'." },
        { status: 400 }
      )
    }

    if (rawAutoCutover !== undefined && typeof rawAutoCutover !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid auto_cutover_enabled. Expected boolean.' },
        { status: 400 }
      )
    }

    if (rawMode === undefined && rawAutoCutover === undefined) {
      return NextResponse.json(
        { error: 'Must provide runtime_mode and/or auto_cutover_enabled' },
        { status: 400 }
      )
    }

    const explicitReason =
      body?.reason !== undefined
        ? body.reason === null
          ? null
          : String(body.reason).trim().slice(0, 240)
        : rawMode === 'standalone'
        ? 'manual_admin_switch'
        : rawMode === 'hybrid'
        ? null
        : undefined

    const updatedCfg = await updateBasecampSystemConfig({
      runtimeMode: rawMode,
      autoCutoverEnabled: rawAutoCutover,
      reason: explicitReason,
      updatedBy: serverUser.email || adminAuth.user?.email || 'admin',
    })

    const supabase = getStatusSupabase()
    const payload = await buildStatusPayload(supabase, updatedCfg)
    return NextResponse.json({
      success: true,
      ...payload,
    })
  } catch (error: any) {
    console.error('❌ [Basecamp Status POST] Error updating system config:', error.message)
    return NextResponse.json(
      { error: `Failed to update Basecamp system config: ${error.message}` },
      { status: 500 }
    )
  }
}
