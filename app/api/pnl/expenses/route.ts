/**
 * @module api/pnl/expenses
 * @description Manages store fixed operating expenses (Rent, CAM, Utilities, Insurance)
 * and shared corporate brand expenses (Meta Ads, marketing, supervision).
 * 
 * @businessRules
 * - Store operating expenses are stored per store with month_year ('DEFAULT' for base template).
 * - Shared brand expenses allow allocating corporate costs across the 15 stores.
 * - Supports two allocation methods:
 *   * 'even_split': 1/15th of the cost assigned to each store.
 *   * 'sales_weighted': Assigned proportionally to each store's net sales in the period.
 * 
 * @dataFlow
 * - Reads/Writes `store_operating_expenses`
 * - Reads/Writes `shared_brand_expenses`
 * 
 * @notes
 * - Replicates R365's Journal Entry Distribution mechanism (frame_050.jpg).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth, resolveCachedStore } from '@/lib/auth-server'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = verifyStaffAuth(request, {
    allowedRoles: ['admin', 'supervisor', 'manager', 'asistente', 'assistant']
  })
  if (!auth.authorized) return auth.response!

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase().trim()
    let isGlobalScope = !auth.user || userRole === 'admin' || userRole === 'administrador' || userRole === 'supervisor'
    let scopedKeys: string[] = []

    if (!isGlobalScope && auth.user) {
      let rawStoreId: string | number | null =
        auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id ?? null
      const numericUid = Number(auth.user.id)
      if (Number.isFinite(numericUid) && numericUid > 0) {
        const { data: dbUser } = await supabase
          .from('users')
          .select('store_id, store_scope, is_active')
          .eq('id', numericUid)
          .maybeSingle()
        if (dbUser) {
          if (dbUser.is_active === false) {
            return NextResponse.json({ error: 'Acceso denegado: Usuario inactivo.' }, { status: 403 })
          }
          if (dbUser.store_id !== null && dbUser.store_id !== undefined) rawStoreId = dbUser.store_id
          if (String(dbUser.store_scope || '').toLowerCase() === 'all' && userRole === 'general_manager') {
            isGlobalScope = true
          }
        }
      }

      if (!isGlobalScope) {
        const cached = await resolveCachedStore(rawStoreId, supabase)
        if (!cached) {
          return NextResponse.json(
            { error: 'Acceso denegado: Tu cuenta no tiene una sucursal asignada.' },
            { status: 403 }
          )
        }
        scopedKeys = [String(cached.id), cached.external_id].filter(Boolean) as string[]
      }
    }

    let seQuery = supabase
      .from('store_operating_expenses')
      .select('*')
      .order('store_name', { ascending: true })
    if (!isGlobalScope && scopedKeys.length > 0) {
      seQuery = seQuery.in('store_id', scopedKeys)
    }

    const { data: storeExpenses, error: seErr } = await seQuery
    if (seErr) throw seErr

    if (!isGlobalScope) {
      return NextResponse.json({
        storeExpenses: storeExpenses || [],
        sharedExpenses: []
      })
    }

    const { data: sharedExpenses, error: shErr } = await supabase
      .from('shared_brand_expenses')
      .select('*')
      .order('period_start', { ascending: false })

    if (shErr) throw shErr

    return NextResponse.json({
      storeExpenses: storeExpenses || [],
      sharedExpenses: sharedExpenses || []
    })
  } catch (err: any) {
    console.error('Error in GET /api/pnl/expenses:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: false })
  if (!auth.authorized) return auth.response!

  const isAdmin = ['admin', 'administrador'].includes(
    String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
  )
  const parseNonNegative = (val: unknown, fallback = 0): number | null => {
    if (val === undefined || val === null || val === '') return fallback
    const n = Number(val)
    if (!Number.isFinite(n) || n < 0) return null
    return n
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const body = await request.json()
    const { action } = body

    if (action === 'update_store_expense') {
      const { store_id, month_year, rent_monthly, cam_charges, utilities_monthly, repairs_maintenance_monthly, supplies_misc_monthly, insurance_monthly, notes } = body
      
      if (!store_id) {
        return NextResponse.json({ error: 'store_id is required' }, { status: 400 })
      }

      const rent = parseNonNegative(rent_monthly)
      const cam = parseNonNegative(cam_charges)
      const utilities = parseNonNegative(utilities_monthly)
      const rm = parseNonNegative(repairs_maintenance_monthly)
      const supplies = parseNonNegative(supplies_misc_monthly)
      const insurance = parseNonNegative(insurance_monthly)
      if ([rent, cam, utilities, rm, supplies, insurance].some(v => v === null)) {
        return NextResponse.json({ error: 'Expense amounts must be finite non-negative numbers' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('store_operating_expenses')
        .upsert({
          store_id,
          month_year: month_year || 'DEFAULT',
          rent_monthly: rent!,
          cam_charges: cam!,
          utilities_monthly: utilities!,
          repairs_maintenance_monthly: rm!,
          supplies_misc_monthly: supplies!,
          insurance_monthly: insurance!,
          notes: notes || '',
          updated_at: new Date().toISOString()
        }, { onConflict: 'store_id,month_year' })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ success: true, data })
    }

    if (action === 'delete_store_expense') {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Acceso denegado: Solo administradores pueden eliminar gastos fijos.' }, { status: 403 })
      }
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

      const { error } = await supabase
        .from('store_operating_expenses')
        .delete()
        .eq('id', id)

      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'create_shared_expense') {
      const { expense_name, category, amount, period_start, period_end, allocation_method, notes } = body
      const parsedAmount = Number(amount)
      if (!expense_name || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return NextResponse.json({ error: 'expense_name and a positive finite amount are required' }, { status: 400 })
      }

      const defaultDate = getCaliforniaBusinessDate()
      const { data, error } = await supabase
        .from('shared_brand_expenses')
        .insert({
          expense_name,
          category: category || 'marketing',
          amount: parsedAmount,
          period_start: period_start || defaultDate,
          period_end: period_end || defaultDate,
          allocation_method: allocation_method || 'even_split',
          notes: notes || ''
        })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ success: true, data })
    }

    if (action === 'update_shared_expense') {
      const { id, expense_name, category, amount, period_start, period_end, allocation_method, notes } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      
      const updateData: any = { updated_at: new Date().toISOString() }
      if (expense_name !== undefined) updateData.expense_name = expense_name
      if (category !== undefined) updateData.category = category
      if (amount !== undefined) {
        const parsedAmount = Number(amount)
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          return NextResponse.json({ error: 'amount must be a positive finite number' }, { status: 400 })
        }
        updateData.amount = parsedAmount
      }
      if (period_start !== undefined) updateData.period_start = period_start
      if (period_end !== undefined) updateData.period_end = period_end
      if (allocation_method !== undefined) updateData.allocation_method = allocation_method
      if (notes !== undefined) updateData.notes = notes

      const { data, error } = await supabase
        .from('shared_brand_expenses')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()
        
      if (error) throw error
      return NextResponse.json({ success: true, data })
    }

    if (action === 'delete_shared_expense') {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Acceso denegado: Solo administradores pueden eliminar gastos compartidos.' }, { status: 403 })
      }
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

      const { error } = await supabase
        .from('shared_brand_expenses')
        .delete()
        .eq('id', id)

      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    console.error('Error in POST /api/pnl/expenses:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
