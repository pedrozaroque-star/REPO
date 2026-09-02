/**
 * @module api/accounting/site-mappings
 * @description API route for managing accounting site mappings (per-store GL account configuration).
 * GET: Lists all site mappings with store names.
 * PUT: Updates a specific site mapping.
 * 
 * @businessRules
 * - Each store has exactly one site mapping defining its bank account, QB location/class,
 *   and GL account assignments.
 * - The bank_account_number is store-specific (e.g., '10000' for Azusa, '10001' for Bell).
 * - All other GL accounts are typically the same across stores (e.g., '40050' for Sales).
 * - Changes to site mappings affect all future journal entries for that store.
 * 
 * @dataFlow
 * Supabase accounting_site_mappings table ↔ this endpoint ↔ Frontend config page
 * 
 * @notes
 * - Seed data is populated by the migration script with defaults from Cohesion extraction.
 * - QB Location and Class are used as dimensions in QuickBooks journal entries.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('accounting_site_mappings')
      .select('*, stores!inner(id, name)')
      .order('store_id', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ mappings: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { store_id, ...updateFields } = body

    if (!store_id) {
      return NextResponse.json({ error: 'store_id is required' }, { status: 400 })
    }

    // Only allow updating safe fields
    const allowedFields = [
      'qb_location', 'qb_class', 'bank_account_number', 'bank_account_qb_id',
      'sales_dine_in_account', 'sales_uber_account', 'sales_doordash_account',
      'sales_grubhub_account', 'sales_tax_account', 'ar_uber_account',
      'ar_doordash_account', 'ar_grubhub_account', 'ar_postmates_account',
      'cc_fees_account', 'undeposited_funds_account', 'cash_over_short_account',
      'gift_card_account', 'open_orders_account', 'cash_on_hand_account',
      'tips_account', 'cogs_account', 'is_active',
    ]

    const safeUpdate: Record<string, any> = { updated_at: new Date().toISOString() }
    for (const key of allowedFields) {
      if (key in updateFields) {
        safeUpdate[key] = updateFields[key]
      }
    }

    const { data, error } = await supabaseAdmin
      .from('accounting_site_mappings')
      .update(safeUpdate)
      .eq('store_id', store_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ mapping: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
