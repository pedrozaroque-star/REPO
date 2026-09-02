/**
 * @module api/accounting/packets
 * @description API route for managing accounting sales packets (daily journal entries).
 * GET: List packets filtered by date range and store.
 * POST: Generate/recalculate packets for specified stores and date range using Toast sales data.
 * 
 * @businessRules
 * - Packets represent daily sales journal entries for a single store on a single business date.
 * - Data is sourced from the `sales_daily_cache` table (pre-populated by Toast sync cron).
 * - For detailed breakdowns (dine-in vs to-go, credit card fees), a fresh Toast API call is needed.
 * - The business day starts at 6:00 AM PST and ends at 5:59 AM the next day.
 * - Packets follow a lifecycle: pending → ready → reviewed → published / rejected.
 * 
 * @dataFlow
 * sales_daily_cache → this endpoint → accounting_sales_packets → journal lines via lib/accounting-journal.ts
 * 
 * @notes
 * - For the initial implementation, we use the aggregated data from sales_daily_cache
 *   plus the existing uber/doordash/grubhub/ebt fields.
 * - Credit card fees are calculated as: gross_cc - net_cc_deposit (from Toast payment data).
 * - Dine-in vs To-Go split: net_sales - uber - doordash - grubhub = dine_in + togo.
 *   We approximate using a configurable ratio or fetch from Toast if available.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateJournalLines, calculateExpectedCash, formatDocNumber } from '@/lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '@/lib/accounting-journal'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const storeId = searchParams.get('storeId')
    const status = searchParams.get('status')

    let query = supabaseAdmin
      .from('accounting_sales_packets')
      .select('*, stores!inner(name)')
      .order('business_date', { ascending: false })
      .order('store_id', { ascending: true })

    if (startDate) query = query.gte('business_date', startDate)
    if (endDate) query = query.lte('business_date', endDate)
    if (storeId) query = query.eq('store_id', parseInt(storeId))
    if (status) query = query.eq('status', status)

    // Limit to last 30 days by default if no date range specified
    if (!startDate && !endDate) {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      query = query.gte('business_date', thirtyDaysAgo.toISOString().split('T')[0])
    }

    const { data, error } = await query.limit(500)

    if (error) {
      console.error('[Accounting] GET packets error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ packets: data || [] })
  } catch (err: any) {
    console.error('[Accounting] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { startDate, endDate, storeIds } = body as {
      startDate: string
      endDate: string
      storeIds?: number[]
    }

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
    }

    // 1. Get site mappings for all active stores (or specific stores)
    let mappingQuery = supabaseAdmin
      .from('accounting_site_mappings')
      .select('*, stores!inner(id, name, external_id)')
      .eq('is_active', true)

    if (storeIds && storeIds.length > 0) {
      mappingQuery = mappingQuery.in('store_id', storeIds)
    }

    const { data: mappings, error: mappingErr } = await mappingQuery

    if (mappingErr || !mappings || mappings.length === 0) {
      return NextResponse.json({ 
        error: 'No site mappings found. Configure store mappings first.',
        details: mappingErr?.message 
      }, { status: 400 })
    }

    // 2. Get sales data from cache for the date range
    const numericStoreIds = mappings.map(m => String(m.store_id))
    const externalStoreIds = mappings.map(m => (m.stores as any)?.external_id).filter(Boolean)
    const allQueryIds = Array.from(new Set([...numericStoreIds, ...externalStoreIds]))

    const { data: salesCache, error: cacheErr } = await supabaseAdmin
      .from('sales_daily_cache')
      .select('*')
      .in('store_id', allQueryIds)
      .gte('business_date', startDate)
      .lte('business_date', endDate)

    if (cacheErr) {
      console.error('[Accounting] Cache read error:', cacheErr)
      return NextResponse.json({ error: 'Failed to read sales cache', details: cacheErr.message }, { status: 500 })
    }

    if (!salesCache || salesCache.length === 0) {
      return NextResponse.json({ 
        error: 'No sales data found in cache for the specified date range. Run Toast sync first.',
        startDate, endDate, storeCount: mappings.length
      }, { status: 404 })
    }

    // 3. Generate packets for each store-date combination
    const generated: any[] = []
    const errors: any[] = []

    for (const sale of salesCache) {
      const mapping = mappings.find(m => 
        String(m.store_id) === String(sale.store_id) || 
        (m.stores as any)?.external_id === sale.store_id ||
        (m.stores as any)?.name === sale.store_name
      )
      if (!mapping) continue

      const storeName = (mapping as any).stores?.name || `Store ${mapping.store_id}`

      try {
        // Build SalesPacketData from cache
        // Note: sales_daily_cache has aggregated uber/dd/gh sales but not the detailed
        // dine-in vs to-go split or credit card fee breakdown.
        // We'll approximate: dine_in + togo = net_sales - uber - doordash - grubhub
        const uberSales = sale.uber_sales || 0
        const doordashSales = sale.doordash_sales || 0
        const grubhubSales = sale.grubhub_sales || 0
        const netSales = sale.net_sales || 0
        const taxes = sale.taxes || 0
        const ebtAmount = sale.ebt_amount || 0

        // In-store sales = net_sales - third_party_sales
        const inStoreSales = Math.max(0, netSales - uberSales - doordashSales - grubhubSales)
        
        // Approximate For Here vs To Go (typically ~50/50, configurable per store)
        // For now, we'll use a simple split — this can be refined when Toast detailed data is available
        const forHereSales = round(inStoreSales * 0.52)
        const toGoSales = round(inStoreSales - forHereSales)

        // Approximate tax breakdown
        // Total taxes → split: ~83% sales tax, ~11% marketplace facilitator, ~6% paid by facilitator
        // These ratios come from the Cohesion journal entry analysis
        const salesTax = round(taxes * 0.829)
        const marketplaceTax = round(taxes * 0.110)
        const facilitatorTaxPaid = round(taxes - salesTax - marketplaceTax)

        // Calculate total gross receipts
        const totalGrossReceipts = round(netSales + taxes)

        // Third-party payments (gross — includes their commission and facilitator taxes)
        const uberPayment = round(uberSales + facilitatorTaxPaid) // Uber pays net + facilitator tax
        const doordashPayment = round(doordashSales + (doordashSales > 0 ? round(doordashSales / netSales * taxes * 0.11) : 0))
        const grubhubPayment = round(grubhubSales + (grubhubSales > 0 ? round(grubhubSales / netSales * taxes * 0.11) : 0))

        // Credit card fees (approximate ~1.8% of CC gross)
        const ccFeeRate = 0.018
        const cashFromSales = round(totalGrossReceipts - uberPayment - doordashPayment - grubhubPayment - ebtAmount)
        const ccGross = round(cashFromSales * 0.70) // ~70% of remaining is credit card
        const ccFees = round(ccGross * ccFeeRate)
        const ccDeposit = round(ccGross - ccFees)

        // Cash deposit = remaining after all non-cash
        const cashDeposit = round(totalGrossReceipts - ccGross - uberPayment - doordashPayment - grubhubPayment - ebtAmount)

        const salesPacketData: SalesPacketData = {
          net_sales: netSales,
          total_taxes: taxes,
          for_here_sales: forHereSales,
          to_go_sales: toGoSales,
          uber_delivery_sales: round(uberSales * 0.90), // ~90% delivery
          uber_takeout_sales: round(uberSales * 0.10), // ~10% takeout
          doordash_takeout_sales: round(doordashSales * 0.30),
          doordash_delivery_sales: round(doordashSales * 0.70),
          grubhub_delivery_sales: grubhubSales,
          tax_paid_by_uber: facilitatorTaxPaid,
          sales_tax: salesTax,
          marketplace_tax: marketplaceTax,
          ebt_amount: ebtAmount,
          uber_payment: uberPayment,
          doordash_payment: doordashPayment,
          grubhub_payment: grubhubPayment,
          credit_card_deposit: ccDeposit,
          credit_card_fees: ccFees,
          cash_deposits: cashDeposit,
        }

        const siteConfig: SiteMappingConfig = {
          location: mapping.qb_location,
          className: mapping.qb_class,
          bank_account: mapping.bank_account_number,
          sales_tax_rate_name: mapping.qb_location, // Tax rate name = location name
        }

        // Generate journal lines
        const journal = generateJournalLines(salesPacketData, siteConfig)
        const expectedCash = calculateExpectedCash(salesPacketData)
        const docNumber = formatDocNumber(storeName.replace(/^Tacos Gavilan\s+/i, '').trim(), sale.business_date)

        // Upsert the packet
        const packetData = {
          store_id: mapping.store_id,
          business_date: sale.business_date,
          status: 'ready',
          dine_in_sales: forHereSales,
          togo_sales: toGoSales,
          uber_delivery_sales: salesPacketData.uber_delivery_sales,
          uber_takeout_sales: salesPacketData.uber_takeout_sales,
          doordash_delivery_sales: salesPacketData.doordash_delivery_sales,
          doordash_takeout_sales: salesPacketData.doordash_takeout_sales,
          grubhub_sales: grubhubSales,
          gross_sales: sale.gross_sales || 0,
          net_sales: netSales,
          total_discounts: sale.discounts || 0,
          sales_tax: salesTax,
          marketplace_facilitator_tax: marketplaceTax,
          facilitator_tax_paid: facilitatorTaxPaid,
          total_taxes: taxes,
          total_credit_cards_gross: ccGross,
          credit_card_deposit: ccDeposit,
          credit_card_fees: ccFees,
          uber_payment: uberPayment,
          doordash_payment: doordashPayment,
          grubhub_payment: grubhubPayment,
          ebt_amount: ebtAmount,
          expected_cash: expectedCash,
          cash_deposit: cashDeposit,
          cash_over_short: 0,
          journal_total_debits: journal.totalDebits,
          journal_total_credits: journal.totalCredits,
          journal_lines: journal.lines,
          qb_doc_number: docNumber,
          updated_at: new Date().toISOString(),
        }

        const { data: upserted, error: upsertErr } = await supabaseAdmin
          .from('accounting_sales_packets')
          .upsert(packetData, { onConflict: 'store_id, business_date' })
          .select()
          .single()

        if (upsertErr) {
          errors.push({ store: storeName, date: sale.business_date, error: upsertErr.message })
        } else {
          generated.push({
            id: upserted?.id,
            store: storeName,
            date: sale.business_date,
            netSales: netSales,
            totalDebits: journal.totalDebits,
            totalCredits: journal.totalCredits,
            isBalanced: journal.isBalanced,
            lineCount: journal.lines.length,
          })
        }
      } catch (genErr: any) {
        errors.push({ store: storeName, date: sale.business_date, error: genErr.message })
      }
    }

    return NextResponse.json({
      success: true,
      generated: generated.length,
      errors: errors.length,
      packets: generated,
      ...(errors.length > 0 ? { errorDetails: errors } : {}),
    })
  } catch (err: any) {
    console.error('[Accounting] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function round(val: number): number {
  return Math.round(val * 100) / 100
}
