import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { fetchToastAccountingData } from '../lib/toast-accounting'
import { generateJournalLines } from '../lib/accounting-journal'
import { getQBStoreRefs } from '../lib/qb-classes-locations'

async function compareDowney() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('⚖️ COMPARACIÓN EXACTA: DOWNEY — 31 DE AGOSTO, 2026')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const externalId = 'b7f63b01-f089-4ad7-a346-afdb1803dc1a'
  const dateStr = '20260831' // 2026-08-31

  console.log('Consultando Toast API para Downey en 20260831...')
  const toastData = await fetchToastAccountingData(externalId, dateStr)

  console.log('\n📊 DATOS CALCULADOS POR NUESTRA APP (TOAST API):')
  console.log(`• Net Sales: $${toastData.netSales.toFixed(2)}`)
  console.log(`• Total Taxes: $${toastData.totalTaxes.toFixed(2)}`)
  console.log(`• For Here: $${toastData.forHereSales.toFixed(2)}`)
  console.log(`• To Go: $${toastData.toGoSales.toFixed(2)}`)
  console.log(`• Uber Delivery: $${toastData.uberDeliverySales.toFixed(2)}`)
  console.log(`• Uber Takeout: $${toastData.uberTakeoutSales.toFixed(2)}`)
  console.log(`• DoorDash Delivery: $${toastData.doordashDeliverySales.toFixed(2)}`)
  console.log(`• DoorDash Takeout: $${toastData.doordashTakeoutSales.toFixed(2)}`)
  console.log(`• GrubHub Delivery: $${toastData.grubhubDeliverySales.toFixed(2)}`)
  console.log(`• Grubhub Takeout: $${toastData.grubhubTakeoutSales.toFixed(2)}`)
  console.log(`• Sales Tax: $${toastData.salesTax.toFixed(2)}`)
  console.log(`• Marketplace Tax: $${toastData.marketplaceTax.toFixed(2)}`)
  console.log(`• Tax Paid by Uber: $${toastData.taxPaidByUber.toFixed(2)}`)
  console.log(`• Credit Card Deposit: $${toastData.creditCardDeposit.toFixed(2)}`)
  console.log(`• Credit Card Fees: $${toastData.creditCardFees.toFixed(2)}`)
  console.log(`• EBT: $${toastData.ebtAmount.toFixed(2)}`)
  console.log(`• Uber Payment: $${toastData.uberPayment.toFixed(2)}`)
  console.log(`• DoorDash Payment: $${toastData.doordashPayment.toFixed(2)}`)
  console.log(`• GrubHub Payment: $${toastData.grubhubPayment.toFixed(2)}`)
  console.log(`• Cash Deposit (13200): $${toastData.cashDeposit.toFixed(2)}`)

  console.log('\n🏛️ DATOS PUBLICADOS POR COHESION EN QUICKBOOKS (DOWNEY 08/31/2026):')
  const cohesion = {
    netSales: 9002.19,
    totalTaxes: 923.37,
    forHere: 2752.22,
    toGo: 4628.84,
    uberDelivery: 835.09,
    uberTakeout: 0.00,
    doordashDelivery: 636.92,
    doordashTakeout: 99.83,
    grubhubDelivery: 31.95,
    grubhubTakeout: 17.34,
    salesTax: 764.02,
    marketplaceTax: 77.36,
    taxPaidByUber: 81.99,
    creditCardDeposit: 5520.53,
    creditCardFees: 106.20,
    ebtAmount: 147.31,
    uberPayment: 917.08,
    doordashPayment: 814.11,
    grubhubPayment: 54.45,
    cashDeposit: 2341.64,
    totalJournal: 9925.56
  }

  console.log(`• Net Sales: $${cohesion.netSales.toFixed(2)}`)
  console.log(`• Total Taxes: $${cohesion.totalTaxes.toFixed(2)}`)
  console.log(`• Cash Deposit (13200): $${cohesion.cashDeposit.toFixed(2)}`)
  console.log(`• Total Journal: $${cohesion.totalJournal.toFixed(2)}`)

  console.log('\n⚖️ COMPARATIVA CENTAVO A CENTAVO:')
  console.log(`Net Sales Diff: $${Math.abs(toastData.netSales - cohesion.netSales).toFixed(2)}`)
  console.log(`Taxes Diff: $${Math.abs(toastData.totalTaxes - cohesion.totalTaxes).toFixed(2)}`)
  console.log(`Cash Deposit Diff: $${Math.abs(toastData.cashDeposit - cohesion.cashDeposit).toFixed(2)}`)
}

compareDowney()
