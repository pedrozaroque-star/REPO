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
import { fetchToastAccountingData } from '@/lib/toast-accounting'
import { fetchToastData } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

    let activeSalesCache = salesCache || []
    if (activeSalesCache.length === 0) {
      console.log(`[Accounting] No sales cache for ${startDate} to ${endDate}. Auto-syncing from Toast API...`)
      try {
        await fetchToastData({
          storeIds: 'all',
          startDate,
          endDate,
          groupBy: 'day',
          skipCache: true
        })
        const { data: refreshedCache } = await supabaseAdmin
          .from('sales_daily_cache')
          .select('*')
          .in('store_id', allQueryIds)
          .gte('business_date', startDate)
          .lte('business_date', endDate)
        activeSalesCache = refreshedCache || []
      } catch (syncErr: any) {
        console.warn('[Accounting] Auto-sync Toast failed:', syncErr.message)
      }
    }

    if (activeSalesCache.length === 0) {
      return NextResponse.json({ 
        error: 'No sales data found in cache or Toast for the specified date range.',
        startDate, endDate, storeCount: mappings.length
      }, { status: 404 })
    }

    // 3. Generate packets for each store-date combination
    const generated: any[] = []
    const errors: any[] = []

    for (const sale of activeSalesCache) {
      const mapping = mappings.find(m => 
        String(m.store_id) === String(sale.store_id) || 
        (m.stores as any)?.external_id === sale.store_id ||
        (m.stores as any)?.name === sale.store_name
      )
      if (!mapping) continue

      const storeName = (mapping as any).stores?.name || `Store ${mapping.store_id}`

      try {
        let salesPacketData: SalesPacketData | null = null
        const extId = (mapping as any).stores?.external_id

        let toastAccountingResult: any = null
        if (extId) {
          try {
            const toastData = await fetchToastAccountingData(extId, sale.business_date.replace(/-/g, ''))
            toastAccountingResult = toastData
            salesPacketData = {
              net_sales: toastData.netSales,
              total_taxes: toastData.totalTaxes,
              for_here_sales: toastData.forHereSales,
              to_go_sales: toastData.toGoSales,
              drive_thru_sales: toastData.driveThruSales,
              kiosk_dine_in_sales: toastData.kioskDineInSales,
              kiosk_takeout_sales: toastData.kioskTakeOutSales,
              toast_online_sales: toastData.toastOnlineSales,
              toast_delivery_sales: toastData.toastDeliverySales,
              tips_payable: toastData.tipsPayable,
              deposits_collected: toastData.depositsCollected,
              paid_in: toastData.paidIn,
              uber_delivery_sales: toastData.uberDeliverySales,
              uber_takeout_sales: toastData.uberTakeoutSales,
              doordash_takeout_sales: toastData.doordashTakeoutSales,
              doordash_delivery_sales: toastData.doordashDeliverySales,
              grubhub_delivery_sales: toastData.grubhubDeliverySales,
              grubhub_takeout_sales: toastData.grubhubTakeoutSales,
              deferred_gift_cards: toastData.deferredSalesGiftCards,
              gift_card_redemption: toastData.giftCardRedemption,
              delivery_service_charges: toastData.deliveryServiceCharges,
              tax_paid_by_uber: toastData.taxPaidByUber,
              sales_tax: toastData.salesTax,
              marketplace_tax: toastData.marketplaceTax,
              ebt_amount: toastData.ebtAmount,
              uber_payment: toastData.uberPayment,
              doordash_payment: toastData.doordashPayment,
              grubhub_payment: toastData.grubhubPayment,
              credit_card_deposit: toastData.creditCardDeposit,
              credit_card_fees: toastData.creditCardFees,
              credit_card_other_deductions: toastData.creditCardOtherDeductions,
              cash_deposits: 0,
            }
          } catch (toastErr: any) {
            console.warn(`[Accounting] Granular Toast API fetch failed for ${storeName}, falling back to cache:`, toastErr.message)
          }
        }

        // Fallback to cache estimation if direct Toast API fetch wasn't available
        if (!salesPacketData) {
          const uberSales = sale.uber_sales || 0
          const doordashSales = sale.doordash_sales || 0
          const grubhubSales = sale.grubhub_sales || 0
          const netSales = sale.net_sales || 0
          const taxes = sale.taxes || 0
          const ebtAmount = sale.ebt_amount || 0

          const inStoreSales = Math.max(0, netSales - uberSales - doordashSales - grubhubSales)
          const forHereSales = round(inStoreSales * 0.52)
          const toGoSales = round(inStoreSales - forHereSales)

          const salesTax = round(taxes * 0.829)
          const marketplaceTax = round(taxes * 0.110)
          const facilitatorTaxPaid = round(taxes - salesTax - marketplaceTax)

          const totalGrossReceipts = round(netSales + taxes)
          const uberPayment = round(uberSales + facilitatorTaxPaid)
          const doordashPayment = round(doordashSales + (doordashSales > 0 ? round(doordashSales / netSales * taxes * 0.11) : 0))
          const grubhubPayment = round(grubhubSales + (grubhubSales > 0 ? round(grubhubSales / netSales * taxes * 0.11) : 0))

          const ccFeeRate = 0.018
          const cashFromSales = round(totalGrossReceipts - uberPayment - doordashPayment - grubhubPayment - ebtAmount)
          const ccGross = round(cashFromSales * 0.70)
          const ccFees = round(ccGross * ccFeeRate)
          const ccDeposit = round(ccGross - ccFees)
          const cashDeposit = round(totalGrossReceipts - ccGross - uberPayment - doordashPayment - grubhubPayment - ebtAmount)

          salesPacketData = {
            net_sales: netSales,
            total_taxes: taxes,
            for_here_sales: forHereSales,
            to_go_sales: toGoSales,
            uber_delivery_sales: round(uberSales * 0.90),
            uber_takeout_sales: round(uberSales * 0.10),
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
            cash_deposits: 0,
          }
        }

        const siteConfig: SiteMappingConfig = {
          location: mapping.qb_location,
          className: mapping.qb_class,
          bank_account: mapping.bank_account_number,
          sales_tax_rate_name: mapping.qb_location, // Tax rate name = location name
          sales_dine_in_account: mapping.sales_dine_in_account,
          sales_uber_account: mapping.sales_uber_account,
          sales_doordash_account: mapping.sales_doordash_account,
          sales_grubhub_account: mapping.sales_grubhub_account,
          sales_tax_account: mapping.sales_tax_account,
          ar_uber_account: mapping.ar_uber_account,
          ar_doordash_account: mapping.ar_doordash_account,
          ar_grubhub_account: mapping.ar_grubhub_account,
          ar_postmates_account: mapping.ar_postmates_account,
          cc_fees_account: mapping.cc_fees_account,
          undeposited_funds_account: mapping.undeposited_funds_account,
          cash_over_short_account: mapping.cash_over_short_account,
          gift_card_account: mapping.gift_card_account,
          open_orders_account: mapping.open_orders_account,
          cash_on_hand_account: mapping.cash_on_hand_account,
          tips_account: mapping.tips_account,
          cogs_account: mapping.cogs_account,
        }

        // Check if an existing packet is already published to protect QuickBooks integrity
        const { data: existingPacket } = await supabaseAdmin
          .from('accounting_sales_packets')
          .select('id, status, cash_deposit, qb_journal_entry_id, qb_doc_number, published_at, qb_sync_response')
          .eq('store_id', mapping.store_id)
          .eq('business_date', sale.business_date)
          .maybeSingle()

        if (existingPacket && existingPacket.status === 'published') {
          // Do NOT overwrite already-published packets
          generated.push(existingPacket as any)
          continue
        }

        // Calculate Expected Cash first (from gross receipts minus non-cash payments)
        const expectedCash = calculateExpectedCash(salesPacketData)

        // Toast Cash Management Parity:
        // El depósito bancario proviene estrictamente de lo registrado por el gerente en Toast POS Cash Management.
        // Si ya está registrado en Toast: se toma el monto real.
        // Si aún no está registrado en Toast: queda en $0.00 con estado pendiente.
        const finalDeposit = toastAccountingResult?.hasToastDeposit && toastAccountingResult.toastDepositAmount > 0
          ? toastAccountingResult.toastDepositAmount
          : 0
        const depositSource: 'toast' | 'pending' = finalDeposit > 0 ? 'toast' : 'pending'
        salesPacketData.cash_deposits = finalDeposit

        // Generate journal lines
        const journal = generateJournalLines(salesPacketData, siteConfig)
        const docNumber = formatDocNumber(storeName.replace(/^Tacos Gavilan\s+/i, '').trim(), sale.business_date)

        // Determine status based on Open Orders validation (Step 11 Cohesion Rule) and Journal Balance
        const hasOpenOrders = toastAccountingResult?.hasOpenOrders ?? false
        const openOrdersCount = toastAccountingResult?.openOrdersCount ?? 0
        const outOfBalanceOrdersCount = toastAccountingResult?.outOfBalanceOrdersCount ?? 0
        const openOrdersList = toastAccountingResult?.openOrdersList ?? []

        const isBalanced = journal.isBalanced
        // Toast Cash Management Parity: Si el depósito de efectivo aún no ha sido registrado en Toast POS (finalDeposit === 0 y expectedCash > 0),
        // la póliza se mantiene en 'pending' para bloquear la publicación a QuickBooks hasta que la sucursal registre su depósito.
        const isDepositPending = finalDeposit === 0 && expectedCash > 0
        const packetStatus = (isBalanced && !isDepositPending) ? 'ready' : 'pending'

        const validationInfo = {
          passed: isBalanced && !isDepositPending,
          isDepositPending,
          hasOpenOrders,
          openOrdersCount,
          outOfBalanceOrdersCount,
          openOrders: openOrdersList,
          checkedAt: new Date().toISOString(),
          message: !isBalanced 
            ? 'Unbalanced Journal Entry' 
            : isDepositPending
              ? 'Depósito de efectivo pendiente en Toast POS'
              : 'Packet was Updated and Passed All Validation',
          discount_breakdown: toastAccountingResult?.discountBreakdown || {},
          card_breakdown: toastAccountingResult?.cardBreakdown || {},
          sales_gross_by_option: toastAccountingResult?.salesGrossByOption || {},
          deposits_collected: toastAccountingResult?.depositsCollected || 0,
          paid_in: toastAccountingResult?.paidIn || 0,
          deposit_source: depositSource,
          toast_deposits: toastAccountingResult?.toastDepositsList || [],
        }

        // Upsert the packet
        const totalDiscounts = toastAccountingResult?.discountsTotal ?? sale.discounts ?? 0
        const grossSalesAmount = Math.round(((salesPacketData.net_sales || 0) + totalDiscounts) * 100) / 100
        const packetData = {
          store_id: mapping.store_id,
          business_date: sale.business_date,
          status: packetStatus,
          dine_in_sales: salesPacketData.for_here_sales,
          togo_sales: salesPacketData.to_go_sales,
          uber_delivery_sales: salesPacketData.uber_delivery_sales,
          uber_takeout_sales: salesPacketData.uber_takeout_sales,
          doordash_delivery_sales: salesPacketData.doordash_delivery_sales,
          doordash_takeout_sales: salesPacketData.doordash_takeout_sales,
          grubhub_sales: Math.round(((salesPacketData.grubhub_delivery_sales || 0) + (salesPacketData.grubhub_takeout_sales || 0)) * 100) / 100,
          gross_sales: grossSalesAmount,
          net_sales: salesPacketData.net_sales,
          total_discounts: totalDiscounts,
          sales_tax: salesPacketData.sales_tax,
          marketplace_facilitator_tax: salesPacketData.marketplace_tax,
          facilitator_tax_paid: salesPacketData.tax_paid_by_uber,
          total_taxes: salesPacketData.total_taxes,
          total_credit_cards_gross: Math.round((salesPacketData.credit_card_deposit + salesPacketData.credit_card_fees + (salesPacketData.credit_card_other_deductions || 0)) * 100) / 100,
          credit_card_deposit: salesPacketData.credit_card_deposit,
          credit_card_fees: salesPacketData.credit_card_fees,
          uber_payment: salesPacketData.uber_payment,
          doordash_payment: salesPacketData.doordash_payment,
          grubhub_payment: salesPacketData.grubhub_payment,
          ebt_amount: salesPacketData.ebt_amount,
          expected_cash: expectedCash,
          cash_deposit: salesPacketData.cash_deposits,
          cash_over_short: Math.round((salesPacketData.cash_deposits - expectedCash) * 100) / 100,
          journal_total_debits: journal.totalDebits,
          journal_total_credits: journal.totalCredits,
          journal_lines: journal.lines,
          qb_doc_number: docNumber,
          notes: validationInfo.message,
          qb_sync_response: { 
            validation: validationInfo,
            discount_breakdown: toastAccountingResult?.discountBreakdown || {},
            card_breakdown: toastAccountingResult?.cardBreakdown || {},
            sales_gross_by_option: toastAccountingResult?.salesGrossByOption || {},
            deposit_source: depositSource,
            toast_deposits: toastAccountingResult?.toastDepositsList || [],
          },
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
            netSales: salesPacketData.net_sales,
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
