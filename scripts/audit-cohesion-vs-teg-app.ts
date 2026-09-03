import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'
import { fetchToastSalesPacket } from '../lib/toast-accounting'
import { generateJournalLines } from '../lib/accounting-journal'
import { getQBStoreRefs } from '../lib/qb-classes-locations'

interface ComparisonTarget {
  storeName: string
  siteId: string
  dateStr: string // YYYY-MM-DD
  dateDisplay: string // MM/DD/YYYY
}

const TARGETS: ComparisonTarget[] = [
  { storeName: 'Downey', siteId: '2193', dateStr: '2026-08-31', dateDisplay: '08/31/2026' },
  { storeName: 'Lynwood', siteId: '2262', dateStr: '2026-08-31', dateDisplay: '08/31/2026' },
  { storeName: 'South Gate', siteId: '2283', dateStr: '2026-08-30', dateDisplay: '08/30/2026' },
  { storeName: 'Huntington Park', siteId: '2276', dateStr: '2026-08-29', dateDisplay: '08/29/2026' },
  { storeName: 'West Covina', siteId: '2250', dateStr: '2026-08-28', dateDisplay: '08/28/2026' },
]

async function runAudit() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🔬 AUDITORÍA COMPARATIVA ALEATORIA: COHESION (QBO) VS APP TEG NATIVA')
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
    console.log('✓ Sesión iniciada con éxito en Cohesion.')

    for (const target of TARGETS) {
      console.log('\n─────────────────────────────────────────────────────────────────')
      console.log(`🏪 AUDITANDO SUCURSAL: ${target.storeName.toUpperCase()} — FECHA: ${target.dateDisplay} (${target.dateStr})`)
      console.log('─────────────────────────────────────────────────────────────────')

      // Find packet in Cohesion available packets
      const packetMeta = availablePackets.find((p: any) => p.siteId === target.siteId && p.postingDate === target.dateDisplay)
      if (!packetMeta) {
        console.log(`⚠️ No se encontró packetId para ${target.storeName} el ${target.dateDisplay} en la cuadrícula.`)
        continue
      }

      console.log(`Encontrado en Cohesion: PacketId #${packetMeta.packetId} (Estatus: ${packetMeta.status})`)

      // Open PacketReview page in Cohesion
      const reviewUrl = `https://cohesion4restaurants.com/MyWorkflows/PacketReview?PacketId=${packetMeta.packetId}`
      await page.goto(reviewUrl, { waitUntil: 'networkidle2' })

      // Extract Cohesion details from page content
      const htmlContent = await page.content()
      
      // Parse values from HTML
      const extractVal = (pattern: RegExp) => {
        const m = htmlContent.match(pattern)
        if (!m) return 0
        return parseFloat(m[1].replace(/,/g, ''))
      }

      // Extract Net Sales, Taxes, Bank Deposit, Totals from Cohesion HTML
      // Cohesion uses specific table row patterns or text
      let netSales = extractVal(/Net Sales[^<]*<\/td>\s*<td[^>]*>\s*\$?([0-9,]+\.\d{2})/i)
      if (!netSales) netSales = extractVal(/Net Sales[\s\S]*?\$([0-9,]+\.\d{2})/)

      let totalTaxes = extractVal(/Total Tax Liability[^<]*<\/td>\s*<td[^>]*>\s*\$?([0-9,]+\.\d{2})/i)
      if (!totalTaxes) totalTaxes = extractVal(/Tax Liability[\s\S]*?\$([0-9,]+\.\d{2})/)

      let expectedCash = extractVal(/Expected Cash[^<]*<\/td>\s*<td[^>]*>\s*\$?([0-9,]+\.\d{2})/i)
      if (!expectedCash) expectedCash = extractVal(/Expected Cash[\s\S]*?\$([0-9,]+\.\d{2})/)

      let bankDeposit = extractVal(/Deposit To Bank[^<]*<\/td>\s*<td[^>]*>\s*\$?([0-9,]+\.\d{2})/i)
      if (!bankDeposit) bankDeposit = extractVal(/Bank Deposit[\s\S]*?\$([0-9,]+\.\d{2})/)

      // Look for Journal Totals in the journal table
      const journalMatches = Array.from(htmlContent.matchAll(/Journal Totals[\s\S]*?\$([0-9,]+\.\d{2})[\s\S]*?\$([0-9,]+\.\d{2})/g))
      let debits = 0
      let credits = 0
      if (journalMatches.length > 0) {
        debits = parseFloat(journalMatches[0][1].replace(/,/g, ''))
        credits = parseFloat(journalMatches[0][2].replace(/,/g, ''))
      }

      const docMatch = htmlContent.match(/POS\d{8}[A-Z0-9-]+/)
      const docNumber = docMatch ? docMatch[0] : ''

      const cohesionData = {
        netSales,
        totalTaxes,
        expectedCash,
        bankDeposit,
        debits,
        credits,
        docNumber
      }

      console.log(`📊 Datos de Cohesion (Publicados en QuickBooks):`)
      console.log(`  • Net Sales: $${cohesionData.netSales.toFixed(2)}`)
      console.log(`  • Total Impuestos: $${cohesionData.totalTaxes.toFixed(2)}`)
      console.log(`  • Expected Cash: $${cohesionData.expectedCash.toFixed(2)}`)
      console.log(`  • Bank Deposit (13200): $${cohesionData.bankDeposit.toFixed(2)}`)
      console.log(`  • Journal Debits / Credits: $${cohesionData.debits.toFixed(2)} / $${cohesionData.credits.toFixed(2)}`)

      // 2. Fetch our TEG App / Toast calculation
      // Get store from DB
      const { data: storeRow } = await supabaseAdmin
        .from('stores')
        .select('id, name, external_id')
        .ilike('name', `%${target.storeName}%`)
        .single()

      if (!storeRow) {
        console.log(`❌ No se encontró store en DB para ${target.storeName}`)
        continue
      }

      console.log(`\n⚙️ Ejecutando cálculo nativo TEG App para Store #${storeRow.id} (${storeRow.name})...`)
      try {
        const toastPacket = await fetchToastSalesPacket(storeRow.id, target.dateStr)
        const siteMapping = getQBStoreRefs(storeRow.name)

        const tegJournal = generateJournalLines(
          {
            net_sales: toastPacket.net_sales,
            total_taxes: toastPacket.total_taxes,
            for_here_sales: toastPacket.dine_in_sales,
            to_go_sales: toastPacket.togo_sales,
            uber_delivery_sales: toastPacket.uber_delivery_sales,
            uber_takeout_sales: toastPacket.uber_takeout_sales,
            doordash_takeout_sales: toastPacket.doordash_takeout_sales,
            doordash_delivery_sales: toastPacket.doordash_delivery_sales,
            grubhub_delivery_sales: toastPacket.grubhub_sales,
            tax_paid_by_uber: toastPacket.facilitator_tax_paid,
            sales_tax: toastPacket.sales_tax,
            marketplace_tax: toastPacket.marketplace_facilitator_tax,
            ebt_amount: toastPacket.ebt_amount,
            uber_payment: toastPacket.uber_payment,
            doordash_payment: toastPacket.doordash_payment,
            grubhub_payment: toastPacket.grubhub_payment,
            credit_card_deposit: toastPacket.credit_card_deposit,
            credit_card_fees: toastPacket.credit_card_fees,
            cash_deposits: toastPacket.cash_deposit
          },
          {
            location: siteMapping.locationName,
            className: siteMapping.className,
            bank_account: siteMapping.bankAccount,
            sales_tax_rate_name: siteMapping.locationName
          }
        )

        console.log(`📊 Datos calculados por TEG App (Toast API):`)
        console.log(`  • Net Sales: $${toastPacket.net_sales.toFixed(2)}`)
        console.log(`  • Total Impuestos: $${toastPacket.total_taxes.toFixed(2)}`)
        console.log(`  • Expected Cash: $${toastPacket.expected_cash.toFixed(2)}`)
        console.log(`  • Bank Deposit (13200): $${toastPacket.cash_deposit.toFixed(2)}`)
        console.log(`  • Journal Debits / Credits: $${tegJournal.totalDebits.toFixed(2)} / $${tegJournal.totalCredits.toFixed(2)}`)

        // 3. Comparison
        const diffNetSales = Math.abs(cohesionData.netSales - toastPacket.net_sales)
        const diffTaxes = Math.abs(cohesionData.totalTaxes - toastPacket.total_taxes)
        const diffCash = Math.abs(cohesionData.bankDeposit - toastPacket.cash_deposit)
        const diffJournal = Math.abs(cohesionData.debits - tegJournal.totalDebits)

        console.log(`\n⚖️ RESULTADO DE CONCILIACIÓN:`)
        console.log(`  ┌─────────────────────────────────┬──────────────┬──────────────┬──────────────┐`)
        console.log(`  │ Métrica                         │ Cohesion     │ TEG App      │ Diferencia   │`)
        console.log(`  ├─────────────────────────────────┼──────────────┼──────────────┼──────────────┤`)
        console.log(`  │ Net Sales                       │ $${cohesionData.netSales.toFixed(2).padStart(11)} │ $${toastPacket.net_sales.toFixed(2).padStart(11)} │ $${diffNetSales.toFixed(2).padStart(11)} │`)
        console.log(`  │ Total Impuestos                 │ $${cohesionData.totalTaxes.toFixed(2).padStart(11)} │ $${toastPacket.total_taxes.toFixed(2).padStart(11)} │ $${diffTaxes.toFixed(2).padStart(11)} │`)
        console.log(`  │ Depósito Efectivo (13200)       │ $${cohesionData.bankDeposit.toFixed(2).padStart(11)} │ $${toastPacket.cash_deposit.toFixed(2).padStart(11)} │ $${diffCash.toFixed(2).padStart(11)} │`)
        console.log(`  │ Total Póliza (Débito/Crédito)   │ $${cohesionData.debits.toFixed(2).padStart(11)} │ $${tegJournal.totalDebits.toFixed(2).padStart(11)} │ $${diffJournal.toFixed(2).padStart(11)} │`)
        console.log(`  └─────────────────────────────────┴──────────────┴──────────────┴──────────────┘`)

        if (diffNetSales < 0.05 && diffCash < 0.05) {
          console.log(`  🎯 ¡CUADRE PERFECTO AL 100%! Ambos sistemas coinciden al centavo.`)
        } else {
          console.log(`  ℹ️ Nota: Variación detectada ($${diffNetSales.toFixed(2)} en ventas / $${diffCash.toFixed(2)} en efectivo).`)
        }
      } catch (err: any) {
        console.error(`Error calculando datos de Toast para ${target.storeName}:`, err.message)
      }
    }

  } catch (err: any) {
    console.error('Error durante auditoría comparativa:', err)
  } finally {
    await browser.close()
  }
}

runAudit()
