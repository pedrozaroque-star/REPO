import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'
import { fetchToastAccountingData } from '../lib/toast-accounting'

async function verifyToastDirect() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🔍 VERIFICACIÓN DIRECTA A LA API DE TOAST (CASO DISCREPANCIA)')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  // Target: Downey on 2026-01-06 (where cache had $9,408.15 and QB had $9,416.13 -> diff $7.98)
  const targetDate = '20260106'
  const targetDoc = 'POS20260106DOWNEY1'

  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, name, external_id')
    .ilike('name', '%Downey%')
    .single()

  console.log(`Tienda: ${store.name} | External ID: ${store.external_id}`)
  console.log(`Fecha de Negocio: ${targetDate}`)
  console.log(`Llamando a Toast API v2 Orders Bulk directamente...\n`)

  const toastDirect = await fetchToastAccountingData(store.external_id, targetDate)

  // Compare with QuickBooks entry from that day
  const qbRaw = JSON.parse(fs.readFileSync('data/qb_historical_entries_2026.json', 'utf-8'))
  const qbEntry = qbRaw.find((e: any) => e.DocNumber === targetDoc)

  console.log('QB Entry DocNumber:', qbEntry?.DocNumber)
  console.log('QB Entry ID:', qbEntry?.Id)

  let qbNetSales = 0
  let qbTaxes = 0
  let qbCashDeposit = 0

  for (const l of qbEntry?.Line || []) {
    const dt = l.JournalEntryLineDetail
    const amt = Number(l.Amount || 0)
    const isCredit = dt?.PostingType === 'Credit'
    const isDebit = dt?.PostingType === 'Debit'
    const acct = (dt?.AccountRef?.name || '').toLowerCase()
    const desc = (l.Description || '').toLowerCase()

    if (isCredit) {
      if (acct === 'sales' || acct.includes('sales-') || acct.includes('sales -')) {
        qbNetSales += amt
      } else if (acct.includes('sales tax payable')) {
        qbTaxes += amt
      } else if (desc.includes('tax paid by uber')) {
        qbTaxes += amt
      }
    }

    if (isDebit) {
      if (desc.includes('deposit to bank') || acct.includes('undeposited') || acct.includes('cash on hand')) {
        qbCashDeposit += amt
      }
    }
  }

  // Also check what was in sales_daily_cache
  const { data: cacheRow } = await supabaseAdmin
    .from('sales_daily_cache')
    .select('*')
    .eq('store_id', store.id)
    .eq('business_date', '2026-01-06')
    .single()

  console.log('\n--- RESULTADOS DE LA COMPARACIÓN DIRECTA ---')
  console.log(`1. Base de Datos Local (sales_daily_cache):`)
  console.log(`   • Net Sales en Caché:   $${Number(cacheRow?.net_sales || 0).toFixed(2)}`)
  console.log(`   • Taxes en Caché:       $${Number(cacheRow?.taxes || 0).toFixed(2)}`)

  console.log(`\n2. TOAST API EN VIVO (fetchToastAccountingData - Órdenes Raw):`)
  console.log(`   • Net Sales Toast API:  $${toastDirect.netSales.toFixed(2)}`)
  console.log(`   • Taxes Toast API:      $${toastDirect.totalTaxes.toFixed(2)}`)
  console.log(`   • Cash Toast API:       $${toastDirect.cashDeposit.toFixed(2)}`)

  console.log(`\n3. QUICKBOOKS ONLINE (Póliza de Cohesion publicada):`)
  console.log(`   • Net Sales en QB:      $${qbNetSales.toFixed(2)}`)
  console.log(`   • Taxes en QB:          $${qbTaxes.toFixed(2)}`)
  console.log(`   • Cash en QB:           $${qbCashDeposit.toFixed(2)}`)

  const diffCacheQB = Math.abs(Number(cacheRow?.net_sales || 0) - qbNetSales)
  const diffToastLiveQB = Math.abs(toastDirect.netSales - qbNetSales)

  console.log(`\n--- ANÁLISIS DE DIFERENCIA ---`)
  console.log(`Diferencia Caché Local vs QB:      $${diffCacheQB.toFixed(2)}`)
  console.log(`Diferencia TOAST API EN VIVO vs QB: $${diffToastLiveQB.toFixed(2)}`)
}

verifyToastDirect()
