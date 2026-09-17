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
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: storeExpenses, error: seErr } = await supabase
      .from('store_operating_expenses')
      .select('*')
      .order('store_name', { ascending: true })

    if (seErr) throw seErr

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

      const { data, error } = await supabase
        .from('store_operating_expenses')
        .upsert({
          store_id,
          month_year: month_year || 'DEFAULT',
          rent_monthly: Number(rent_monthly || 0),
          cam_charges: Number(cam_charges || 0),
          utilities_monthly: Number(utilities_monthly || 0),
          repairs_maintenance_monthly: Number(repairs_maintenance_monthly || 0),
          supplies_misc_monthly: Number(supplies_misc_monthly || 0),
          insurance_monthly: Number(insurance_monthly || 0),
          notes: notes || '',
          updated_at: new Date().toISOString()
        }, { onConflict: 'store_id,month_year' })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ success: true, data })
    }

    if (action === 'delete_store_expense') {
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
      
      if (!expense_name || !amount) {
        return NextResponse.json({ error: 'expense_name and amount are required' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('shared_brand_expenses')
        .insert({
          expense_name,
          category: category || 'marketing',
          amount: Number(amount),
          period_start: period_start || new Date().toISOString().split('T')[0],
          period_end: period_end || new Date().toISOString().split('T')[0],
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
      if (amount !== undefined) updateData.amount = Number(amount)
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
