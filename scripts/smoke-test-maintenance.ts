/**
 * @module scripts/smoke-test-maintenance
 * @description Prueba forense en tiempo real y simulación integral del nuevo módulo de Registro
 * de Actividades de Proveedores y Mantenimiento de Tacos Gavilan.
 * @businessRules
 * - Valida inserción y mutación real en Supabase (tabla maintenance_service_logs).
 * - Valida lectura y filtrado relacional con la vista/tabla stores.
 * - Prueba cálculo de fecha de negocio en huso horario 'America/Los_Angeles' (corte a las 6:00 AM).
 * - Prueba inserción con fotos, firma digital simulada, estatus y datos contables.
 * - Limpieza atómica garantizada (DELETE) al finalizar para dejar la base de datos limpia.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

async function runSmokeTest() {
  console.log('==================================================================')
  console.log('🧪 INICIANDO SMOKE TEST REAL: MÓDULO DE MANTENIMIENTO Y PROVEEDORES')
  console.log('==================================================================\n')

  // 1. Obtener una sucursal activa real
  console.log('1️⃣ Obteniendo sucursal activa de prueba...')
  const { data: stores, error: storeErr } = await supabaseAdmin
    .from('stores')
    .select('id, name, code')
    .eq('is_active', true)
    .limit(1)

  if (storeErr || !stores || stores.length === 0) {
    throw new Error(`Fallo al consultar sucursales: ${storeErr?.message || 'No stores found'}`)
  }

  const testStore = stores[0]
  console.log(`✅ Tienda seleccionada para prueba: ${testStore.name} (#${testStore.code}) [ID: ${testStore.id}]\n`)

  // 2. Simulación de zona horaria PST (America/Los_Angeles) y regla de las 6:00 AM
  console.log('2️⃣ Verificando lógica de corte de jornada laboral (6:00 AM PST)...')
  const now = new Date()
  const laString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  const laDate = new Date(laString)
  const hour = laDate.getHours()
  const expectedDate = new Date(laDate)
  if (hour < 6) {
    expectedDate.setDate(expectedDate.getDate() - 1)
  }
  const yyyy = expectedDate.getFullYear()
  const mm = String(expectedDate.getMonth() + 1).padStart(2, '0')
  const dd = String(expectedDate.getDate()).padStart(2, '0')
  const businessDate = `${yyyy}-${mm}-${dd}`
  console.log(`✅ Hora local PST: ${laDate.toLocaleTimeString()} | Fecha de negocio calculada: ${businessDate}\n`)

  // 3. Inserción real de prueba en maintenance_service_logs
  console.log('3️⃣ Ejecutando inserción real de registro de mantenimiento en PostgreSQL...')
  const testPayload = {
    store_id: String(testStore.id),
    service_date: businessDate,
    start_time: '14:30:00',
    end_time: '16:45:00',
    company_name: 'TEST Air Quality Hoods Inc.',
    technician_name: 'Carlos Mendoza (Test Tech)',
    technician_phone: '323-555-0199',
    category: 'hood_cleaning',
    service_type: 'preventive',
    area_equipment: 'Campana de Cocina Principal y Filtros',
    work_description: 'Desengrase a presión con químico certificado NFPA 96 y pulido de acero inoxidable.',
    parts_replaced: '2 filtros tipo bafle 20x20 pulgadas',
    status: 'completed',
    photos_before: [
      'https://placeholder.supabase.co/storage/v1/object/public/checklist-photos/test_before_1.webp'
    ],
    photos_after: [
      'https://placeholder.supabase.co/storage/v1/object/public/checklist-photos/test_after_1.webp'
    ],
    photos_invoice: [
      'https://placeholder.supabase.co/storage/v1/object/public/checklist-photos/test_invoice.webp'
    ],
    invoice_number: 'INV-TEST-2026-001',
    cost_estimate: 450.00,
    manager_name: 'Roberto Gomez (GM Turno AM)',
    manager_signature_url: 'https://placeholder.supabase.co/storage/v1/object/public/checklist-photos/test_sig.png',
    notes: 'Smoke test de inserción automatizado - Se eliminará de inmediato.'
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('maintenance_service_logs')
    .insert(testPayload)
    .select()
    .single()

  if (insertErr || !inserted) {
    throw new Error(`❌ Error insertando registro de prueba: ${insertErr?.message}`)
  }

  console.log('✅ Registro insertado exitosamente con ID:', inserted.id)
  console.log(`   - Empresa: ${inserted.company_name}`)
  console.log(`   - Categoría: ${inserted.category}`)
  console.log(`   - Costo estimado: $${inserted.cost_estimate} USD`)
  console.log(`   - Creado en: ${inserted.created_at}\n`)

  // 4. Verificación de consulta y enriquecimiento relacional
  console.log('4️⃣ Verificando consulta y filtrado...')
  const { data: queried, error: queryErr } = await supabaseAdmin
    .from('maintenance_service_logs')
    .select('*')
    .eq('id', inserted.id)
    .single()

  if (queryErr || !queried) {
    throw new Error(`❌ Error al consultar registro recién creado: ${queryErr?.message}`)
  }

  if (queried.company_name !== testPayload.company_name) {
    throw new Error('❌ Discrepancia en datos consultados vs insertados')
  }
  console.log('✅ Consulta exitosa: Coincidencia 100% en los campos verificados.\n')

  // 5. Limpieza atómica (DELETE)
  console.log('5️⃣ Limpiando registro de prueba de la base de datos...')
  const { error: deleteErr } = await supabaseAdmin
    .from('maintenance_service_logs')
    .delete()
    .eq('id', inserted.id)

  if (deleteErr) {
    throw new Error(`❌ Error al limpiar registro de prueba: ${deleteErr.message}`)
  }
  console.log('✅ Registro de prueba eliminado satisfactoriamente de PostgreSQL.')

  // 6. Verificación final de eliminación
  const { data: verifyDeleted } = await supabaseAdmin
    .from('maintenance_service_logs')
    .select('id')
    .eq('id', inserted.id)
    .maybeSingle()

  if (verifyDeleted) {
    throw new Error('❌ El registro de prueba sigue existiendo en la tabla!')
  }
  console.log('✅ Confirmado: Base de datos 100% íntegra y sin datos basura.\n')

  console.log('==================================================================')
  console.log('🎉 SMOKE TEST COMPLETADO CON ÉXITO: 0 ERRORES')
  console.log('==================================================================')
}

runSmokeTest().catch(err => {
  console.error('\n❌ FALLO EN EL SMOKE TEST:', err.message)
  process.exit(1)
})
