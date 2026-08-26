/**
 * @module scripts/sync-all-stores-ronos
 * @description Sincronizador integral de nómina, horas trabajadas y PTO (Vacaciones / Sick Pay)
 *   para las 15 sucursales de Tacos Gavilan y el Almacén Central (Bodega) en Supabase.
 *   - Extrae horas regulares, horas extras (OT/DT), penalizaciones de comida (Meal Penalties).
 *   - Extrae horas de enfermedad (Sick Pay), vacaciones (Vacation) y feriados (Holiday).
 *   - Persiste permanentemente en `ronos_work_weeks` y `ronos_employee_timecards_cache`.
 */

import { supabaseAdmin } from '../lib/supabase'
import { callRonosApi, getRonosAuthToken, getRonosWeeks, RONOS_STORES_MAP } from '../lib/ronos-api'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function syncAllStoresRonos(weeksToSync = 2) {
  console.log('======================================================================')
  console.log('      SINCRONIZACIÓN DE TODAS LAS SUCURSALES EN SUPABASE (RONOS PTO)   ')
  console.log('======================================================================\n')

  await getRonosAuthToken(true) // Forzar token fresco

  let totalStoresProcessed = 0
  let totalCardsSaved = 0
  const startTime = Date.now()

  for (const store of RONOS_STORES_MAP) {
    console.log(`\n🏪 [${store.tegCode}] ${store.tegName} (RONOS Company ID: ${store.ronosCompanyId})`)
    
    try {
      const weeks = await getRonosWeeks(store.ronosCompanyId)
      if (!weeks || weeks.length === 0) {
        console.log(`  ⚠️ No se encontraron semanas para ${store.tegName}`)
        continue
      }

      // Tomar las N semanas más recientes
      const targetWeeks = weeks.slice(0, weeksToSync)
      console.log(`  📅 Semanas a sincronizar: ${targetWeeks.map(w => w.weekId).join(', ')}`)

      // Guardar semanas en ronos_work_weeks
      const weeksRows = targetWeeks.map(w => ({
        week_id: w.weekId,
        company_id: store.ronosCompanyId,
        start_date: w.startDate,
        end_date: w.endDate,
        updated_at: new Date().toISOString()
      }))

      await supabaseAdmin
        .from('ronos_work_weeks')
        .upsert(weeksRows, { onConflict: 'company_id,week_id' })

      for (const week of targetWeeks) {
        const weekRes = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
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

        const employees: any[] = weekRes?.results || []
        const validEmployees = employees.filter(emp => {
          const uId = Number(emp.employeeUserId || emp.userId)
          const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim()
          return uId > 0 && !name.toLowerCase().includes('manager default')
        })

        const CHUNK_SIZE = 8
        const timecardRows: any[] = []

        for (let i = 0; i < validEmployees.length; i += CHUNK_SIZE) {
          const chunk = validEmployees.slice(i, i + CHUNK_SIZE)
          const chunkResults = await Promise.all(
            chunk.map(async (emp) => {
              const uId = Number(emp.employeeUserId || emp.userId)
              const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim()

              let sickHrs = 0
              let vacHrs = 0
              let holHrs = 0

              try {
                const userWeek = await callRonosApi<any>('WorkWeek/ManagerGetUserWeekByWeekId', {
                  companyId: store.ronosCompanyId,
                  weekId: week.weekId,
                  userId: uId
                })

                if (userWeek?.workDays && Array.isArray(userWeek.workDays)) {
                  userWeek.workDays.forEach((d: any) => {
                    sickHrs += Number(d.sickHours || 0)
                    vacHrs += Number(d.vacationHours || 0)
                    holHrs += Number(d.holidayHours || 0)
                  })
                }
              } catch (err) {
                // Continuar con los datos disponibles si falla el detalle individual
              }

              const regHrs = Number(emp.totalWeeklyRegHours ?? emp.regularHours ?? 0)
              const otHrs = Number(emp.totalWeeklyOverTime ?? emp.overtimeHours ?? 0)
              const dtHrs = Number(emp.totalWeeklyDoubleTime ?? emp.doubleTimeHours ?? 0)
              const totHrs = Number(emp.totalWeeklyHour ?? emp.totalHours ?? 0)

              return {
                company_id: store.ronosCompanyId,
                week_id: week.weekId,
                employee_user_id: uId,
                employee_id: emp.employeeId ? Number(emp.employeeId) : null,
                full_name: name,
                first_name: emp.firstName || '',
                last_name: emp.lastName || '',
                pin: String(emp.pin || ''),
                job_title: emp.jobTitle || emp.departmentName || '',
                regular_hours: regHrs,
                overtime_hours: otHrs,
                double_time_hours: dtHrs,
                total_weekly_hours: totHrs,
                meal_penalty_count: Number(emp.mealPenalty || 0),
                sick_hours: sickHrs,
                vacation_hours: vacHrs,
                holiday_hours: holHrs,
                broken_hours: Boolean(emp.brokenHours),
                active: totHrs > 0 || vacHrs > 0 || sickHrs > 0,
                updated_at: new Date().toISOString()
              }
            })
          )

          timecardRows.push(...chunkResults)
          await sleep(50) // Pausa de 50ms entre chunks
        }

        if (timecardRows.length > 0) {
          const { error: upsertErr } = await supabaseAdmin
            .from('ronos_employee_timecards_cache')
            .upsert(timecardRows, { onConflict: 'company_id,week_id,employee_user_id' })

          if (upsertErr) {
            console.error(`  ❌ Error guardando tarjetas para ${store.tegName} (Semana ${week.weekId}):`, upsertErr.message)
          } else {
            totalCardsSaved += timecardRows.length
            console.log(`  ✅ Semana ${week.weekId}: ${timecardRows.length} tarjetas guardadas en Supabase (PTO extraído)`)
          }
        }
      }

      totalStoresProcessed++
    } catch (storeErr: any) {
      console.error(`  ❌ Error procesando ${store.tegName}:`, storeErr?.message)
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n======================================================================')
  console.log(`🎉 SINCRONIZACIÓN COMPLETA: ${totalStoresProcessed} tiendas, ${totalCardsSaved} tarjetas en Supabase en ${elapsedSec}s`)
  console.log('======================================================================')
}

// Ejecutar si se corre directamente
if (require.main === module) {
  syncAllStoresRonos(2).catch(console.error)
}
