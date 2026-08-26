/**
 * @module scripts/backfill-ronos-all-stores
 * @description Sincronizador y Backfill Histórico Completo de RONOS (2022 - Presente) a Supabase.
 *   - Descarga todas las semanas laborales (WorkWeeks) de las 16 sucursales / compañías.
 *   - Descarga todas las tarjetas de tiempo semanales (Timecards), horas regulares, OT, DT, PINs y penalizaciones.
 *   - Almacena permanentemente en `ronos_work_weeks` y `ronos_employee_timecards_cache`.
 *   - Detecta traslados históricos cross-store basándose en ponchadas reales y los persiste en `ronos_transfers_history`.
 *
 * @businessRules
 *   - Abarca desde enero de 2022 hasta la semana vigente (~240 semanas por tienda).
 *   - Almacenamiento permanente en PostgreSQL Supabase para consultas instantáneas (< 50ms) en la UI.
 */

import { supabaseAdmin } from '../lib/supabase'
import { callRonosApi, getRonosWeeks, RONOS_STORES_MAP } from '../lib/ronos-api'

const BATCH_SIZE = 12 // Semanas procesadas concurrentemente por tienda

async function backfillSingleStore(store: { tegStoreId: number; tegName: string; ronosCompanyId: number }) {
  console.log(`\n======================================================================`)
  console.log(`🏪 Sincronizando: ${store.tegName} (Company ID: ${store.ronosCompanyId})`)
  console.log(`======================================================================`)

  const weeks = await getRonosWeeks(store.ronosCompanyId)
  if (!weeks || weeks.length === 0) {
    console.log(`⚠️ No se encontraron semanas para ${store.tegName}`)
    return { storeName: store.tegName, weeksCount: 0, timecardsCount: 0 }
  }

  console.log(`📅 Semanas encontradas en RONOS (2022-Presente): ${weeks.length}`)

  // 1. Guardar semanas en ronos_work_weeks
  const weeksToInsert = weeks.map(w => ({
    week_id: w.weekId,
    company_id: store.ronosCompanyId,
    start_date: w.startDate,
    end_date: w.endDate,
    updated_at: new Date().toISOString()
  }))

  const { error: wErr } = await supabaseAdmin
    .from('ronos_work_weeks')
    .upsert(weeksToInsert, { onConflict: 'company_id,week_id' })

  if (wErr) {
    console.error(`❌ Error guardando semanas para ${store.tegName}:`, wErr.message)
    return { storeName: store.tegName, weeksCount: 0, timecardsCount: 0 }
  }

  // 2. Descargar e insertar tarjetas de tiempo en lotes
  let totalTimecards = 0
  const startTime = Date.now()

  for (let i = 0; i < weeks.length; i += BATCH_SIZE) {
    const batch = weeks.slice(i, i + BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map(async (week) => {
        const weekData = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
          searchTerm: null,
          companyId: store.ronosCompanyId,
          weekId: week.weekId,
          departmentId: 0,
          pageNumber: 0,
          pageSize: 100,
          sort: 'FirstName',
          showInactive: 0,
          payType: 0,
          internalSalariedRules: false
        })

        const rawEmployees: any[] = weekData?.results || []
        return rawEmployees.map(emp => {
          const uId = Number(emp.employeeUserId || emp.userId)
          const fName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim()
          return {
            company_id: store.ronosCompanyId,
            week_id: week.weekId,
            employee_user_id: uId,
            employee_id: Number(emp.employeeId || 0),
            first_name: emp.firstName || '',
            last_name: emp.lastName || '',
            full_name: fName,
            pin: String(emp.pin || ''),
            total_weekly_hours: Number(emp.totalWeeklyHour || 0),
            regular_hours: Number(emp.totalWeeklyRegHours || 0),
            overtime_hours: Number(emp.totalWeeklyOverTime || 0),
            double_time_hours: Number(emp.totalWeeklyDoubleTime || 0),
            meal_penalty_count: Number(emp.mealPenalty || 0),
            broken_hours: Boolean(emp.brokenHours),
            active: emp.active !== false,
            updated_at: new Date().toISOString()
          }
        })
      })
    )

    const allTimecardsInBatch: any[] = []
    results.forEach(r => {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        allTimecardsInBatch.push(...r.value)
      }
    })

    if (allTimecardsInBatch.length > 0) {
      const { error: tErr } = await supabaseAdmin
        .from('ronos_employee_timecards_cache')
        .upsert(allTimecardsInBatch, { onConflict: 'company_id,week_id,employee_user_id' })

      if (tErr) {
        console.error(`❌ Error en batch ${i} (${store.tegName}):`, tErr.message)
      } else {
        totalTimecards += allTimecardsInBatch.length
      }
    }

    const progress = Math.min(100, Math.round(((i + batch.length) / weeks.length) * 100))
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1)
    process.stdout.write(`\r⏳ ${store.tegName}: ${progress}% (${Math.min(i + batch.length, weeks.length)}/${weeks.length} sem) | ${totalTimecards} timecards | ${elapsedSec}s`)
  }

  console.log(`\n✅ ${store.tegName} completado: ${totalTimecards} registros guardados en ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
  return { storeName: store.tegName, weeksCount: weeks.length, timecardsCount: totalTimecards }
}

async function computeHistoricalTransfers() {
  console.log(`\n======================================================================`)
  console.log(`🔄 Calculando Historial de Traslados Cross-Store en Supabase...`)
  console.log(`======================================================================`)

  // Query all active timecards across all stores
  const { data: activeCards, error } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('company_id, week_id, employee_user_id, full_name, total_weekly_hours')
    .gt('total_weekly_hours', 0)

  if (error || !activeCards) {
    console.error('Error fetching active timecards for transfers calculation:', error?.message)
    return
  }

  console.log(`📊 Analizando ${activeCards.length} tarjetas con horas trabajadas...`)

  // Group by employee_user_id
  const empStoresMap = new Map<number, { name: string; stores: Set<number>; storeHours: Map<number, number> }>()

  activeCards.forEach(tc => {
    const uId = tc.employee_user_id
    if (!uId || uId <= 0) return

    let emp = empStoresMap.get(uId)
    if (!emp) {
      emp = { name: tc.full_name, stores: new Set(), storeHours: new Map() }
      empStoresMap.set(uId, emp)
    }

    emp.stores.add(tc.company_id)
    emp.storeHours.set(tc.company_id, (emp.storeHours.get(tc.company_id) || 0) + Number(tc.total_weekly_hours))
  })

  // Detect employees who worked in 2+ stores (excluding corporate >= 5 stores)
  const multiStoreEmployees = Array.from(empStoresMap.entries()).filter(
    ([_, emp]) => emp.stores.size >= 2 && emp.stores.size < 5
  )

  console.log(`🎯 Empleados con historial multi-sucursal detectados: ${multiStoreEmployees.length}`)

  const storeByCompany = new Map<number, string>()
  RONOS_STORES_MAP.forEach(s => storeByCompany.set(s.ronosCompanyId, s.tegName))

  let insertedTransfers = 0
  const transfersToInsert: any[] = []

  for (const [uId, emp] of multiStoreEmployees) {
    const storesArray = Array.from(emp.stores)
    for (let s1 of storesArray) {
      for (let s2 of storesArray) {
        if (s1 !== s2) {
          transfersToInsert.push({
            source_company_id: s1,
            employee_user_id: uId,
            employee_name: emp.name,
            target_company_id: s2,
            target_store_name: storeByCompany.get(s2) || `Company ${s2}`,
            status: 'confirmed',
            detected_at: new Date().toISOString()
          })
        }
      }
    }
  }

  if (transfersToInsert.length > 0) {
    const { error: trErr } = await supabaseAdmin
      .from('ronos_transfers_history')
      .upsert(transfersToInsert, { onConflict: 'source_company_id,employee_user_id,target_company_id' })

    if (trErr) {
      console.error('❌ Error guardando historial de traslados:', trErr.message)
    } else {
      insertedTransfers = transfersToInsert.length
      console.log(`✅ ${insertedTransfers} registros de traslados históricos guardados en ronos_transfers_history`)
    }
  }
}

async function main() {
  const globalStart = Date.now()
  console.log(`🌟 ======================================================================`)
  console.log(`🌟 BACKFILL HISTÓRICO COMPLETO DE RONOS (2022 - 2026) -> SUPABASE`)
  console.log(`🌟 ======================================================================`)

  const stores = RONOS_STORES_MAP.filter(s => !s.isBodega) // Las 15 sucursales
  const resultsSummary = []

  for (const store of stores) {
    const res = await backfillSingleStore(store)
    resultsSummary.push(res)
  }

  // Bodega
  const bodega = RONOS_STORES_MAP.find(s => s.isBodega)
  if (bodega) {
    const res = await backfillSingleStore(bodega)
    resultsSummary.push(res)
  }

  await computeHistoricalTransfers()

  const totalTimecards = resultsSummary.reduce((acc, r) => acc + (r?.timecardsCount || 0), 0)
  const totalWeeks = resultsSummary.reduce((acc, r) => acc + (r?.weeksCount || 0), 0)
  const totalElapsedMinutes = ((Date.now() - globalStart) / 1000 / 60).toFixed(2)

  console.log(`\n======================================================================`)
  console.log(`🏆 RESUMEN GENERAL DEL BACKFILL (2022 - 2026):`)
  console.log(`   - Total Semanas Guardadas: ${totalWeeks}`)
  console.log(`   - Total Tarjetas de Tiempo Guardadas: ${totalTimecards}`)
  console.log(`   - Tiempo Total de Ejecución: ${totalElapsedMinutes} minutos`)
  console.log(`======================================================================\n`)
}

main().catch(console.error)
