/**
 * @file simulate-accounting-scenarios.ts
 * @description Comprehensive runtime simulation of the Accounting Journal Generator (lib/accounting-journal.ts).
 * Tests multiple store profiles, payment distributions, cash over/short scenarios, and edge cases.
 * 
 * Run via: npx tsx scripts/simulate-accounting-scenarios.ts
 */

import { generateJournalLines, formatDocNumber, calculateExpectedCash, SalesPacketData, SiteMappingConfig } from '../lib/accounting-journal'

interface TestCase {
  name: string
  store: string
  date: string
  config: SiteMappingConfig
  data: SalesPacketData
  expectedTotal?: number
  expectedDebits?: number
  expectedCredits?: number
}

const testCases: TestCase[] = [
  {
    name: '1. Línea Base Real Cohesion (Azusa 01-Sep-2026)',
    store: 'Azusa',
    date: '2026-09-01',
    config: {
      location: 'Azusa',
      className: 'Azusa',
      bank_account: '10000',
      sales_tax_rate_name: 'Azusa',
    },
    data: {
      net_sales: 8125.95,
      total_taxes: 850.06,
      for_here_sales: 3440.65,
      to_go_sales: 3186.29,
      uber_delivery_sales: 534.72,
      uber_takeout_sales: 31.73,
      doordash_takeout_sales: 273.20,
      doordash_delivery_sales: 637.43,
      grubhub_delivery_sales: 21.93,
      tax_paid_by_uber: 52.31,
      sales_tax: 704.42,
      marketplace_tax: 93.33,
      ebt_amount: 78.88,
      uber_payment: 618.76,
      doordash_payment: 1003.96,
      grubhub_payment: 24.29,
      credit_card_deposit: 4931.99,
      credit_card_fees: 92.18,
      cash_deposits: 2225.95,
    },
    expectedTotal: 8976.01,
  },
  {
    name: '2. Sucursal Lynwood — Faltante de Efectivo ($50.00 Shortage)',
    store: 'Lynwood',
    date: '2026-09-01',
    config: {
      location: 'Lynwood',
      className: 'Lynwood',
      bank_account: '10004',
      sales_tax_rate_name: 'Lynwood',
    },
    data: {
      net_sales: 11450.80,
      total_taxes: 1173.71,
      for_here_sales: 5200.00,
      to_go_sales: 4150.80,
      uber_delivery_sales: 850.00,
      uber_takeout_sales: 50.00,
      doordash_takeout_sales: 400.00,
      doordash_delivery_sales: 750.00,
      grubhub_delivery_sales: 50.00,
      tax_paid_by_uber: 85.00,
      sales_tax: 968.71,
      marketplace_tax: 120.00,
      ebt_amount: 150.00,
      uber_payment: 985.00,
      doordash_payment: 1270.00,
      grubhub_payment: 55.00,
      credit_card_deposit: 6800.00,
      credit_card_fees: 140.00,
      // Expected cash is 12624.51 - 9400.00 = 3224.51, but deposited 3174.51 ($50 short)
      cash_deposits: 3174.51,
    },
  },
  {
    name: '3. Sucursal Huntington Park — Sobrante de Efectivo ($35.50 Overage)',
    store: 'Huntington Park',
    date: '2026-09-01',
    config: {
      location: 'Huntington Park',
      className: 'Huntington Park',
      bank_account: '10008',
      sales_tax_rate_name: 'Huntington Park',
    },
    data: {
      net_sales: 9800.25,
      total_taxes: 1004.53,
      for_here_sales: 4500.25,
      to_go_sales: 3800.00,
      uber_delivery_sales: 600.00,
      uber_takeout_sales: 25.00,
      doordash_takeout_sales: 350.00,
      doordash_delivery_sales: 500.00,
      grubhub_delivery_sales: 25.00,
      tax_paid_by_uber: 60.00,
      sales_tax: 844.53,
      marketplace_tax: 100.00,
      ebt_amount: 110.00,
      uber_payment: 685.00,
      doordash_payment: 935.00,
      grubhub_payment: 27.50,
      credit_card_deposit: 5900.00,
      credit_card_fees: 115.00,
      // Expected cash is 10804.78 - 7772.50 = 3032.28, but deposited 3067.78 ($35.50 over)
      cash_deposits: 3067.78,
    },
  },
  {
    name: '4. Sucursal Santa Ana — Alto Volumen de Delivery (Apps Pesadas)',
    store: 'Santa Ana',
    date: '2026-09-01',
    config: {
      location: 'Santa Ana',
      className: 'Santa Ana',
      bank_account: '10007',
      sales_tax_rate_name: 'Santa Ana',
    },
    data: {
      net_sales: 14200.50,
      total_taxes: 1313.55,
      for_here_sales: 4200.50,
      to_go_sales: 3500.00,
      uber_delivery_sales: 2400.00,
      uber_takeout_sales: 100.00,
      doordash_takeout_sales: 1200.00,
      doordash_delivery_sales: 2800.00,
      grubhub_delivery_sales: 0.00, // Sin GrubHub
      tax_paid_by_uber: 240.00,
      sales_tax: 713.55,
      marketplace_tax: 360.00,
      ebt_amount: 50.00,
      uber_payment: 2740.00,
      doordash_payment: 4400.00,
      grubhub_payment: 0.00,
      credit_card_deposit: 5200.00,
      credit_card_fees: 105.00,
      cash_deposits: 3019.05,
    },
  },
  {
    name: '5. Sucursal West Covina — Alto Volumen en Efectivo (Dine-in Pesado)',
    store: 'West Covina',
    date: '2026-09-01',
    config: {
      location: 'West Covina',
      className: 'West Covina',
      bank_account: '10012',
      sales_tax_rate_name: 'West Covina',
    },
    data: {
      net_sales: 16800.90,
      total_taxes: 1638.09,
      for_here_sales: 9800.90,
      to_go_sales: 6200.00,
      uber_delivery_sales: 350.00,
      uber_takeout_sales: 50.00,
      doordash_takeout_sales: 150.00,
      doordash_delivery_sales: 250.00,
      grubhub_delivery_sales: 0.00,
      tax_paid_by_uber: 35.00,
      sales_tax: 1558.09,
      marketplace_tax: 45.00,
      ebt_amount: 320.00,
      uber_payment: 435.00,
      doordash_payment: 440.00,
      grubhub_payment: 0.00,
      credit_card_deposit: 8200.00,
      credit_card_fees: 165.00,
      cash_deposits: 8878.99,
    },
  },
]

