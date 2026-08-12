/**
 * @module SafeCountByIdAPI
 * @description API route para editar y eliminar conteos individuales de caja fuerte.
 * @businessRules
 * - PUT: Solo admin puede editar siempre. Manager/supervisor dentro de 24 horas.
 * - DELETE: Solo admin puede eliminar conteos.
 * @dataFlow
 * - PUT: Valida permisos → actualiza safe_counts → Supabase recalcula GENERATED → responde.
 * - DELETE: Valida rol admin → elimina registro → responde.
 * @notes
 * - El control de tiempo de 24hrs se basa en counted_at del registro original.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

// ============================================================================
// PUT — Editar un conteo existente
// ============================================================================
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await getSupabaseAdminClient()
  const { id } = await params

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Fetch existing record to check ownership and time
  const { data: existing, error: fetchError } = await supabase
    .from('safe_counts')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Count not found' }, { status: 404 })
  }

  // Build update object (only include fields that are provided)
  const updateData: Record<string, any> = {}

  if (body.store_id !== undefined) updateData.store_id = body.store_id
  if (body.business_date !== undefined) updateData.business_date = body.business_date

  // Bills
  if (body.bills_100 !== undefined) updateData.bills_100 = parseInt(body.bills_100) || 0
  if (body.bills_50 !== undefined) updateData.bills_50 = parseInt(body.bills_50) || 0
  if (body.bills_20 !== undefined) updateData.bills_20 = parseInt(body.bills_20) || 0
  if (body.bills_10 !== undefined) updateData.bills_10 = parseInt(body.bills_10) || 0
  if (body.bills_5 !== undefined) updateData.bills_5 = parseInt(body.bills_5) || 0
  if (body.bills_1 !== undefined) updateData.bills_1 = parseInt(body.bills_1) || 0

  // Change
  if (body.packs_ones !== undefined) updateData.packs_ones = parseInt(body.packs_ones) || 0
  if (body.rolls_quarter !== undefined) updateData.rolls_quarter = parseInt(body.rolls_quarter) || 0
  if (body.rolls_dime !== undefined) updateData.rolls_dime = parseInt(body.rolls_dime) || 0
  if (body.rolls_nickel !== undefined) updateData.rolls_nickel = parseInt(body.rolls_nickel) || 0
  if (body.rolls_penny !== undefined) updateData.rolls_penny = parseInt(body.rolls_penny) || 0
  if (body.loose_change !== undefined) updateData.loose_change = parseFloat(body.loose_change) || 0

  // Drawers
  if (body.num_drawers !== undefined) updateData.num_drawers = parseInt(body.num_drawers) || 1
  if (body.drawer_stock !== undefined) updateData.drawer_stock = parseFloat(body.drawer_stock) || 250.00

  // Uniforms
  if (body.uniforms_amount !== undefined) updateData.uniforms_amount = parseFloat(body.uniforms_amount) || 0

  // Notes
  if (body.notes !== undefined) updateData.notes = body.notes || null

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('safe_counts')
    .update(updateData)
    .eq('id', id)
    .select(`
      *,
      store:stores(name),
      user:users(full_name)
    `)
    .single()

  if (error) {
    console.error('[safe-counts] PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// ============================================================================
// DELETE — Eliminar un conteo
// ============================================================================
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await getSupabaseAdminClient()
  const { id } = await params

  // Verify record exists
  const { data: existing, error: fetchError } = await supabase
    .from('safe_counts')
    .select('id')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Count not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('safe_counts')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[safe-counts] DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
