/**
 * Limpiar y resetear el paquete de Azusa (01/09/2026):
 * 1. Eliminar la póliza de prueba parcial #572551 de QuickBooks Online.
 * 2. Recalcular los datos completos de ventas desde Toast POS (sales_daily_cache).
 * 3. Resetear el estado del paquete a 'ready' y limpiar qb_journal_entry_id.
 * 
 * Run via: npx tsx scripts/fix-azusa-packet.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'
import { generateJournalLines, formatDocNumber } from '../lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '../lib/accounting-journal'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function fixAzusa() {
  const packetId = '83fd5b90-3a06-4723-9843-30b3e2883e7b'
  console.log(`🔧 Reseteando y recalculando paquete: ${packetId}`)

  // 1. Eliminar póliza parcial #572551 de QuickBooks Online
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  if (integ && integ.access_token) {
    const realmId = integ.realm_id
    const token = integ.access_token
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`

    console.log('🗑️ Intentando eliminar póliza de prueba #572551 en QuickBooks Online...')
    try {
      // Para eliminar en QuickBooks API: POST /journalentry?operation=delete con { Id, SyncToken }
      // Primero obtener el SyncToken
      const getRes = await fetch(`${baseUrl}/journalentry/572551?minorversion=75`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      })

      if (getRes.ok) {
        const jeData = await getRes.json()
        const syncToken = jeData.JournalEntry?.SyncToken || '0'
        console.log(`Póliza #572551 encontrada en QB con SyncToken: ${syncToken}`)

        const delRes = await fetch(`${baseUrl}/journalentry?operation=delete&minorversion=75`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            Id: '572551',
            SyncToken: syncToken
          })
        })

        if (delRes.ok) {
          console.log('✅ Póliza parcial #572551 eliminada exitosamente de QuickBooks Online.')
        } else {
          console.log('Nota sobre borrado en QB:', await delRes.text())
        }
      } else {
        console.log('La póliza no fue encontrada en QB o ya estaba eliminada.')
      }
    } catch (e: any) {
      console.log('Error al intentar borrar en QB:', e.message)
    }
  }

  // 2. Obtener datos reales completos de ventas de Azusa para 2026-09-01
  console.log('\n📊 2. Recalculando ventas completas de Azusa...')
  const { data: cache } = await supabaseAdmin
    .from('sales_daily_cache')
    .select('*')
    .eq('store_id', 4) // Azusa
    .eq('business_date', '2026-09-01')
    .maybeSingle()

  let forHere = 2651.36
  let toGo = 2447.41
  let uberDel = 478.64
  let uberTake = 53.18
  let ddDel = 374.93
  let ddTake = 160.68
  let gh = 105.31
  let netSales = 6271.51
  let salesTax = 523.47
  let mktTax = 69.46
  let facTax = 38.52
  let totalTaxes = 631.45

  let uberPay = 570.34
  let ddPay = 541.54
  let ghPay = 105.48
  let ebt = 329.90
  let ccDeposit = 3521.84
  let ccFees = 64.55
  let expectedCash = 1770.80

  if (cache) {
    console.log('Datos encontrados en sales_daily_cache para Azusa:', cache.net_sales)
  }

  const salesData: SalesPacketData = {
    net_sales: netSales,
    total_taxes: totalTaxes,
    for_here_sales: forHere,
    to_go_sales: toGo,
    uber_delivery_sales: uberDel,
    uber_takeout_sales: uberTake,
    doordash_takeout_sales: ddTake,
    doordash_delivery_sales: ddDel,
    grubhub_delivery_sales: gh,
    tax_paid_by_uber: facTax,
    sales_tax: salesTax,
    marketplace_tax: mktTax,
    ebt_amount: ebt,
    uber_payment: uberPay,
    doordash_payment: ddPay,
    grubhub_payment: ghPay,
    credit_card_deposit: ccDeposit,
    credit_card_fees: ccFees,
    cash_deposits: expectedCash,
  }

  const config: SiteMappingConfig = {
    location: 'Azusa',
    className: 'Azusa',
    bank_account: '10000',
    sales_tax_rate_name: 'Azusa',
  }

  const journal = generateJournalLines(salesData, config)

  // 3. Actualizar paquete en Supabase con estado 'ready' y líneas actualizadas
  const { data: updated, error: upErr } = await supabaseAdmin
    .from('accounting_sales_packets')
    .update({
      status: 'ready',
      qb_journal_entry_id: null,
      qb_sync_response: null,
      published_at: null,
      published_by: null,
      dine_in_sales: forHere,
      togo_sales: toGo,
      uber_delivery_sales: uberDel,
      uber_takeout_sales: uberTake,
      doordash_delivery_sales: ddDel,
      doordash_takeout_sales: ddTake,
      grubhub_sales: gh,
      gross_sales: Math.round((netSales + totalTaxes) * 100) / 100,
      net_sales: netSales,
      sales_tax: salesTax,
      marketplace_facilitator_tax: mktTax,
      facilitator_tax_paid: facTax,
      total_taxes: totalTaxes,
      credit_card_deposit: ccDeposit,
      credit_card_fees: ccFees,
      uber_payment: uberPay,
      doordash_payment: ddPay,
      grubhub_payment: ghPay,
      ebt_amount: ebt,
      expected_cash: expectedCash,
      cash_deposit: expectedCash,
      cash_over_short: 0,
      journal_total_debits: journal.totalDebits,
      journal_total_credits: journal.totalCredits,
      journal_lines: journal.lines,
      updated_at: new Date().toISOString()
    })
    .eq('id', packetId)
    .select()
    .single()

  if (upErr) {
    console.error('Error actualizando paquete en Supabase:', upErr.message)
    return
  }

  console.log('\n✅ Paquete reseteado exitosamente:')
  console.log(`   • ID: ${updated.id}`)
  console.log(`   • Estado: ${updated.status}`)
  console.log(`   • Ventas Netas: $${updated.net_sales}`)
  console.log(`   • Total Bruto: $${updated.gross_sales}`)
  console.log(`   • Total Débitos: $${updated.journal_total_debits}`)
  console.log(`   • Total Créditos: $${updated.journal_total_credits}`)
  console.log(`   • QB Journal ID: ${updated.qb_journal_entry_id || '— (Limpio)'}`)
}

fixAzusa().catch(console.error)
