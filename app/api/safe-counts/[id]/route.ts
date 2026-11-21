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
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

// ============================================================================
// PUT — Editar un conteo existente
// ============================================================================
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyStaffAuth(request, { allowCron: false })
  if (!auth.authorized || !auth.user) return auth.response!

  const supabase = await getSupabaseAdminClient()
  const { id } = await params

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Fetch existing record to check ownership, store scope, and 24h window
  const { data: existing, error: fetchError } = await supabase
    .from('safe_counts')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Count not found' }, { status: 404 })
  }

  const userRole = String(auth.user.role || auth.user.user_role || '').toLowerCase()
  const isPrivileged = userRole === 'admin' || userRole === 'administrador' || userRole === 'supervisor'

  if (!isPrivileged) {
    let callerStoreId: any =
      (auth.user as any).store_id ??
      auth.user.user_metadata?.store_id ??
      null
    let callerStoreScope: any =
      (auth.user as any).store_scope ??
      auth.user.user_metadata?.store_scope ??
      null

    if (callerStoreId === null || callerStoreId === undefined) {
      const { data: dbUser } = await supabase
        .from('users')
        .select('store_id, store_scope')
        .eq('id', auth.user.id)
        .maybeSingle()
      callerStoreId = dbUser?.store_id ?? null
      callerStoreScope = dbUser?.store_scope ?? callerStoreScope
    }

    const existingStoreStr = String(existing.store_id)
    const matchesStore =
      (callerStoreId !== null && callerStoreId !== undefined && String(callerStoreId) === existingStoreStr) ||
      (Array.isArray(callerStoreScope) && callerStoreScope.map(String).includes(existingStoreStr))

    if (!matchesStore) {
      return NextResponse.json(
        { error: 'Acceso denegado: Solo puedes editar conteos de tu propia sucursal.' },
        { status: 403 }
      )
    }

    if (body.store_id !== undefined && String(body.store_id) !== existingStoreStr) {
      return NextResponse.json(
        { error: 'Acceso denegado: No puedes reasignar un conteo a otra sucursal.' },
        { status: 403 }
      )
    }

    const countedAtMs = new Date(existing.counted_at || existing.created_at).getTime()
    if (!Number.isFinite(countedAtMs) || Date.now() - countedAtMs > 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: 'Acceso denegado: Solo Admin o Supervisor pueden editar conteos después de 24 horas.' },
        { status: 403 }
      )
    }
  }

  // Build update object (only include fields that are provided)
  const updateData: Record<string, any> = {}

  if (body.store_id !== undefined) updateData.store_id = body.store_id
  if (body.business_date !== undefined) updateData.business_date = body.business_date

  // Bills
  if (body.bills_100 !== undefined) updateData.bills_100 = Math.max(0, parseInt(body.bills_100) || 0)
  if (body.bills_50 !== undefined) updateData.bills_50 = Math.max(0, parseInt(body.bills_50) || 0)
  if (body.bills_20 !== undefined) updateData.bills_20 = Math.max(0, parseInt(body.bills_20) || 0)
  if (body.bills_10 !== undefined) updateData.bills_10 = Math.max(0, parseInt(body.bills_10) || 0)
  if (body.bills_5 !== undefined) updateData.bills_5 = Math.max(0, parseInt(body.bills_5) || 0)
  if (body.bills_1 !== undefined) updateData.bills_1 = Math.max(0, parseInt(body.bills_1) || 0)

  // Change
  if (body.packs_ones !== undefined) updateData.packs_ones = Math.max(0, parseInt(body.packs_ones) || 0)
  if (body.rolls_quarter !== undefined) updateData.rolls_quarter = Math.max(0, parseInt(body.rolls_quarter) || 0)
  if (body.rolls_dime !== undefined) updateData.rolls_dime = Math.max(0, parseInt(body.rolls_dime) || 0)
  if (body.rolls_nickel !== undefined) updateData.rolls_nickel = Math.max(0, parseInt(body.rolls_nickel) || 0)
  if (body.rolls_penny !== undefined) updateData.rolls_penny = Math.max(0, parseInt(body.rolls_penny) || 0)
  if (body.loose_change !== undefined) updateData.loose_change = Math.max(0, parseFloat(body.loose_change) || 0)

  // Drawers
  if (body.num_drawers !== undefined) updateData.num_drawers = Math.max(0, parseInt(body.num_drawers) || 0)
  if (body.drawer_stock !== undefined) updateData.drawer_stock = Math.max(0, parseFloat(body.drawer_stock) || 0)

  // Uniforms
  if (body.uniforms_amount !== undefined) updateData.uniforms_amount = Math.max(0, parseFloat(body.uniforms_amount) || 0)

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
  const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'] })
  if (!auth.authorized) return auth.response!

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