function runSimulations() {
  console.log('================================================================================')
  console.log('  EJECUCIÓN DE SIMULACIÓN CONTABLE MULTI-ESCENARIO — TACOS GAVILAN')
  console.log('================================================================================\n')

  let passedAll = true

  testCases.forEach((tc, idx) => {
    console.log(`────────────────────────────────────────────────────────────────────────────────`)
    console.log(`ESCENARIO ${idx + 1}: ${tc.name}`)
    console.log(`Tienda: ${tc.store}  |  Fecha: ${tc.date}  |  DocNumber: ${formatDocNumber(tc.store, tc.date)}`)
    console.log(`────────────────────────────────────────────────────────────────────────────────`)

    const expectedCash = calculateExpectedCash(tc.data)
    const result = generateJournalLines(tc.data, tc.config)

    console.log(`\n• Resumen Operativo:`)
    console.log(`  Ventas Netas:           $${tc.data.net_sales.toFixed(2)}`)
    console.log(`  Total Impuestos:        $${tc.data.total_taxes.toFixed(2)}`)
    console.log(`  Ingreso Bruto Total:    $${(tc.data.net_sales + tc.data.total_taxes).toFixed(2)}`)
    console.log(`  Efectivo Esperado:      $${expectedCash.toFixed(2)}`)
    console.log(`  Depósito Real Efectivo: $${tc.data.cash_deposits.toFixed(2)}`)
    const diff = tc.data.cash_deposits - expectedCash
    if (Math.abs(diff) > 0.001) {
      console.log(`  Variación Caja (51050): $${diff.toFixed(2)} (${diff > 0 ? 'Sobrante / Overage' : 'Faltante / Shortage'})`)
    } else {
      console.log(`  Variación Caja (51050): $0.00 (Exacto)`)
    }

    console.log(`\n• Póliza de Diario Generada (${result.lines.length} líneas):`)
    console.log(`  #  | Cuenta | Memo / Descripción                  | Tipo    |       Monto | Clase/Ubicación`)
    console.log(`  ---|--------|-------------------------------------|---------|-------------|----------------`)

    result.lines.forEach((l, lIdx) => {
      const num = String(lIdx + 1).padStart(2)
      const acct = l.account.padEnd(6)
      const memo = l.memo.padEnd(35)
      const type = l.debit > 0 ? 'DÉBITO ' : 'CRÉDITO'
      const amt = ('$' + (l.debit > 0 ? l.debit : l.credit).toFixed(2)).padStart(11)
      const loc = l.location
      console.log(`  ${num} | ${acct} | ${memo} | ${type} | ${amt} | ${loc}`)
    })

    console.log(`  ---|--------|-------------------------------------|---------|-------------|----------------`)
    console.log(`     | TOTALS | TOTAL DÉBITOS                       | DÉBITO  | $${result.totalDebits.toFixed(2).padStart(10)} |`)
    console.log(`     |        | TOTAL CRÉDITOS                      | CRÉDITO | $${result.totalCredits.toFixed(2).padStart(10)} |`)
    console.log(`     | STATUS | BALANCE MATEMÁTICO                  | RESULT  | ${result.isBalanced ? '✅ CUADRADA AL CENTAVO' : '❌ DESBALANCEADA'} |`)

    if (tc.expectedTotal) {
      const match = Math.abs(result.totalDebits - tc.expectedTotal) < 0.01
      console.log(`     | VALID. | Coincidencia exacta con Cohesion    | TEST    | ${match ? '✅ MATCH EXACTO ($' + tc.expectedTotal.toFixed(2) + ')' : '❌ NO COINCIDE'} |`)
      if (!match) passedAll = false
    }

    if (!result.isBalanced) passedAll = false
    console.log('')
  })

  console.log('================================================================================')
  console.log(`RESULTADO FINAL DE LAS SIMULACIONES: ${passedAll ? '✅ 100% EXITOSAS — TODAS LAS PÓLIZAS CUADRAN AL CENTAVO' : '❌ HUBO ERRORES'}`)
  console.log('================================================================================\n')
}

runSimulations()
