/**
 * @module lib/sync-ronos-absences
 * @description Motor universal de sincronización de ausencias oficiales (Enfermedad / Vacaciones / Permisos) desde RONOS (Cingular HR)
 *   hacia la matriz operativa de Horarios (tabla 'schedules' en Supabase).
 *   - Rastrea automáticamente los 15 restaurantes de Tacos Gavilan.
 *   - Extrae solicitudes aprobadas de PTO (Vacaciones / Vacation), días por enfermedad (Sick Leave) y permisos/licencias (Leave / Unpaid) de RONOS.
 *   - Vincula de forma relacional con los colaboradores de supervisión y liderazgo (Managers, Asistentes y Supervisores).
 *   - Realiza un upsert seguro en 'schedules' con shift_label = 'Enfermedad' | 'Vacaciones' | 'Permiso' y horario '00:00' - '00:00'.
 *
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y termina a las 5:59 AM del siguiente día. El turno PM inicia a las 5:00 PM.
 *   - Los turnos de ausencia (Enfermedad, Vacaciones o Permiso) NUNCA cubren los bloques operativos de la tienda (coversBlock = false).
 *   - Si un empleado ya tenía un horario tentativo asignado en 'schedules', la ausencia oficial de RONOS lo sobreescribe
 *     para alertar de inmediato a los supervisores de que la tienda está descubierta.
 *
 * @dataFlow
 *   RONOS API (WorkWeek/AdminGetWeekByWeekId + ManagerGetUserWeekByWeekId) -> Detección de PTO/Sick/Vacation/UnpaidLeave ->
 *   Cruce con 'users' (roles: manager, asistente, supervisor) -> Supabase 'schedules' -> UI /horarios.
 *
 * @notes
 *   - Diseñado para ejecutarse tanto vía cron job diario (/api/cron/sync-ronos-absences) como bajo demanda desde la UI.
 *   - Utiliza normalización estricta de cadenas (NFD sin acentos) y mapeo por toast_guid para máxima precisión.
 */

import { supabaseAdmin } from './supabase'
import { callRonosApi, getRonosWeeks, RONOS_STORES_MAP } from './ronos-api'

export interface SyncedAbsenceRecord {
  userId: number
  userName: string
  userRole: string
  storeId: number
  storeName: string
  date: string
  type: 'Enfermedad' | 'Vacaciones' | 'Permiso'
  hours: number
  ronosEmployeeUserId: number
}

export interface SyncRonosAbsencesResult {
  success: boolean
  totalScannedStores: number
  totalAbsencesFound: number
  totalAbsencesUpserted: number
  records: SyncedAbsenceRecord[]
  errors?: string[]
  durationMs: number
}

/**
 * Normaliza nombres eliminando acentos, caracteres especiales y mayúsculas
 */
export interface SyncRonosAbsencesOptions {
  storeId?: number
  weeksToScan?: number // Default: 4 (cubre hasta 4 semanas recientes / ~1 mes)
  startDate?: string   // Filtro opcional por rango de fechas (YYYY-MM-DD)
  endDate?: string     // Filtro opcional por rango de fechas (YYYY-MM-DD)
  forceRefresh?: boolean
}

/**
 * Normaliza nombres eliminando acentos, caracteres especiales y mayúsculas
 */
