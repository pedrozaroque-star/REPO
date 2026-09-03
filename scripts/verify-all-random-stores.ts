import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'
import { fetchToastAccountingData } from '../lib/toast-accounting'
import { generateJournalLines } from '../lib/accounting-journal'
import { getQBStoreRefs } from '../lib/qb-classes-locations'

interface StoreTest {
  storeName: string
  siteId: string
  dateYMD: string // YYYYMMDD
  dateDisplay: string // MM/DD/YYYY
}

const TESTS: StoreTest[] = [
  { storeName: 'Azusa', siteId: '2248', dateYMD: '20260901', dateDisplay: '09/01/2026' },
  { storeName: 'Downey', siteId: '2193', dateYMD: '20260831', dateDisplay: '08/31/2026' },
  { storeName: 'Lynwood', siteId: '2262', dateYMD: '20260831', dateDisplay: '08/31/2026' },
  { storeName: 'South Gate', siteId: '2283', dateYMD: '20260830', dateDisplay: '08/30/2026' },
  { storeName: 'Huntington Park', siteId: '2276', dateYMD: '20260829', dateDisplay: '08/29/2026' },
]

function parseCohesionHtml(html: string) {
  const netSalesMatch = html.match(/Net Sales<\/td>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>\s*([0-9,]+\.\d{2})/i)
  const netSales = netSalesMatch ? parseFloat(netSalesMatch[1].replace(/,/g, '')) : 0

  const taxMatch = html.match(/Total Tax Liability<\/strong><\/td>\s*<td[^>]*>\s*<strong>([0-9,]+\.\d{2})/i)
  const totalTaxes = taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : 0

  const bankMatch = html.match(/Cash Deposit To Bank<\/td>\s*<td[^>]*>\s*([0-9,]+\.\d{2})/i) ||
                    html.match(/Deposit To Bank<\/td>\s*<td[^>]*>\s*([0-9,]+\.\d{2})/i)
  const bankDeposit = bankMatch ? parseFloat(bankMatch[1].replace(/,/g, '')) : 0

  const jtMatch = html.match(/Journal Totals<\/strong><\/td>\s*<td[^>]*>\s*<strong>([0-9,]+\.\d{2})<\/strong><\/td>\s*<td[^>]*>\s*<strong>([0-9,]+\.\d{2})/i)
  const debits = jtMatch ? parseFloat(jtMatch[1].replace(/,/g, '')) : 0
  const credits = jtMatch ? parseFloat(jtMatch[2].replace(/,/g, '')) : 0

  return { netSales, totalTaxes, bankDeposit, debits, credits }
}

