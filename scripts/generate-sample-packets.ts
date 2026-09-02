/**
 * Generar pólizas de prueba para los últimos 7 días usando sales_daily_cache
 * Run via: npx tsx scripts/generate-sample-packets.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'
import { generateJournalLines, formatDocNumber } from '../lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '../lib/accounting-journal'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function generate() {
  console.log('🚀 Generando pólizas de contabilidad desde sales_daily_cache...')

  // Obtener tiendas y mapeos
  const { data: mappings } = await supabaseAdmin
    .from('accounting_site_mappings')
    .select('*, stores!inner(id, name, external_id)')

  if (!mappings || mappings.length === 0) {
    console.log('❌ No hay mapeos de tiendas.')
    return
  }

  // Obtener ventas más recientes
  const { data: sales, error: salesErr } = await supabaseAdmin
    .from('sales_daily_cache')
    .select('*')
    .order('business_date', { ascending: false })
    .limit(200)

  if (salesErr || !sales || sales.length === 0) {
    console.log('⚠️ No hay ventas en sales_daily_cache.')
    return
  }

  console.log(`📊 Encontrados ${sales.length} registros de ventas en sales_daily_cache.`)

  let generatedCount = 0

  for (const sale of sales) {
    const mapping = mappings.find(m => 
      String(m.store_id) === String(sale.store_id) ||
      (m.stores as any)?.external_id === sale.store_id ||
      (m.stores as any)?.name === sale.store_name
    )
    if (!mapping) continue

    const storeName = (mapping.stores as any)?.name?.replace(/^Tacos Gavilan\s*-\s*/i, '').replace(/^Tacos Gavilan\s*/i, '') || ''
    const netSales = Number(sale.net_sales) || 0
    const grossSales = Number(sale.gross_sales) || netSales
    const discounts = Number(sale.discounts) || 0
    const taxes = Number(sale.taxes) || 0

    const uberSales = Number(sale.uber_sales) || 0
    const doordashSales = Number(sale.doordash_sales) || 0
    const grubhubSales = Number(sale.grubhub_sales) || 0
    const inStoreSales = Math.max(0, netSales - uberSales - doordashSales - grubhubSales)

    const forHereSales = Math.round(inStoreSales * 0.52 * 100) / 100
    const toGoSales = Math.round((inStoreSales - forHereSales) * 100) / 100

    const uberDelivery = Math.round(uberSales * 0.90 * 100) / 100
    const uberTakeout = Math.round((uberSales - uberDelivery) * 100) / 100
    const ddDelivery = Math.round(doordashSales * 0.70 * 100) / 100
    const ddTakeout = Math.round((doordashSales - ddDelivery) * 100) / 100

    const salesTax = Math.round(taxes * 0.829 * 100) / 100
    const marketplaceTax = Math.round(taxes * 0.11 * 100) / 100
    const facilitatorTaxPaid = Math.round(taxes * 0.061 * 100) / 100

    const ebtAmount = Number(sale.ebt_amount) || 0
    const uberPayment = Math.round((uberSales + facilitatorTaxPaid) * 100) / 100
    const doordashPayment = Math.round((doordashSales + (netSales > 0 ? (doordashSales / netSales * taxes * 0.11) : 0)) * 100) / 100
    const grubhubPayment = Math.round((grubhubSales + (netSales > 0 ? (grubhubSales / netSales * taxes * 0.11) : 0)) * 100) / 100

    const grossReceipts = netSales + taxes
    const nonCash = uberPayment + doordashPayment + grubhubPayment + ebtAmount
    const remainingCashAndCC = Math.max(0, grossReceipts - nonCash)

    const grossCC = Math.round(remainingCashAndCC * 0.70 * 100) / 100
    const ccFees = Math.round(grossCC * 0.018 * 100) / 100
    const ccDeposit = Math.round((grossCC - ccFees) * 100) / 100

    const expectedCash = Math.round((grossReceipts - (ccDeposit + ccFees + uberPayment + doordashPayment + grubhubPayment + ebtAmount)) * 100) / 100
    const cashDeposit = expectedCash

    const siteConfig: SiteMappingConfig = {
      location: mapping.qb_location || storeName,
      className: mapping.qb_class || storeName,
      bank_account: mapping.bank_account_number || '10000',
      sales_tax_rate_name: storeName,
    }

    const salesData: SalesPacketData = {
      net_sales: netSales,
      total_taxes: taxes,
      for_here_sales: forHereSales,
      to_go_sales: toGoSales,
      uber_delivery_sales: uberDelivery,
      uber_takeout_sales: uberTakeout,
      doordash_takeout_sales: ddTakeout,
      doordash_delivery_sales: ddDelivery,
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

    const journal = generateJournalLines(salesData, siteConfig)
    const docNumber = formatDocNumber(storeName, sale.business_date)

    const packet = {
      store_id: mapping.store_id,
      business_date: sale.business_date,
      status: 'ready',
      dine_in_sales: forHereSales,
      togo_sales: toGoSales,
      uber_delivery_sales: uberDelivery,
      uber_takeout_sales: uberTakeout,
      doordash_delivery_sales: ddDelivery,
      doordash_takeout_sales: ddTakeout,
      grubhub_sales: grubhubSales,
      gross_sales: grossSales,
      net_sales: netSales,
      total_discounts: discounts,
      sales_tax: salesTax,
      marketplace_facilitator_tax: marketplaceTax,
      facilitator_tax_paid: facilitatorTaxPaid,
      total_taxes: taxes,
      total_credit_cards_gross: grossCC,
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

    const { error: upsertErr } = await supabaseAdmin
      .from('accounting_sales_packets')
      .upsert(packet, { onConflict: 'store_id, business_date' })

    if (!upsertErr) {
      generatedCount++
    } else {
      console.error('Error upserting packet:', upsertErr.message)
    }
  }

  console.log(`✅ ¡Se generaron ${generatedCount} pólizas listas en accounting_sales_packets!`)
}

generate().catch(console.error)
