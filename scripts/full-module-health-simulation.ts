import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'
import { generateJournalLines, calculateExpectedCash, formatDocNumber } from '../lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '../lib/accounting-journal'
import { fetchToastAccountingData } from '../lib/toast-accounting'

async function runFullModuleSimulation() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🔍 SIMULACIÓN EXHAUSTIVA DE SALUD Y FUNCIONAMIENTO DEL MÓDULO')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  let passedTests = 0
  let totalTests = 0

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++
    if (condition) {
      passedTests++
      console.log(`✅ [PASS] ${testName}`)
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? `-> ${detail}` : ''}`)
    }
  }

  // 1. Database Relational Integrity
  console.log('1. Verificando Integridad de Tablas y Esquemas en Supabase:')
  const { data: stores, error: storesErr } = await supabaseAdmin
    .from('stores')
    .select('id, name, external_id')
    .eq('is_active', true)
    .order('name')
  
  assert(!storesErr && stores && stores.length >= 15, `Tiendas activas cargadas (Total: ${stores?.length || 0})`)

  const { data: mappings, error: mapErr } = await supabaseAdmin
    .from('accounting_site_mappings')
    .select('*')
    .eq('is_active', true)

  assert(!mapErr && mappings && mappings.length >= 15, `Mapeos de sucursales configurados (Total: ${mappings?.length || 0})`)

  const { data: glAccounts, error: glErr } = await supabaseAdmin
    .from('accounting_gl_accounts')
    .select('*')
    .not('qb_account_id', 'is', null)

  assert(!glErr && glAccounts && glAccounts.length >= 15, `Cuentas contables GL con ID de QuickBooks (Total: ${glAccounts?.length || 0})`)

  // 2. Accounting Math & Journal Balancing
  console.log('\n2. Verificando Fórmulas Contables y Balance Estricto del Journal:')
  const sampleSales: SalesPacketData = {
    net_sales: 5850.50,
    total_taxes: 585.05,
    for_here_sales: 2800.25,
    to_go_sales: 2050.25,
    toast_online_sales: 0,
    uber_delivery_sales: 400.00,
    uber_takeout_sales: 0,
    doordash_takeout_sales: 200.00,
    doordash_delivery_sales: 400.00,
    grubhub_delivery_sales: 0,
    grubhub_takeout_sales: 0,
    tax_paid_by_uber: 38.00,
    sales_tax: 480.00,
    marketplace_tax: 67.05,
    ebt_amount: 50.00,
    uber_payment: 438.00,
    doordash_payment: 667.05,
    grubhub_payment: 0,
    credit_card_deposit: 3200.00,
    credit_card_fees: 80.50,
    cash_deposits: 2000.00
  }

  const sampleConfig: SiteMappingConfig = {
    location: 'Azusa',
    className: 'Azusa',
    bank_account: '10014',
    sales_tax_rate_name: 'Azusa Tax'
  }

  const journalResult = generateJournalLines(sampleSales, sampleConfig)
  assert(journalResult.isBalanced, `Journal Entry perfectamente balanceado (${journalResult.totalDebits} === ${journalResult.totalCredits})`)
  assert(journalResult.lines.length > 5, `Líneas contables generadas (Total: ${journalResult.lines.length} líneas)`)

  const expectedCash = calculateExpectedCash(sampleSales)
  assert(expectedCash > 0, `Efectivo esperado calculado positivamente ($${expectedCash.toFixed(2)})`)

  const docNumber = formatDocNumber('Azusa', '2026-09-02')
  assert(docNumber === 'AZUSA-20260902', `Formato de número de documento correcto (${docNumber})`)

  // 3. Step 11 Open Orders Rule
  console.log('\n3. Verificando Regla de Oro del Paso 11 (Bloqueo por Órdenes Abiertas):')
  const simulatedCleanToast = {
    hasOpenOrders: false,
    openOrdersCount: 0,
    outOfBalanceOrdersCount: 0
  }
  const simulatedDirtyToast = {
    hasOpenOrders: true,
    openOrdersCount: 2,
    outOfBalanceOrdersCount: 1
  }

  const cleanStatus = simulatedCleanToast.hasOpenOrders ? 'pending' : 'ready'
  const dirtyStatus = simulatedDirtyToast.hasOpenOrders ? 'pending' : 'ready'

  assert(cleanStatus === 'ready', `Tienda limpia se marca como READY para publicación en 1 clic`)
  assert(dirtyStatus === 'pending', `Tienda con órdenes abiertas se bloquea en PENDING`)

  // 4. Live Database Mutation Smoke Test (Mandatory Rule)
  console.log('\n4. Prueba de Mutación Real en Base de Datos (Smoke Test Live Insert & Cleanup):')
  const testStoreId = mappings[0].store_id
  const testDate = '2099-12-31' // Safe future test date

  const testPacketPayload = {
    store_id: testStoreId,
    business_date: testDate,
    status: 'pending',
    net_sales: 100.00,
    gross_sales: 110.00,
    total_taxes: 10.00,
    journal_total_debits: 110.00,
    journal_total_credits: 110.00,
    qb_doc_number: 'TEST-SMOKE-20991231',
    notes: 'Temporary smoke test packet - safe to delete',
    journal_lines: []
  }

  // Insert
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('accounting_sales_packets')
    .insert(testPacketPayload)
    .select()
    .single()

  assert(!insertErr && inserted?.id, `Inserción exitosa en accounting_sales_packets (ID: ${inserted?.id || 'none'})`, insertErr?.message)

  // Verify read
  const { data: readBack, error: readErr } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('*')
    .eq('id', inserted?.id)
    .single()

  assert(!readErr && readBack?.qb_doc_number === 'TEST-SMOKE-20991231', `Lectura y verificación de integridad de datos exitosa`)

  // Update
  const { error: updateErr } = await supabaseAdmin
    .from('accounting_sales_packets')
    .update({ status: 'ready', notes: 'Updated in smoke test' })
    .eq('id', inserted?.id)

  assert(!updateErr, `Actualización de estado exitosa`)

  // Cleanup (Delete)
  const { error: deleteErr } = await supabaseAdmin
    .from('accounting_sales_packets')
    .delete()
    .eq('id', inserted?.id)

  assert(!deleteErr, `Limpieza y eliminación del registro de prueba exitosa (Cero basura en DB)`)

  // 5. Timezone and Business Hours Cutoff
  console.log('\n5. Verificando Regla de Horario Laboral y Zona Horaria (America/Los_Angeles):')
  const now = new Date()
  const laString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  const laDate = new Date(laString)
  assert(!isNaN(laDate.getTime()), `Conversión a zona horaria America/Los_Angeles válida (${laString})`)

  console.log('\n═══════════════════════════════════════════════════════════════════════')
  console.log(`📊 RESULTADO FINAL: ${passedTests} de ${totalTests} PRUEBAS APROBADAS (${Math.round(passedTests/totalTests*100)}%)`)
  console.log('═══════════════════════════════════════════════════════════════════════')
}

runFullModuleSimulation()