async function runMultiStoreVerification() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🔍 AUDITORÍA ALEATORIA MULTI-SUCURSAL Y FECHAS: COHESION VS TEG APP')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const availablePackets = JSON.parse(fs.readFileSync('cohesion_dump/available_packets.json', 'utf-8'))

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  try {
    // 1. Sign in to Cohesion
    console.log('Iniciando sesión en Cohesion...')
    await page.goto('https://cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' })
    await page.type('#Email', 'raquel@tacosgavilan.com')
    await page.type('#Password', 'Canasta213!')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]')
    ])
    console.log('✓ Sesión iniciada con éxito en Cohesion.\n')

    const auditResults: any[] = []

    for (const test of TESTS) {
      console.log(`─────────────────────────────────────────────────────────────────`)
      console.log(`🏪 PROBANDO SUCURSAL: ${test.storeName.toUpperCase()} — FECHA: ${test.dateDisplay}`)
      console.log(`─────────────────────────────────────────────────────────────────`)

      // Find packet in grid
      const packetMeta = availablePackets.find((p: any) => p.siteId === test.siteId && p.postingDate === test.dateDisplay)
      if (!packetMeta) {
        console.log(`⚠️ No se encontró packetId en cuadrícula para ${test.storeName} el ${test.dateDisplay}`)
        continue
      }

      // Navigate to Sales Main first to have the buttons ready
      await page.goto('https://cohesion4restaurants.com/MyWorkflowsSales/Main', { waitUntil: 'networkidle2' })
      await new Promise(r => setTimeout(r, 1500))

      const btnId = `#btnPacket_${packetMeta.packetId}`
      console.log(`Cargando paquete Cohesion #${packetMeta.packetId} (${btnId})...`)
      
      const btnExists = await page.$(btnId)
      if (btnExists) {
        await page.click(btnId)
        await new Promise(r => setTimeout(r, 3500))
      } else {
        console.log(`Botón ${btnId} no encontrado en pantalla, saltando.`)
        continue
      }

      const html = await page.content()
      const cohesion = parseCohesionHtml(html)

      // Get store in DB
      const { data: storeRow } = await supabaseAdmin
        .from('stores')
        .select('id, name, external_id')
        .ilike('name', `%${test.storeName}%`)
        .single()

      if (!storeRow || !storeRow.external_id) {
        console.log(`❌ No se encontró store o external_id para ${test.storeName}`)
        continue
      }

      // Call our Toast Accounting calculation
      console.log(`Consultando Toast API para ${test.storeName} (ID: ${storeRow.external_id}) en ${test.dateYMD}...`)
      const toastData = await fetchToastAccountingData(storeRow.external_id, test.dateYMD)
      const siteRefs = getQBStoreRefs(storeRow.name)

      const journal = generateJournalLines(
        {
          net_sales: toastData.netSales,
          total_taxes: toastData.totalTaxes,
          for_here_sales: toastData.forHereSales,
          to_go_sales: toastData.toGoSales,
          uber_delivery_sales: toastData.uberDeliverySales,
          uber_takeout_sales: toastData.uberTakeoutSales,
          doordash_takeout_sales: toastData.doordashTakeoutSales,
          doordash_delivery_sales: toastData.doordashDeliverySales,
          grubhub_delivery_sales: toastData.grubhubDeliverySales,
          tax_paid_by_uber: toastData.taxPaidByUber,
          sales_tax: toastData.salesTax,
          marketplace_tax: toastData.marketplaceTax,
          ebt_amount: toastData.ebtAmount,
          uber_payment: toastData.uberPayment,
          doordash_payment: toastData.doordashPayment,
          grubhub_payment: toastData.grubhubPayment,
          credit_card_deposit: toastData.creditCardDeposit,
          credit_card_fees: toastData.creditCardFees,
          cash_deposits: toastData.cashDeposit
        },
        {
          location: siteRefs.locationName,
          className: siteRefs.className,
          bank_account: siteRefs.bankAccount,
          sales_tax_rate_name: siteRefs.locationName
        }
      )

      const diffNet = Math.abs(cohesion.netSales - toastData.netSales)
      const diffTax = Math.abs(cohesion.totalTaxes - toastData.totalTaxes)
      const diffCash = Math.abs(cohesion.bankDeposit - toastData.cashDeposit)

      const result = {
        store: test.storeName,
        date: test.dateDisplay,
        cohesionNet: cohesion.netSales,
        tegNet: toastData.netSales,
        diffNet,
        cohesionTax: cohesion.totalTaxes,
        tegTax: toastData.totalTaxes,
        diffTax,
        cohesionCash: cohesion.bankDeposit,
        tegCash: toastData.cashDeposit,
        diffCash,
        cohesionJournal: cohesion.debits,
        tegJournal: journal.totalDebits,
        match100: diffNet < 0.05 && diffCash < 0.05
      }

      auditResults.push(result)

      console.log(`  • Net Sales:      Cohesion: $${cohesion.netSales.toFixed(2)} | TEG App: $${toastData.netSales.toFixed(2)} (Diff: $${diffNet.toFixed(2)})`)
      console.log(`  • Impuestos:      Cohesion: $${cohesion.totalTaxes.toFixed(2)} | TEG App: $${toastData.totalTaxes.toFixed(2)} (Diff: $${diffTax.toFixed(2)})`)
      console.log(`  • Depósito Banco: Cohesion: $${cohesion.bankDeposit.toFixed(2)} | TEG App: $${toastData.cashDeposit.toFixed(2)} (Diff: $${diffCash.toFixed(2)})`)
      console.log(`  • Póliza Totales: Cohesion: $${cohesion.debits.toFixed(2)} | TEG App: $${journal.totalDebits.toFixed(2)}`)
      console.log(`  • Diagnóstico:    ${result.match100 ? '✅ CUADRE PERFECTO' : '⚠️ VARIACIÓN DETECTADA'}`)
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════')
    console.log('📋 RESUMEN EJECUTIVO DE AUDITORÍA COMPARATIVA MULTI-SUCURSAL')
    console.log('═══════════════════════════════════════════════════════════════════════')
    console.table(auditResults.map(r => ({
      'Sucursal': r.store,
      'Fecha': r.date,
      'Net Cohesion': `$${r.cohesionNet.toFixed(2)}`,
      'Net TEG App': `$${r.tegNet.toFixed(2)}`,
      'Diff Net': `$${r.diffNet.toFixed(2)}`,
      'Efectivo Cohesion': `$${r.cohesionCash.toFixed(2)}`,
      'Efectivo TEG App': `$${r.tegCash.toFixed(2)}`,
      'Diff Efectivo': `$${r.diffCash.toFixed(2)}`,
      'Resultado': r.match100 ? '✅ Exacto al centavo' : '⚠️ Variación'
    })))

  } catch (err: any) {
    console.error('Error durante auditoría:', err)
  } finally {
    await browser.close()
  }
}

runMultiStoreVerification()
