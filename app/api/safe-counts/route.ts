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
import { getSupabaseAdminClient } from '@/lib/supabase'

// ============================================================================
// GET — Listar conteos con diferencias
// ============================================================================
export async function GET(request: Request) {
  const supabase = await getSupabaseAdminClient()
  const { searchParams } = new URL(request.url)

  const storeId = searchParams.get('store_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') || '100')

  // Build query
  let query = supabase
    .from('safe_counts')
    .select(`
      *,
      store:stores(name),
      user:users(full_name)
    `)
    .order('business_date', { ascending: false })
    .order('counted_at', { ascending: false })
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

    if (previousTotal === null && from) {
      // Lookup previous count prior to 'from' range
      const { data: prevRecord } = await supabase
        .from('safe_counts')
        .select('grand_total')
        .eq('store_id', count.store_id)
        .lt('business_date', count.business_date)
        .order('business_date', { ascending: false })
        .order('counted_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (prevRecord && prevRecord.grand_total !== null && prevRecord.grand_total !== undefined) {
        previousTotal = parseFloat(prevRecord.grand_total)
      }
    }

    const currentTotal = parseFloat(count.grand_total)
    const difference = previousTotal !== null ? currentTotal - previousTotal : null

    return {
      ...count,
      difference,
      counted_by_name: count.user?.full_name || 'Unknown',
      store_name: count.store?.name || 'Unknown',
    }
  }))

  return NextResponse.json({ counts: countsWithDiff })
}

// ============================================================================
// POST — Crear nuevo conteo
// ============================================================================
export async function POST(request: Request) {
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
    bills_100: parseInt(body.bills_100) || 0,
    bills_50: parseInt(body.bills_50) || 0,
    bills_20: parseInt(body.bills_20) || 0,
    bills_10: parseInt(body.bills_10) || 0,
    bills_5: parseInt(body.bills_5) || 0,
    bills_1: parseInt(body.bills_1) || 0,

    // Change (rolls/packs)
    packs_ones: parseInt(body.packs_ones) || 0,
    rolls_quarter: parseInt(body.rolls_quarter) || 0,
    rolls_dime: parseInt(body.rolls_dime) || 0,
    rolls_nickel: parseInt(body.rolls_nickel) || 0,
    rolls_penny: parseInt(body.rolls_penny) || 0,
    loose_change: parseFloat(body.loose_change) || 0,

    // Drawers
    num_drawers: parseInt(body.num_drawers) || 1,
    drawer_stock: parseFloat(body.drawer_stock) || 250.00,

    // Uniforms
    uniforms_amount: parseFloat(body.uniforms_amount) || 0,

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
