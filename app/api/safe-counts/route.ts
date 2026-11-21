/**
 * @module SafeCountsAPI
 * @description API route para gestionar conteos de caja fuerte (Cash Safe).
 * GET lista conteos con diferencias calculadas, POST crea nuevos conteos.
 * @businessRules
 * - `GET` exige `authorizeStoreScope` (`store_id=all` permitido ÚNICAMENTE para `admin`/`supervisor`; roles de sucursal quedan restringidos estrictamente a su `store_id` asignada).
 * - `GET` calcula la diferencia entre cada conteo y el anterior de la misma tienda.
 * - `POST` valida el alcance de sucursal (`authorizeStoreScope`) y establece `counted_by` estrictamente en servidor desde el usuario autenticado (`public.users.id`), rechazando cualquier suplantación del cliente y devolviendo `counted_by_name` desde `user.full_name || auth.user.name || auth.user.email`.
 * - Los totales (`bills_total`, `coins_total`, `drawers_total`, `grand_total`) son `GENERATED` en Supabase — jamás se envían.
 * @dataFlow
 * - GET: `verifyStaffAuth` + `authorizeStoreScope` -> Supabase `safe_counts` + joins a `stores`/`users` -> calcula diferencias -> responde array.
 * - POST: `verifyStaffAuth` + `authorizeStoreScope` + resolución autoritativa de `counted_by` -> inserta en `safe_counts` -> responde registro.
 * @notes
 * - Usa `getSupabaseAdminClient()` para bypass RLS con control de acceso estricto en servidor.
 * - Blindaje de Seguridad (2026-11-21): bloqueo de `store_id=all` para roles no globales y eliminación de confianza en `body.counted_by`.
 */

