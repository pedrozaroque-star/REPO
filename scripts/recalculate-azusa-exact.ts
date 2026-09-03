/**
 * Recalcular el paquete de Azusa (01/09/2026) con los datos 100% exactos de Cohesion / Toast
 * y guardarlo en Supabase con estatus 'ready' para que coincida línea por línea.
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'
import { generateJournalLines } from '../lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '../lib/accounting-journal'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function recalculateAzusaExact() {
  const packetId = '83fd5b90-3a06-4723-9843-30b3e2883e7b'
  console.log('🔄 Actualizando paquete de Azusa con datos 100% exactos de Toast / Cohesion...')

  const salesData: SalesPacketData = {
    net_sales: 6271.51,
    total_taxes: 631.45,
    for_here_sales: 2293.91,
    toast_online_sales: 9.19,
    to_go_sales: 2795.67,
    uber_delivery_sales: 531.82,
    uber_takeout_sales: 0,
    doordash_takeout_sales: 56.61,
    doordash_delivery_sales: 479.00,
    grubhub_delivery_sales: 62.78,
    grubhub_takeout_sales: 42.53,
    tax_paid_by_uber: 52.08,
    sales_tax: 524.46,
    marketplace_tax: 54.91,
    ebt_amount: 329.90,
    uber_payment: 583.90,
    doordash_payment: 590.52,
    grubhub_payment: 116.62,
    credit_card_deposit: 3822.04,
    credit_card_fees: 79.44,
    cash_deposits: 1380.54,
  }

  const siteConfig: SiteMappingConfig = {
    location: 'Azusa',
    className: 'Azusa',
    bank_account: '10000',
    sales_tax_rate_name: 'Azusa',
  }

  const journal = generateJournalLines(salesData, siteConfig)

  console.log(`Líneas generadas: ${journal.lines.length}`)
  console.log(`Total Débitos : $${journal.totalDebits}`)
  console.log(`Total Créditos: $${journal.totalCredits}`)
  console.log(`Cuadrado: ${journal.isBalanced}`)

  // Actualizar paquete en Supabase
  const { data: updated, error } = await supabaseAdmin
    .from('accounting_sales_packets')
    .update({
      status: 'ready',
      qb_journal_entry_id: null,
      qb_sync_response: null,
      published_at: null,
      dine_in_sales: salesData.for_here_sales,
      togo_sales: salesData.to_go_sales,
      uber_delivery_sales: salesData.uber_delivery_sales,
      uber_takeout_sales: salesData.uber_takeout_sales,
      doordash_delivery_sales: salesData.doordash_delivery_sales,
      doordash_takeout_sales: salesData.doordash_takeout_sales,
      grubhub_sales: Math.round(((salesData.grubhub_delivery_sales || 0) + (salesData.grubhub_takeout_sales || 0)) * 100) / 100,
      gross_sales: 6902.96,
      net_sales: 6271.51,
      sales_tax: salesData.sales_tax,
      marketplace_facilitator_tax: salesData.marketplace_tax,
      facilitator_tax_paid: salesData.tax_paid_by_uber,
      total_taxes: 631.45,
      credit_card_deposit: salesData.credit_card_deposit,
      credit_card_fees: salesData.credit_card_fees,
      uber_payment: salesData.uber_payment,
      doordash_payment: salesData.doordash_payment,
      grubhub_payment: salesData.grubhub_payment,
      ebt_amount: salesData.ebt_amount,
      expected_cash: salesData.cash_deposits,
      cash_deposit: salesData.cash_deposits,
      cash_over_short: 0,
      journal_total_debits: journal.totalDebits,
      journal_total_credits: journal.totalCredits,
      journal_lines: journal.lines,
      updated_at: new Date().toISOString()
    })
    .eq('id', packetId)
    .select()
    .single()

  if (error) {
    console.error('Error actualizando:', error.message)
    return
  }

  console.log('\n✅ Paquete actualizado con éxito:')
  console.log('Lineas del Diario:')
  journal.lines.forEach((l, idx) => {
    console.log(`  ${String(idx + 1).padStart(2)}. ${l.account} | ${l.memo.padEnd(30)} | Dr: $${l.debit.toFixed(2).padStart(8)} | Cr: $${l.credit.toFixed(2).padStart(8)} | ${l.sourceMemo}`)
  })
}

recalculateAzusaExact().catch(console.error)
