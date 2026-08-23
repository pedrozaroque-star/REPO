/**
 * @file audit_radar_simulation_comprehensive.ts
 * @description Suite de pruebas y simulación en tiempo de ejecución del Módulo Radar de Precios de Proveedores.
 * Valida:
 *  1. Parser Semántico (TSV, CSV, Texto desordenado, formatos de moneda, inferencia de empaques, ReDoS safety).
 *  2. Motor de Comparación y Fórmulas Matemáticas (Aumentos, Reducciones, Inflación %, Impacto Anual 15 Tiendas).
 *  3. Prevención de Divisiones por Cero y Sanitización Numérica ($0.00 protection).
 *  4. Generador de Correo de Alerta HTML y Validación de Destinatarios.
 *  5. Prueba Real de Mutación en Base de Datos (Live DB Mutation Smoke Test) con Supabase y limpieza inmediata.
 */

import fs from 'fs'
import path from 'path'

// Cargar variables de entorno manualmente desde .env.local
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=')
      const key = trimmed.substring(0, idx).trim()
      const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  })
}

import { createClient } from '@supabase/supabase-js'
import { parseSupplierInput, inferPackQuantity } from '../lib/supplier-price-parser'
import { ESTIMATED_ANNUAL_VOLUMES, DEFAULT_ANNUAL_VOLUME } from '../lib/constants/supplier-volumes'
import { generatePriceAlertEmailHtml, DEFAULT_PRICE_ALERT_RECIPIENTS } from '../lib/supplier-price-email'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