function normalizeText(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

/**
 * Sincroniza días de enfermedad, vacaciones y permisos desde RONOS hacia la tabla 'schedules'
 */
export async function syncRonosAbsencesToSchedules(options?: SyncRonosAbsencesOptions): Promise<SyncRonosAbsencesResult> {
  const startTime = Date.now()
  const weeksToScan = options?.weeksToScan || 4
  const errors: string[] = []
  const syncedRecords: SyncedAbsenceRecord[] = []

  try {
    // 1. Cargar usuarios activos de liderazgo (Managers, Asistentes, Supervisores)
    const { data: dbUsers, error: errUsers } = await supabaseAdmin
      .from('users')
      .select('id, full_name, role, store_id, toast_guid')
      .in('role', ['manager', 'gerente', 'asistente', 'assistant_manager', 'supervisor'])
      .eq('is_active', true)

    if (errUsers || !dbUsers) {
      throw new Error(`Error al consultar usuarios en Supabase: ${errUsers?.message || 'Sin datos'}`)
    }

    // 2. Filtrar tiendas a escanear
    const targetStores = options?.storeId
      ? RONOS_STORES_MAP.filter(s => s.tegStoreId === options.storeId && !s.isBodega)
      : RONOS_STORES_MAP.filter(s => !s.isBodega)

    // 3. Procesar tiendas
    for (const store of targetStores) {
      try {
        const weeks = await getRonosWeeks(store.ronosCompanyId, options?.forceRefresh)
        if (!weeks || weeks.length === 0) continue

        let weeksToProcess: typeof weeks = []

        // Si se especificó rango de fechas (ej. la quincena visualizada en pantalla), buscar semanas que intersecten
        if (options?.startDate && options?.endDate) {
          const reqStart = options.startDate.substring(0, 10)
          const reqEnd = options.endDate.substring(0, 10)
          weeksToProcess = weeks.filter(w => {
            const wStart = (w.startDate || '').substring(0, 10)
            const wEnd = (w.endDate || '').substring(0, 10)
            if (!wStart || !wEnd) return false
            return wStart <= reqEnd && wEnd >= reqStart
          })
        }

        // Si no se proporcionó rango o no hubo intersección, tomar las semanas indicadas por weeksToScan (mínimo 4)
        if (weeksToProcess.length === 0) {
          weeksToProcess = weeks.slice(0, weeksToScan)
        }

        for (const week of weeksToProcess) {
          const rawWeek = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
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

          const employees: any[] = Array.isArray(rawWeek)
            ? rawWeek
            : (rawWeek?.results || rawWeek?.employees || [])

          for (const emp of employees) {
            const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim()
            const normEmpName = normalizeText(empName)
            const empUserId = Number(emp.employeeUserId || emp.userId)

            // Buscar si coincide con algún usuario de liderazgo de esta tienda o un supervisor
            const matchedUser = dbUsers.find(u => {
              const normU = normalizeText(u.full_name)
              const isSameStore = Number(u.store_id) === Number(store.tegStoreId) || u.role === 'supervisor'
              if (!isSameStore) return false

              return normU === normEmpName ||
                (normU.length > 5 && normEmpName.includes(normU)) ||
                (normEmpName.length > 5 && normU.includes(normEmpName))
            })

            if (!matchedUser) continue

            // Obtener el desglose diario del empleado desde RONOS
            try {
              const userWeek = await callRonosApi<any>('WorkWeek/ManagerGetUserWeekByWeekId', {
                userId: empUserId,
                weekId: week.weekId
              })

              const workDays: any[] = Array.isArray(userWeek?.workDays) ? userWeek.workDays : []

              for (const wd of workDays) {
                const isSick = Boolean(wd.sick || (wd.sickHours && wd.sickHours > 0))
                const isVacation = Boolean(wd.vacation || (wd.vacationHours && wd.vacationHours > 0))
                const isPermission = Boolean(
                  wd.unpaidLeave ||
                  (wd.unpaidtimeHours && wd.unpaidtimeHours > 0) ||
                  wd.bereavement ||
                  (wd.bereavementHours && wd.bereavementHours > 0) ||
                  (Array.isArray(wd.workDayPTO) && wd.workDayPTO.some((p: any) => p && p.type && p.type !== 1 && p.type !== 2 && p.approval !== false))
                )

                if (isSick || isVacation || isPermission) {
                  const rawDate = wd.startTime || wd.date || wd.workDayPTO?.[0]?.dateStart || ''
                  const dateStr = String(rawDate).substring(0, 10)

                  // Validar formato YYYY-MM-DD
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue

                  const absenceType: 'Enfermedad' | 'Vacaciones' | 'Permiso' = isSick
                    ? 'Enfermedad'
                    : (isVacation ? 'Vacaciones' : 'Permiso')
                  const absenceHours = isSick
                    ? Number(wd.sickHours || 8)
                    : (isVacation ? Number(wd.vacationHours || 8) : Number(wd.unpaidtimeHours || wd.bereavementHours || 8))

                  // Tienda correspondiente para el turno
                  const targetStoreId = matchedUser.store_id || store.tegStoreId

                  syncedRecords.push({
                    userId: matchedUser.id,
                    userName: matchedUser.full_name,
                    userRole: matchedUser.role,
                    storeId: targetStoreId,
                    storeName: store.tegName,
                    date: dateStr,
                    type: absenceType,
                    hours: absenceHours,
                    ronosEmployeeUserId: empUserId
                  })
                }
              }
            } catch (userErr: any) {
              console.warn(`[RONOS Absences] Error leyendo días de ${empName}:`, userErr?.message)
            }
          }
        }
      } catch (storeErr: any) {
        const msg = `Error escaneando tienda ${store.tegName} (ID ${store.tegStoreId}): ${storeErr?.message || storeErr}`
        console.error(`[RONOS Absences] ${msg}`)
        errors.push(msg)
      }
    }

    // 4. Upsert a Supabase en la tabla 'schedules'
    let upsertCount = 0
    if (syncedRecords.length > 0) {
      // Eliminar duplicados si una fecha fue reportada en dos escaneos
      const uniqueMap = new Map<string, SyncedAbsenceRecord>()
      for (const rec of syncedRecords) {
        const key = `${rec.userId}_${rec.date}`
        uniqueMap.set(key, rec)
      }

      const deduplicatedRecords = Array.from(uniqueMap.values())

      for (const item of deduplicatedRecords) {
        const payload = {
          user_id: item.userId,
          store_id: item.storeId,
          date: item.date,
          start_time: '00:00:00',
          end_time: '00:00:00',
          shift_label: item.type, // 'Enfermedad' o 'Vacaciones'
          role: item.userRole
        }

        const { error: upsertErr } = await supabaseAdmin
          .from('schedules')
          .upsert(payload, { onConflict: 'user_id,date' })

        if (upsertErr) {
          console.error(`[RONOS Absences] Error en upsert para user ${item.userId} en fecha ${item.date}:`, upsertErr)
          errors.push(`Upsert error (${item.userName} / ${item.date}): ${upsertErr.message}`)
        } else {
          upsertCount++
        }
      }
    }

    const durationMs = Date.now() - startTime

    return {
      success: errors.length === 0 || upsertCount > 0,
      totalScannedStores: targetStores.length,
      totalAbsencesFound: syncedRecords.length,
      totalAbsencesUpserted: upsertCount,
      records: syncedRecords,
      errors: errors.length > 0 ? errors : undefined,
      durationMs
    }
  } catch (err: any) {
    console.error('[RONOS Absences] Error crítico en sincronización:', err)
    return {
      success: false,
      totalScannedStores: 0,
      totalAbsencesFound: 0,
      totalAbsencesUpserted: 0,
      records: [],
      errors: [err.message || 'Error desconocido'],
      durationMs: Date.now() - startTime
    }
  }
}