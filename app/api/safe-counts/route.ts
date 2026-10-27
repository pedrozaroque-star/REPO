/**
 * @module SafeCountsAPI
 * @description API route para gestionar conteos de caja fuerte (Cash Safe).
 * GET lista conteos con diferencias calculadas, POST crea nuevos conteos.
 * @businessRules
 * - GET calcula la diferencia entre cada conteo y el anterior de la misma tienda.
 * - POST requiere store_id, business_date y al menos un campo de conteo.
 * - Los totales (bills_total, coins_total, etc.) son GENERATED en Supabase — no se envían.
 * @dataFlow
 * - GET: Supabase safe_counts + joins a stores/users → calcula diferencias → responde array.
 * - POST: Valida body → inserta en safe_counts → Supabase calcula GENERATED → responde registro.
 * @notes
 * - Usa getSupabaseAdminClient() para bypass RLS ya que la tabla no tiene políticas configuradas.
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { fetchUniformsSafeBalance } from '@/app/inventory/uniforms/actions'
import type { UniformsSafeBalance } from '@/app/inventory/uniforms/utils'

// ============================================================================
// GET — Listar conteos con diferencias y sincronización en vivo con Uniformes
// ============================================================================
export async function GET(request: Request) {
  const auth = await verifyStaffAuth(request)
  if (!auth.authorized) return auth.response!

  const supabase = await getSupabaseAdminClient()
  const { searchParams } = new URL(request.url)

  const storeId = searchParams.get('store_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') || '500')

  // Build query — order by counted_at DESC, created_at DESC to match fetchUniformsSafeBalance
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

  if (storeId && storeId !== 'all') {
    query = query.eq('store_id', storeId)
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

  // Fetch cumulative uniform balance for all unique stores in the result set
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

  // Calculate differences between consecutive counts per store
  const countsWithDiff = await Promise.all((counts || []).map(async (count: any, index: number, arr: any[]) => {
    // Find the next (older) count for the same store
    let previousTotal: number | null = null
    for (let i = index + 1; i < arr.length; i++) {
      if (String(arr[i].store_id) === String(count.store_id)) {
        previousTotal = parseFloat(arr[i].grand_total)
        break
      }
    }

    if (previousTotal === null && count.counted_at) {
      // Lookup previous count strictly older than count.counted_at (handles same-day multiple counts & limit/from cutoffs)
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
// POST — Crear nuevo conteo
// ============================================================================
export async function POST(request: Request) {
  const auth = await verifyStaffAuth(request)
  if (!auth.authorized) return auth.response!

  const supabase = await getSupabaseAdminClient()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate required fields
  if (!body.store_id) {
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 })
  }
  if (!body.business_date) {
    return NextResponse.json({ error: 'business_date is required' }, { status: 400 })
  }
  if (!body.counted_by) {
    return NextResponse.json({ error: 'counted_by is required' }, { status: 400 })
  }

  // Prepare insert data (only writable fields, GENERATED columns are excluded)
  const insertData = {
    store_id: body.store_id,
    counted_by: parseInt(body.counted_by) || body.counted_by,
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
    notes: body.notes || null,
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

  return NextResponse.json(data, { status: 201 })
}