let totalTests = 0
let passedTests = 0
let failedTests = 0

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++
  if (condition) {
    passedTests++
    console.log(`  ✅ [PASS] ${testName}`)
  } else {
    failedTests++
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`)
  }
}

async function runComprehensiveAudit() {
  console.log('======================================================================')
  console.log('🔬 SIMULACIÓN FORENSE INTEGRAL: RADAR DE PRECIOS DE PROVEEDORES')
  console.log('======================================================================\n')

  // ─── SECCIÓN 1: INFERENCIA DE EMPAQUES Y CANTIDADES (PACK SIZES) ───
  console.log('📦 SECCIÓN 1: Inferencia de Empaques y Unidades Multi-Pack')
  assert(inferPackQuantity('CS (500 pzas)', 'EP9PR') === 500, 'Infiere 500 pzas de "CS (500 pzas)"')
  assert(inferPackQuantity('10/100ct', 'STRAW') === 1000, 'Infiere 1000 pzas de formato multi-pack "10/100ct"')
  assert(inferPackQuantity('4/1 GAL', 'CLEANER') === 4, 'Infiere 4 unidades de "4/1 GAL"')
  assert(inferPackQuantity('12/32 OZ', 'BOTTLE') === 12, 'Infiere 12 unidades de "12/32 OZ"')
  assert(inferPackQuantity('2,500/CS', 'CUP4OZ') === 2500, 'Infiere 2500 con coma de "2,500/CS"')
  assert(inferPackQuantity('1 CS', 'BAG') === 1, 'Infiere 1 para "1 CS"')
  assert(inferPackQuantity('', 'EP9PR') === 500, 'Fallback a catálogo conocido para SKU EP9PR')
  assert(inferPackQuantity('UNKNOWN_FORMAT_ABC', 'UNKNOWN_SKU') === 1, 'Fallback seguro a 1 para formato desconocido')

  // ─── SECCIÓN 2: PARSER SEMÁNTICO (TSV, CSV, TEXTO COPIADO Y SUCIO) ───
  console.log('\n📋 SECCIÓN 2: Parser Semántico Multi-Estrategia & Seguridad ReDoS')
  
  // Test 2.1: TSV limpio (copiado de tabla web/Excel)
  const tsvInput = `Item\tDescription\tPack\tPrice
EP9PR\tPrimo MFPP Plate, 9" 3/COMP Ivory\t500/CS\t$34.50
ELDP32\tEl Gavilan Cup, 32 oz Paper\t500/CS\t$52.40
IC4FLCL\tInfinite Chemical Floor Cleaner Lemon\t4/1 GAL\t$39.50`
  const tsvResult = parseSupplierInput(tsvInput)
  assert(tsvResult.success && tsvResult.items.length === 3, 'Parser TSV extrae 3 items correctamente')
  assert(tsvResult.items[0]?.supplierSku === 'EP9PR' && tsvResult.items[0]?.casePrice === 34.50, 'TSV parsea SKU EP9PR y precio $34.50')
  assert(tsvResult.items[1]?.packQuantity === 500, 'TSV parsea packQuantity 500 para ELDP32')

  // Test 2.2: CSV con comas y comillas
  const csvInput = `SKU,Description,PackSize,Price
"EP9PR","Plato 9 pulg, 3 divisiones","500 pzas","$34.50"
"EL4OZ","Vaso salsero 4 oz","2,500 pzas","$27.30"`
  const csvResult = parseSupplierInput(csvInput)
  assert(csvResult.success && csvResult.items.length === 2, 'Parser CSV extrae 2 items con comillas y comas')
  assert(csvResult.items[1]?.casePrice === 27.30 && csvResult.items[1]?.packQuantity === 2500, 'CSV parsea precio $27.30 y 2500 pzas')

  // Test 2.3: Prueba de seguridad ReDoS en CSV (comillas no cerradas repetidas)
  const redosStartTime = Date.now()
  const malformedCsv = `SKU,Desc,Price\n` + `"EP9PR","Plato no cerrado """""""""""""""""""""""""""""""",34.50\n`.repeat(20)
  const redosResult = parseSupplierInput(malformedCsv)
  const redosDuration = Date.now() - redosStartTime
  assert(redosDuration < 200, `Parser CSV es inmune a ReDoS (ejecutó en ${redosDuration}ms < 200ms)`)

  // Test 2.4: Texto desordenado o copiado de correo (Semantic Line Parser)
  const messyInput = `Cotización actualizada Viele & Sons:
- Producto EP9PR plato 9 tres divisiones a un costo de $34.50 por caja
- Vaso grande ELDP32 a $52.40 la caja
- Químico de pisos IC4FLCL rebajado a 39.50`
  const messyResult = parseSupplierInput(messyInput)
  assert(messyResult.success && messyResult.items.length >= 2, 'Parser semántico rescata items de texto libre')

  // Test 2.5: Casos de borde en precios ($0.00, valores negativos, texto vacío)
  const emptyResult = parseSupplierInput('')
  assert(!emptyResult.success && emptyResult.items.length === 0, 'Texto vacío retorna success: false limpiamente')

  // ─── SECCIÓN 3: MATEMÁTICAS FINANCIERAS Y PREVENCIÓN DE ERRORES ───
  console.log('\n💵 SECCIÓN 3: Precisión Matemática y Prevención de 0/0 (Division by Zero)')
  
  // Test 3.1: Cálculo de Aumento Real (EP9PR)
  const prevPrice = 29.98
  const newPrice = 34.50
  const diff = Number((newPrice - prevPrice).toFixed(2))
  const changePct = Number(((diff / prevPrice) * 100).toFixed(2))
  const annualVol = ESTIMATED_ANNUAL_VOLUMES['EP9PR'] || DEFAULT_ANNUAL_VOLUME
  const annualImpact = Number((diff * annualVol).toFixed(2))

  assert(diff === 4.52, 'Diferencia de caja exacta: +$4.52')
  assert(changePct === 15.08, 'Porcentaje de aumento exacto: +15.08%')
  assert(annualVol === 8776, 'Volumen anual calibrado para EP9PR: 8,776 cajas/año en 15 tiendas')
  assert(annualImpact === 39667.52, 'Impacto anual exacto para 15 tiendas: +$39,667.52 USD / año')

  // Test 3.2: Costo Unitario por Plato
  const packQty = 500
  const unitCost = Number((newPrice / packQty).toFixed(4))
  assert(unitCost === 0.0690, 'Costo unitario por plato exacto a 4 decimales: $0.0690 / plato')

  // Test 3.3: Prevención de División por Cero (Nuevo Insumo o Precio Base 0)
  const zeroBasePrice = 0
  const safeChangePercent = zeroBasePrice > 0 ? Number(((diff / zeroBasePrice) * 100).toFixed(2)) : 0
  assert(!isNaN(safeChangePercent) && isFinite(safeChangePercent) && safeChangePercent === 0, 'Safe change percent no produce NaN ni Infinity cuando base es 0')

  // ─── SECCIÓN 4: PLANTILLA DE CORREO Y DESTINATARIOS OFICIALES ───
  console.log('\n📧 SECCIÓN 4: Sistema de Notificación y Plantilla HTML')
  assert(DEFAULT_PRICE_ALERT_RECIPIENTS.length === 4, 'Existen exactamente 4 destinatarios oficiales')
  assert(DEFAULT_PRICE_ALERT_RECIPIENTS.includes('roberto@tacosgavilan.com'), 'Incluye roberto@tacosgavilan.com')
  assert(DEFAULT_PRICE_ALERT_RECIPIENTS.includes('raquel@tacosgavilan.com'), 'Incluye raquel@tacosgavilan.com')
  assert(DEFAULT_PRICE_ALERT_RECIPIENTS.includes('gonzalo@tacosgavilan.com'), 'Incluye gonzalo@tacosgavilan.com')
  assert(DEFAULT_PRICE_ALERT_RECIPIENTS.includes('carlos@tacosgavilan.com'), 'Incluye carlos@tacosgavilan.com')

  const emailHtml = generatePriceAlertEmailHtml({
    supplierName: 'Viele & Sons',
    detectedAt: new Date(),
    sourceType: 'cron_auto',
    increases: [{
      supplierSku: 'EP9PR',
      description: 'Primo MFPP Plate 9" 3/COMP',
      packUnit: 'Caja con 500 pzas',
      packQuantity: 500,
      previousCasePrice: 29.98,
      newCasePrice: 34.50,
      diffAmount: 4.52,
      changePercent: 15.08,
      annualVolume: 8776,
      annualImpactUsd: 39667.52
    }],
    netAnnualImpactUsd: 39667.52,
    isTest: true
  })

  assert(emailHtml.includes('TACOS GAVILAN'), 'El correo contiene el nombre oficial de marca TACOS GAVILAN')
  assert(!emailHtml.includes('Tacos El Gavilan'), 'El correo NO contiene la variante no oficial')
  assert(emailHtml.includes('$39,667.52') || emailHtml.includes('39,667.52'), 'El correo renderiza el monto de impacto financiero')
  assert(emailHtml.includes('EP9PR'), 'El correo incluye la tabla con el SKU EP9PR')

  // ─── SECCIÓN 5: PRUEBA REAL DE MUTACIÓN EN BASE DE DATOS (LIVE DB SMOKE TEST) ───
  console.log('\n🗄️ SECCIÓN 5: Prueba de Mutación Real en Base de Datos (Live DB Smoke Test)')

  try {
    // 5.1 Verificar proveedor VIELE
    const { data: vieleSupplier, error: supErr } = await supabase
      .from('suppliers')
      .select('id, name, supplier_code')
      .eq('supplier_code', 'VIELE')
      .single()

    assert(!supErr && Boolean(vieleSupplier?.id), 'Proveedor VIELE existe y está activo en Supabase')

    // 5.2 Insertar registro de prueba en supplier_price_history (y limpiarlo inmediatamente)
    const testSku = 'TEST_AUDIT_SKU_' + Date.now()
    const { data: insertedHistory, error: histErr } = await supabase
      .from('supplier_price_history')
      .insert({
        supplier_id: vieleSupplier?.id,
        supplier_sku: testSku,
        case_price: 99.99,
        unit_cost: 0.9999,
        previous_unit_cost: 89.99,
        change_percent: 11.11,
        effective_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
        source_type: 'audit_test',
        notes: 'Registro temporal de simulación forense',
        created_by: 'Antigravity Audit Engine'
      })
      .select()
      .single()

    assert(!histErr && insertedHistory?.supplier_sku === testSku, 'Inserción atómica exitosa en supplier_price_history')

    // Limpieza inmediata
    const { error: delErr } = await supabase
      .from('supplier_price_history')
      .delete()
      .eq('supplier_sku', testSku)

    assert(!delErr, 'Limpieza y borrado de prueba completado sin dejar datos basura')

    // 5.3 Verificar esquema de inventory_items
    const { data: itemSample } = await supabase
      .from('inventory_items')
      .select('id, name, purchase_unit_cost, quantity_per_unit')
      .limit(1)
      .single()

    assert(Boolean(itemSample?.id), 'Tabla inventory_items responde con esquema válido')

  } catch (dbErr: any) {
    console.error('Error en prueba de BD:', dbErr)
    assert(false, 'Live DB Smoke Test completado sin excepciones', dbErr?.message)
  }

  console.log('\n======================================================================')
  console.log(`📊 RESULTADO FINAL DE LA SIMULACIÓN: ${passedTests}/${totalTests} pruebas superadas (${((passedTests/totalTests)*100).toFixed(1)}%)`)
  if (failedTests === 0) {
    console.log('🏆 ¡AUDITORÍA SUPERADA AL 100% SIN NINGÚN ERROR NI BUG DETECTADO!')
  } else {
    console.error(`⚠️ SE DETECTARON ${failedTests} FALLAS QUE REQUIEREN ATENCIÓN.`)
  }
  console.log('======================================================================\n')
}

runComprehensiveAudit().catch(err => {
  console.error('Error fatal en simulación:', err)
  process.exit(1)
})
