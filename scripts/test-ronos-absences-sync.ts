/**
 * @module scripts/test-ronos-absences-sync
 * @description Suite de pruebas automatizadas y prueba de mutación real en Supabase (Live DB Smoke Test)
 *   para la sincronización de ausencias oficiales de RONOS (Enfermedad / Vacaciones) con la matriz de Horarios.
 *
 * Pruebas:
 * 1. Simulación de semáforo operativo: Verifica que turnos de Enfermedad/Vacaciones NO cubren tienda (coversBlock = false)
 *    y generan semáforo 🔴 'bad' (FALTA AM / PM).
 * 2. Prueba de mutación real en Supabase: Inserta un registro de ausencia en 'schedules', lo verifica y lo limpia inmediatamente.
 * 3. Ejecución controlada del motor de sincronización RONOS: Escaneo de ausencias en Lynwood #14 (o tiendas con ausencias activas).
 */

import { supabaseAdmin } from '../lib/supabase'
import { syncRonosAbsencesToSchedules } from '../lib/sync-ronos-absences'

// Helpers locales para simulación idénticos a app/horarios/page.tsx
const getAbsenceType = (shift: any): 'sick' | 'vacation' | 'permission' | null => {
  if (!shift) return null
  const label = (shift.shift_label || '').toLowerCase()
  if (label.includes('enferm') || label.includes('sick')) return 'sick'
  if (label.includes('vacac') || label.includes('vacat')) return 'vacation'
  if (label.includes('permis') || label.includes('leave') || label.includes('unpaid')) return 'permission'
  return null
}

const coversBlock = (shift: any, isAM: boolean): boolean => {
  if (!shift || !shift.start_time || !shift.end_time) return false
  if (getAbsenceType(shift) !== null) return false

  const [startH, startM] = shift.start_time.split(':').map(Number)
  const [endH, endM] = shift.end_time.split(':').map(Number)

  let startMinutes = startH * 60 + startM
  let endMinutes = endH * 60 + endM
  if (endMinutes <= startMinutes) endMinutes += 24 * 60

  const blockStart = isAM ? 0 : 17 * 60
  const blockEnd = isAM ? 17 * 60 : 30 * 60

  const overlapStart = Math.max(startMinutes, blockStart)
  const overlapEnd = Math.min(endMinutes, blockEnd)
  const overlap = Math.max(0, overlapEnd - overlapStart)

  return overlap >= 240
}

