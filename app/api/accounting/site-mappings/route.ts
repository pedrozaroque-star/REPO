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

    const formatted = (data || []).map((m: any) => ({
      ...m,
      discountAccount: m.discount_account ?? '40010',
      incCustomerReceivables: m.inc_customer_receivables ?? false,
      addCustomerNameMemo: m.add_customer_name_memo ?? false,
      addRevenueCenterMemo: m.add_revenue_center_memo ?? false,
      ccFeeValidation: m.cc_fee_validation ?? 'Warn',
      checkOpenOrders: m.check_open_orders ?? true,
      taxFacilitatorEnabled: m.tax_facilitator_enabled ?? true,
      altMemos: m.alt_memos ?? {},
      lineClassOverrides: m.line_class_overrides ?? {},
    }))

    return NextResponse.json({ mappings: formatted })
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
      'discount_account', 'inc_customer_receivables', 'add_customer_name_memo',
      'add_revenue_center_memo', 'cc_fee_validation', 'check_open_orders',
      'tax_facilitator_enabled', 'alt_memos', 'line_class_overrides', 'settings_json',
      'discountAccount', 'incCustomerReceivables', 'addCustomerNameMemo',
      'addRevenueCenterMemo', 'ccFeeValidation', 'checkOpenOrders',
    ]

    const safeUpdate: Record<string, any> = { updated_at: new Date().toISOString() }
    for (const key of allowedFields) {
      if (key in updateFields) {
        safeUpdate[key] = updateFields[key]
      }
    }

    // Map camelCase workflow settings to snake_case column names if provided
    if ('discountAccount' in updateFields) safeUpdate.discount_account = updateFields.discountAccount
    if ('incCustomerReceivables' in updateFields) safeUpdate.inc_customer_receivables = updateFields.incCustomerReceivables
    if ('addCustomerNameMemo' in updateFields) safeUpdate.add_customer_name_memo = updateFields.addCustomerNameMemo
    if ('addRevenueCenterMemo' in updateFields) safeUpdate.add_revenue_center_memo = updateFields.addRevenueCenterMemo
    if ('ccFeeValidation' in updateFields) safeUpdate.cc_fee_validation = updateFields.ccFeeValidation
    if ('checkOpenOrders' in updateFields) safeUpdate.check_open_orders = updateFields.checkOpenOrders

    // Remove transient camelCase keys from safeUpdate so Postgres only receives real column names
    delete safeUpdate.discountAccount
    delete safeUpdate.incCustomerReceivables
    delete safeUpdate.addCustomerNameMemo
    delete safeUpdate.addRevenueCenterMemo
    delete safeUpdate.ccFeeValidation
    delete safeUpdate.checkOpenOrders

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

export const PATCH = PUT

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, store_id } = body as { action: string; store_id?: number }

    if (action === 'restore' && store_id) {
      // Get store name
      const { data: store } = await supabaseAdmin.from('stores').select('name').eq('id', store_id).single()
      if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

      const { getQBStoreRefs } = await import('@/lib/qb-classes-locations')
      const refs = getQBStoreRefs(store.name)

      const isCentralOrBroadway = 
        store.name.toLowerCase().includes('central') || 
        store.name.toLowerCase().includes('broadway')

      const restoredPayload = {
        qb_location: refs.locationName,
        qb_class: refs.className,
        bank_account_number: refs.bankAccount,
        bank_account_qb_id: refs.bankAccountQbId,
        sales_dine_in_account: '40050',
        sales_uber_account: '40060',
        sales_doordash_account: '40062',
        sales_grubhub_account: '40063',
        sales_tax_account: '24001',
        ar_uber_account: '12050',
        ar_doordash_account: '12053',
        ar_grubhub_account: '12054',
        ar_postmates_account: '12051',
        cc_fees_account: isCentralOrBroadway ? '12100' : '51030',
        undeposited_funds_account: '13200',
        cash_over_short_account: '51050',
        gift_card_account: '20500',
        open_orders_account: '12049',
        cash_on_hand_account: '12100',
        tips_account: '12100',
        cogs_account: '50006',
        discount_account: '40010',
        inc_customer_receivables: false,
        add_customer_name_memo: false,
        add_revenue_center_memo: false,
        cc_fee_validation: 'Warn',
        check_open_orders: true,
        tax_facilitator_enabled: true,
        alt_memos: {},
        line_class_overrides: {},
        settings_json: {},
        is_active: true,
        updated_at: new Date().toISOString()
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('accounting_site_mappings')
        .update(restoredPayload)
        .eq('store_id', store_id)
        .select()
        .single()

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
      return NextResponse.json({ success: true, mapping: updated })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