import { NextResponse } from 'next/server'
import { authorizeStoreScope, getServerUser, verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { fetchUniformsSafeBalance } from '@/app/inventory/uniforms/actions'
import type { UniformsSafeBalance } from '@/app/inventory/uniforms/utils'

async function resolveAuthenticatedSafeUser(request: Request, supabase: any, tokenUser: any) {
  const base = (await getServerUser(request)) || {
    id: String(tokenUser.id || tokenUser.sub || ''),
    email: String(tokenUser.email || ''),
    name: String(tokenUser.user_metadata?.full_name || tokenUser.email || ''),
    role: String(tokenUser.role || tokenUser.user_role || '').toLowerCase(),
    store_id: tokenUser.user_metadata?.store_id,
    store_ids: tokenUser.user_metadata?.store_ids,
    store_scope: tokenUser.user_metadata?.store_scope,
  }

  let dbUserRow: any = null
  const numId = Number(base.id)
  if (Number.isFinite(numId) && numId > 0) {
    const { data } = await supabase
      .from('users')
      .select('id, email, full_name, role, store_id, store_scope, is_active')
      .eq('id', numId)
      .maybeSingle()
    dbUserRow = data
  }
  if (!dbUserRow && base.email) {
    const safeEmail = String(base.email).trim().replace(/[\\%_]/g, '\\$&')
    const { data } = await supabase
      .from('users')
      .select('id, email, full_name, role, store_id, store_scope, is_active')
      .ilike('email', safeEmail)
      .maybeSingle()
    dbUserRow = data
  }

  if (dbUserRow) {
    base.id = String(dbUserRow.id)
    base.name = String(dbUserRow.full_name || base.name || base.email)
    if (dbUserRow.role) base.role = String(dbUserRow.role).toLowerCase()
    if (dbUserRow.store_id !== null && dbUserRow.store_id !== undefined) base.store_id = dbUserRow.store_id
    if (dbUserRow.store_scope !== undefined) base.store_scope = dbUserRow.store_scope
  }

  const authoritativeUserId = Number(dbUserRow?.id ?? numId)
  const displayName = String(dbUserRow?.full_name || base.name || base.email || 'Staff')

  return {
    serverUser: base,
    authoritativeUserId: Number.isFinite(authoritativeUserId) && authoritativeUserId > 0 ? authoritativeUserId : null,
    displayName,
    isActive: dbUserRow ? dbUserRow.is_active !== false : true,
  }
}

// ============================================================================
// GET — Listar conteos con diferencias y sincronización en vivo con Uniformes
// ============================================================================
export async function GET(request: Request) {
  const auth = verifyStaffAuth(request, { allowCron: false })
  if (!auth.authorized || !auth.user) return auth.response!

  const supabase = await getSupabaseAdminClient()
  const { serverUser, isActive } = await resolveAuthenticatedSafeUser(request, supabase, auth.user)
  if (!isActive) {
    return NextResponse.json({ error: 'Usuario inactivo.' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const storeIdParam = searchParams.get('store_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const parsedLimit = parseInt(searchParams.get('limit') || '500', 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 500

  let effectiveStoreId: number | string | null = null

  if (storeIdParam && storeIdParam.trim().toLowerCase() === 'all') {
    // store_id=all permitido EXCLUSIVAMENTE para admin / supervisor
    const allScope = await authorizeStoreScope(serverUser, 'ALL', supabase, {
      action: 'view',
      allowComparativeAll: false,
    })
    if (!allScope.authorized) {
      return NextResponse.json({ error: allScope.error || 'Acceso denegado a todas las sucursales.' }, { status: allScope.status || 403 })
    }
  } else if (storeIdParam && storeIdParam.trim() !== '') {
    const targetScope = await authorizeStoreScope(serverUser, storeIdParam, supabase, {
      action: 'view',
    })
    if (!targetScope.authorized) {
      return NextResponse.json({ error: targetScope.error || 'Acceso denegado a esta sucursal.' }, { status: targetScope.status || 403 })
    }
    effectiveStoreId = targetScope.resolvedStoreId ?? storeIdParam
  } else {
    // Sin store_id explícito: admin/supervisor ven todas; gerentes/asistentes/shift_leaders quedan restringidos a su tienda
    const roleLower = String(serverUser.role || '').toLowerCase()
    const isGlobal = roleLower === 'admin' || roleLower === 'administrador' || roleLower === 'supervisor'
    if (!isGlobal) {
      const ownScope = await authorizeStoreScope(serverUser, serverUser.store_id, supabase, { action: 'view' })
      if (!ownScope.authorized || !ownScope.resolvedStoreId) {
        return NextResponse.json(
          { error: ownScope.error || 'Tu cuenta no tiene una sucursal autorizada.' },
          { status: ownScope.status || 403 }
        )
      }
      effectiveStoreId = ownScope.resolvedStoreId
    }
  }

  let query = supabase
    .from('safe_counts')
    .select(`
      *,
      store:stores(name),
      user:users(full_name)
    `)
    .order('counted_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (effectiveStoreId !== null) {
    query = query.eq('store_id', effectiveStoreId)
  }
  if (from) {
    query = query.gte('business_date', from)
  }
  if (to) {
    query = query.lte('business_date', to)
  }

  const { data: counts, error } = await query

  if (error) {
    console.error('[safe-counts] GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const uniqueStoreIds = Array.from(
    new Set((counts || []).map((c: any) => Number(c.store_id)).filter((id: number) => !isNaN(id)))
  )
  const balanceEntries = await Promise.all(
    uniqueStoreIds.map(async (sId) => {
      try {
        const bal = await fetchUniformsSafeBalance(sId)
        return [sId, bal] as const
      } catch {
        return [sId, null] as const
      }
    })
  )
  const storeBalanceMap = new Map<number, UniformsSafeBalance | null>(balanceEntries)

  const countsWithDiff = await Promise.all((counts || []).map(async (count: any, index: number, arr: any[]) => {
    let previousTotal: number | null = null
    for (let i = index + 1; i < arr.length; i++) {
      if (String(arr[i].store_id) === String(count.store_id)) {
        previousTotal = parseFloat(arr[i].grand_total)
        break
      }
    }

    if (previousTotal === null && count.counted_at) {
      const { data: prevRecord } = await supabase
        .from('safe_counts')
        .select('grand_total')
        .eq('store_id', count.store_id)
        .lt('counted_at', count.counted_at)
        .order('counted_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (prevRecord && prevRecord.grand_total !== null && prevRecord.grand_total !== undefined) {
        previousTotal = parseFloat(prevRecord.grand_total)
      }
    }

    const storeBalance = storeBalanceMap.get(Number(count.store_id)) || null
    const isLatestForStore = Boolean(storeBalance && String(storeBalance.lastSafeCountId) === String(count.id))
    const baseUniformsAmount = Math.round((parseFloat(count.uniforms_amount) || 0) * 100) / 100
    const uniformsSalesSinceCount = isLatestForStore ? (storeBalance?.accumulatedSalesSinceCount || 0) : 0
    const uniformsSalesCountSince = isLatestForStore ? (storeBalance?.salesCountSinceCount || 0) : 0
    const liveUniformsAmount = isLatestForStore ? (storeBalance?.totalInSafe ?? baseUniformsAmount) : baseUniformsAmount

    const currentTotal = parseFloat(count.grand_total) || 0
    const liveGrandTotal = Math.round((currentTotal + uniformsSalesSinceCount) * 100) / 100
    const difference = previousTotal !== null ? Math.round((liveGrandTotal - previousTotal) * 100) / 100 : null

    return {
      ...count,
      difference,
      counted_by_name: count.user?.full_name || 'Unknown',
      store_name: count.store?.name || 'Unknown',
      is_latest_for_store: isLatestForStore,
      base_uniforms_amount: baseUniformsAmount,
      uniforms_sales_since_count: uniformsSalesSinceCount,
      uniforms_sales_count_since: uniformsSalesCountSince,
      live_uniforms_amount: liveUniformsAmount,
      live_grand_total: liveGrandTotal,
    }
  }))

  return NextResponse.json({ counts: countsWithDiff })
}

// ============================================================================
// POST — Crear nuevo conteo (con alcance por sucursal y counted_by autoritativo)
// ============================================================================
export async function POST(request: Request) {
  const auth = verifyStaffAuth(request, { allowCron: false })
  if (!auth.authorized || !auth.user) return auth.response!

  const supabase = await getSupabaseAdminClient()
  const { serverUser, authoritativeUserId, displayName, isActive } = await resolveAuthenticatedSafeUser(
    request,
    supabase,
    auth.user
  )

  if (!isActive) {
    return NextResponse.json({ error: 'Usuario inactivo.' }, { status: 403 })
  }
  if (!authoritativeUserId) {
    return NextResponse.json(
      { error: 'No se pudo resolver el identificador numérico del usuario autenticado (counted_by).' },
      { status: 403 }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.store_id) {
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 })
  }
  if (!body.business_date) {
    return NextResponse.json({ error: 'business_date is required' }, { status: 400 })
  }

  const scopeCheck = await authorizeStoreScope(serverUser, body.store_id, supabase, {
    action: 'complete_checklist',
  })
  if (!scopeCheck.authorized) {
    return NextResponse.json(
      { error: scopeCheck.error || 'No tienes permiso para registrar conteos en otra sucursal.' },
      { status: scopeCheck.status || 403 }
    )
  }

  const resolvedStoreId = scopeCheck.resolvedStoreId ?? Number(body.store_id)
  if (!Number.isFinite(resolvedStoreId) || resolvedStoreId <= 0) {
    return NextResponse.json({ error: 'store_id inválido.' }, { status: 400 })
  }

  // Prepare insert data (only writable fields; GENERATED columns excluded; counted_by derived strictly from server auth)
  const insertData = {
    store_id: resolvedStoreId,
    counted_by: authoritativeUserId,
    business_date: body.business_date,
    counted_at: new Date().toISOString(),

    // Bills
    bills_100: Math.max(0, parseInt(body.bills_100) || 0),
    bills_50: Math.max(0, parseInt(body.bills_50) || 0),
    bills_20: Math.max(0, parseInt(body.bills_20) || 0),
    bills_10: Math.max(0, parseInt(body.bills_10) || 0),
    bills_5: Math.max(0, parseInt(body.bills_5) || 0),
    bills_1: Math.max(0, parseInt(body.bills_1) || 0),

    // Change (rolls/packs)
    packs_ones: Math.max(0, parseInt(body.packs_ones) || 0),
    rolls_quarter: Math.max(0, parseInt(body.rolls_quarter) || 0),
    rolls_dime: Math.max(0, parseInt(body.rolls_dime) || 0),
    rolls_nickel: Math.max(0, parseInt(body.rolls_nickel) || 0),
    rolls_penny: Math.max(0, parseInt(body.rolls_penny) || 0),
    loose_change: Math.max(0, parseFloat(body.loose_change) || 0),

    // Drawers
    num_drawers: body.num_drawers !== undefined && body.num_drawers !== null && body.num_drawers !== ''
      ? Math.max(0, parseInt(body.num_drawers) || 0)
      : 1,
    drawer_stock: body.drawer_stock !== undefined && body.drawer_stock !== null && body.drawer_stock !== ''
      ? Math.max(0, parseFloat(body.drawer_stock) || 0)
      : 250.00,

    // Uniforms
    uniforms_amount: Math.max(0, parseFloat(body.uniforms_amount) || 0),

    // Notes
    notes: body.notes ? String(body.notes).slice(0, 1000) : null,
  }

  const { data, error } = await supabase
    .from('safe_counts')
    .insert(insertData)
    .select(`
      *,
      store:stores(name),
      user:users(full_name)
    `)
    .single()

  if (error) {
    console.error('[safe-counts] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      ...data,
      counted_by_name: data?.user?.full_name || displayName,
    },
    { status: 201 }
  )
}