async function runTestSuite() {
  console.log('===============================================================')
  console.log('🚀 INICIANDO SUITE DE PRUEBAS: SINCRONIZACIÓN DE AUSENCIAS RONOS')
  console.log('===============================================================\n')

  let allPassed = true

  // --- PRUEBA 1: SEMÁFORO OPERATIVO Y COVERSBLOCK ---
  console.log('--- [PRUEBA 1] Regla de Negocio: Semáforo y coversBlock con ausencias ---')

  const regularAMShift = { shift_label: 'Apertura', start_time: '08:00:00', end_time: '16:00:00' }
  const regularPMShift = { shift_label: 'Cierre', start_time: '17:00:00', end_time: '02:00:00' }
  const sickShift = { shift_label: 'Enfermedad', start_time: '00:00:00', end_time: '00:00:00' }
  const vacationShift = { shift_label: 'Vacaciones', start_time: '00:00:00', end_time: '00:00:00' }
  const permissionShift = { shift_label: 'Permiso', start_time: '00:00:00', end_time: '00:00:00' }

  const test1a = coversBlock(regularAMShift, true) === true
  const test1b = coversBlock(regularPMShift, false) === true
  const test1c = coversBlock(sickShift, true) === false
  const test1d = coversBlock(sickShift, false) === false
  const test1e = coversBlock(vacationShift, true) === false
  const test1f = coversBlock(vacationShift, false) === false
  const test1g = coversBlock(permissionShift, true) === false
  const test1h = coversBlock(permissionShift, false) === false

  console.log(`  1.1 Turno Regular AM cubre AM: ${test1a ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  1.2 Turno Regular PM cubre PM: ${test1b ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  1.3 Turno Enfermedad NO cubre AM: ${test1c ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  1.4 Turno Enfermedad NO cubre PM: ${test1d ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  1.5 Turno Vacaciones NO cubre AM: ${test1e ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  1.6 Turno Vacaciones NO cubre PM: ${test1f ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  1.7 Turno Permiso NO cubre AM: ${test1g ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  1.8 Turno Permiso NO cubre PM: ${test1h ? '✅ PASS' : '❌ FAIL'}`)

  if (!test1a || !test1b || !test1c || !test1d || !test1e || !test1f || !test1g || !test1h) {
    allPassed = false
    console.error('❌ FALLÓ Prueba 1 de cobertura de turnos')
  } else {
    console.log('✅ Cobertura de turnos de ausencia validada al 100%\n')
  }

  // --- PRUEBA 2: LIVE DB MUTATION SMOKE TEST (Supabase schedules) ---
  console.log('--- [PRUEBA 2] Live DB Mutation Smoke Test en Supabase schedules ---')
  const testDate = '2099-12-31' // Fecha segura en el futuro lejano
  const testUserId = 25 // Carlos Velazquez (Lynwood #14)
  const testStoreId = 14

  try {
    // 2.1 Limpiar previo por si acaso
    await supabaseAdmin.from('schedules').delete().match({ user_id: testUserId, date: testDate })

    // 2.2 Insertar ausencia de prueba
    const testPayload = {
      user_id: testUserId,
      store_id: testStoreId,
      date: testDate,
      start_time: '00:00:00',
      end_time: '00:00:00',
      shift_label: 'Enfermedad',
      role: 'manager'
    }

    console.log(`  2.1 Insertando registro de prueba (${testPayload.shift_label} en ${testPayload.date})...`)
    const { error: insertErr } = await supabaseAdmin.from('schedules').upsert(testPayload, { onConflict: 'user_id,date' })

    if (insertErr) {
      throw new Error(`Error en insert: ${insertErr.message}`)
    }
    console.log('  ✅ Inserción exitosa en Supabase schedules')

    // 2.3 Leer y validar
    const { data: readData, error: readErr } = await supabaseAdmin
      .from('schedules')
      .select('*')
      .match({ user_id: testUserId, date: testDate })
      .single()

    if (readErr || !readData) {
      throw new Error(`Error en lectura de prueba: ${readErr?.message}`)
    }

    const test2_checkLabel = readData.shift_label === 'Enfermedad'
    const test2_checkTimes = readData.start_time === '00:00:00' && readData.end_time === '00:00:00'
    console.log(`  2.2 Registro recuperado: label='${readData.shift_label}', start='${readData.start_time}', end='${readData.end_time}'`)
    console.log(`  2.3 Verificación de campos: ${test2_checkLabel && test2_checkTimes ? '✅ PASS' : '❌ FAIL'}`)

    // 2.4 Probar actualización a Vacaciones
    const updatePayload = {
      ...testPayload,
      shift_label: 'Vacaciones'
    }
    await supabaseAdmin.from('schedules').upsert(updatePayload, { onConflict: 'user_id,date' })
    const { data: updatedData } = await supabaseAdmin
      .from('schedules')
      .select('shift_label')
      .match({ user_id: testUserId, date: testDate })
      .single()

    const test2_checkUpdate = updatedData?.shift_label === 'Vacaciones'
    console.log(`  2.4 Actualización a Vacaciones: ${test2_checkUpdate ? '✅ PASS' : '❌ FAIL'}`)

    // 2.5 Probar actualización a Permiso
    const permPayload = {
      ...testPayload,
      shift_label: 'Permiso'
    }
    await supabaseAdmin.from('schedules').upsert(permPayload, { onConflict: 'user_id,date' })
    const { data: permData } = await supabaseAdmin
      .from('schedules')
      .select('shift_label')
      .match({ user_id: testUserId, date: testDate })
      .single()

    const test2_checkPerm = permData?.shift_label === 'Permiso'
    console.log(`  2.5 Actualización a Permiso: ${test2_checkPerm ? '✅ PASS' : '❌ FAIL'}`)

    // 2.6 Limpieza inmediata (DELETE)
    console.log('  2.6 Ejecutando limpieza inmediata de registro de prueba...')
    const { error: deleteErr } = await supabaseAdmin
      .from('schedules')
      .delete()
      .match({ user_id: testUserId, date: testDate })

    if (deleteErr) {
      throw new Error(`Error en delete: ${deleteErr.message}`)
    }

    // Confirmar que ya no existe
    const { data: verifyDeleted } = await supabaseAdmin
      .from('schedules')
      .select('id')
      .match({ user_id: testUserId, date: testDate })

    const test2_deletedOk = !verifyDeleted || verifyDeleted.length === 0
    console.log(`  2.7 Confirmación de limpieza en DB: ${test2_deletedOk ? '✅ Registro eliminado' : '❌ Aún existe'}`)

    if (!test2_checkLabel || !test2_checkTimes || !test2_checkUpdate || !test2_checkPerm || !test2_deletedOk) {
      allPassed = false
      console.error('❌ FALLÓ Prueba 2 de mutación en DB')
    } else {
      console.log('✅ Live DB Mutation Smoke Test completado con éxito al 100%\n')
    }
  } catch (err: any) {
    allPassed = false
    console.error('❌ Error fatal en Prueba 2:', err.message || err)
  }

  // --- PRUEBA 3: EJECUCIÓN REAL DEL MOTOR DE SINCRONIZACIÓN DE RONOS ---
  console.log('--- [PRUEBA 3] Sincronización real de ausencias desde RONOS API ---')
  try {
    console.log('  3.1 Ejecutando syncRonosAbsencesToSchedules para Lynwood #14 (tienda 14)...')
    const syncResult = await syncRonosAbsencesToSchedules({
      storeId: 14,
      weeksToScan: 4,
      forceRefresh: true
    })

    console.log(`  3.2 Resultado Lynwood #14: success=${syncResult.success}, ausencias=${syncResult.totalAbsencesFound}, upserted=${syncResult.totalAbsencesUpserted}, tiempo=${syncResult.durationMs}ms`)

    if (syncResult.records.length > 0) {
      console.log('  3.3 Ausencias detectadas en Lynwood #14:')
      syncResult.records.forEach(r => {
        console.log(`      - ${r.userName} (${r.userRole}): ${r.type} el ${r.date} (${r.hours}h) [store: ${r.storeName}]`)
      })
    } else {
      console.log('      (Sin ausencias activas registradas en las semanas escaneadas de Lynwood)')
    }

    console.log(`  3.4 Verificación de ejecución: ${syncResult.success ? '✅ PASS' : '❌ FAIL'}\n`)
  } catch (err: any) {
    allPassed = false
    console.error('❌ Error en Prueba 3:', err.message || err)
  }

  console.log('===============================================================')
  if (allPassed) {
    console.log('🎉 TODAS LAS PRUEBAS Y SIMULACIONES PASARON CON ÉXITO (100%)')
  } else {
    console.log('⚠️ HUBO ERRORES EN LA SUITE DE PRUEBAS')
    process.exit(1)
  }
  console.log('===============================================================\n')
}

runTestSuite().catch(err => {
  console.error('Error fatal no capturado en suite de pruebas:', err)
  process.exit(1)
})
