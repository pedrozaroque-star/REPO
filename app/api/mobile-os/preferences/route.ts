/**
 * @module app/api/mobile-os/preferences/route
 * @description Endpoint de preferencias de interfaz móvil/tablet (`GET` y `PUT`) para persistir
 *              los accesos directos editables de la barra inferior (`dock_modules`) y el modo de
 *              pantalla de inicio (`home_view_mode`: `'os' | 'web'`) por usuario autenticado.
 *
 * @businessRules
 * - Protegido estrictamente mediante `verifyStaffAuth(req, { allowCron: false })` de `@/lib/auth-server`.
 * - La llave primaria `user_key` se deriva EXCLUSIVAMENTE en el servidor desde el JWT verificado
 *   (`auth.user.email` en minúsculas o `'id:' + auth.user.id`), jamás confiando en query params ni body del cliente.
 * - `dockModuleIds` acepta entre `1` y `4` identificadores alfanuméricos seguros (`<= 64` caracteres), sin duplicados.
 * - `homeViewMode` acepta estrictamente `'os'` o `'web'` (por defecto `'os'`).
 * - Soporta actualizaciones parciales (`dockModuleIds`, `homeViewMode` o ambos) sin sobrescribir la otra columna
 *   y sin incluir jamás columnas autogeneradas en PostgreSQL.
 *
 * @dataFlow
 * - `GET`: `verifyStaffAuth` -> `public.user_ui_preferences` (`service_role`) -> `{ dockModuleIds, homeViewMode }`.
 * - `PUT`: `verifyStaffAuth` -> validación de payload -> `upsert` en `public.user_ui_preferences` -> `{ ok: true, dockModuleIds, homeViewMode }`.
 *
 * @notes
 * - Cuando aún no existe fila o `dock_modules` está vacío (`[]`), `GET` devuelve `dockModuleIds: null`
 *   para que el cliente aplique los valores predeterminados según el rol del usuario.
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth, type DecodedToken } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SAFE_MODULE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/
const MIN_DOCK_SLOTS = 1
const MAX_DOCK_SLOTS = 4

type HomeViewMode = 'os' | 'web'

interface UserUiPreferencesRow {
  user_key: string
  dock_modules: unknown
  home_view_mode: string | null
  updated_at?: string
}

function deriveAuthoritativeUserKey(user: DecodedToken): string {
  const emailNorm = String(user.email || '')
    .trim()
    .toLowerCase()
  if (emailNorm) return emailNorm
  return `id:${String(user.id).trim()}`
}

function parseStoredDockIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const valid: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (SAFE_MODULE_ID_REGEX.test(trimmed) && !seen.has(trimmed)) {
      seen.add(trimmed)
      valid.push(trimmed)
      if (valid.length >= MAX_DOCK_SLOTS) break
    }
  }
  return valid.length >= MIN_DOCK_SLOTS ? valid : null
}

function parseStoredHomeViewMode(raw: unknown): HomeViewMode {
  return raw === 'web' ? 'web' : 'os'
}

export async function GET(req: Request) {
  const auth = verifyStaffAuth(req, { allowCron: false })
  if (!auth.authorized || !auth.user) {
    return (
      auth.response ??
      NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
    )
  }

  try {
    const userKey = deriveAuthoritativeUserKey(auth.user)
    const supabase = await getSupabaseAdminClient()

    const { data, error } = await supabase
      .from('user_ui_preferences')
      .select('user_key, dock_modules, home_view_mode')
      .eq('user_key', userKey)
      .maybeSingle<UserUiPreferencesRow>()

    if (error) {
      console.error('❌ [GET /api/mobile-os/preferences] Supabase error:', error.message)
      return NextResponse.json(
        { error: 'Error al consultar preferencias de interfaz.' },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json({
        dockModuleIds: null,
        homeViewMode: 'os' satisfies HomeViewMode,
      })
    }

    return NextResponse.json({
      dockModuleIds: parseStoredDockIds(data.dock_modules),
      homeViewMode: parseStoredHomeViewMode(data.home_view_mode),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno'
    console.error('❌ [GET /api/mobile-os/preferences] Unexpected error:', message)
    return NextResponse.json(
      { error: 'Error inesperado al cargar preferencias.' },
      { status: 500 }
    )
  }
}

export async function PUT(req: Request) {
  const auth = verifyStaffAuth(req, { allowCron: false })
  if (!auth.authorized || !auth.user) {
    return (
      auth.response ??
      NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
    )
  }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Cuerpo JSON inválido.' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON malformado.' }, { status: 400 })
  }

  const hasDockField = body.dockModuleIds !== undefined
  const hasModeField = body.homeViewMode !== undefined

  if (!hasDockField && !hasModeField) {
    return NextResponse.json(
      { error: 'Se requiere al menos dockModuleIds o homeViewMode.' },
      { status: 400 }
    )
  }

  let validatedDockIds: string[] | undefined
  if (hasDockField) {
    if (!Array.isArray(body.dockModuleIds)) {
      return NextResponse.json(
        { error: 'dockModuleIds debe ser un arreglo de 1 a 4 cadenas.' },
        { status: 400 }
      )
    }
    if (
      body.dockModuleIds.length < MIN_DOCK_SLOTS ||
      body.dockModuleIds.length > MAX_DOCK_SLOTS
    ) {
      return NextResponse.json(
        { error: 'dockModuleIds debe contener entre 1 y 4 módulos.' },
        { status: 400 }
      )
    }
    const deduped: string[] = []
    const seen = new Set<string>()
    for (const rawItem of body.dockModuleIds) {
      if (typeof rawItem !== 'string') {
        return NextResponse.json(
          { error: 'Cada elemento de dockModuleIds debe ser texto válido.' },
          { status: 400 }
        )
      }
      const clean = rawItem.trim()
      if (!SAFE_MODULE_ID_REGEX.test(clean)) {
        return NextResponse.json(
          { error: `Identificador de módulo inválido: "${clean.slice(0, 32)}".` },
          { status: 400 }
        )
      }
      if (!seen.has(clean)) {
        seen.add(clean)
        deduped.push(clean)
      }
    }
    if (deduped.length < MIN_DOCK_SLOTS || deduped.length > MAX_DOCK_SLOTS) {
      return NextResponse.json(
        { error: 'dockModuleIds debe conservar entre 1 y 4 módulos únicos.' },
        { status: 400 }
      )
    }
    validatedDockIds = deduped
  }

  let validatedHomeMode: HomeViewMode | undefined
  if (hasModeField) {
    if (body.homeViewMode !== 'os' && body.homeViewMode !== 'web') {
      return NextResponse.json(
        { error: "homeViewMode debe ser estrictamente 'os' o 'web'." },
        { status: 400 }
      )
    }
    validatedHomeMode = body.homeViewMode
  }

  try {
    const userKey = deriveAuthoritativeUserKey(auth.user)
    const supabase = await getSupabaseAdminClient()

    const upsertPayload: {
      user_key: string
      updated_at: string
      dock_modules?: string[]
      home_view_mode?: HomeViewMode
    } = {
      user_key: userKey,
      updated_at: new Date().toISOString(),
    }

    if (validatedDockIds !== undefined) {
      upsertPayload.dock_modules = validatedDockIds
    }
    if (validatedHomeMode !== undefined) {
      upsertPayload.home_view_mode = validatedHomeMode
    }

    const { data, error } = await supabase
      .from('user_ui_preferences')
      .upsert(upsertPayload, { onConflict: 'user_key' })
      .select('user_key, dock_modules, home_view_mode')
      .single<UserUiPreferencesRow>()

    if (error) {
      console.error('❌ [PUT /api/mobile-os/preferences] Supabase upsert error:', error.message)
      return NextResponse.json(
        { error: 'No se pudieron guardar las preferencias de interfaz.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      dockModuleIds: validatedDockIds ?? parseStoredDockIds(data?.dock_modules),
      homeViewMode: validatedHomeMode ?? parseStoredHomeViewMode(data?.home_view_mode),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno'
    console.error('❌ [PUT /api/mobile-os/preferences] Unexpected error:', message)
    return NextResponse.json(
      { error: 'Error inesperado al guardar preferencias.' },
      { status: 500 }
    )
  }
}
