/**
 * @module lib/ronos-api
 * @description Motor universal de sincronización con la API REST v2.0 de RONOS (Cingular HR).
 *   - Autenticación OAuth2 directa con manejo de tokens y caché de sesión (15 días).
 *   - Extracción de tarjetas de tiempo, horas regulares, horas extras (OT/DT) y ponchadas atómicas.
 *   - Descarga de fotografías de reloj checador desde AWS S3 para prevención de fraude (Buddy Punching).
 *   - Analizador algorítmico de cumplimiento laboral de California (California Labor Law - IWC Wage Order 5):
 *     * Detección de Meal Penalties (inicio de comida después de la 5ta hora: > 4h 59m).
 *     * Detección de descansos cortos (< 30 min) y excesivos (> 35 min).
 *     * Detección de tarjetas rotas/incompletas (Broken Timecards).
 *     * Estimación del costo financiero cobrado por Cingular HR.
 *
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día siguiente. El turno PM inicia a las 5:00 PM.
 *   - Penalización de Comida (Meal Penalty): Si el empleado trabaja más de 5.0 horas sin ponchar comida, se genera 1 hora de salario base de penalización.
 *   - El sistema mapea automáticamente las 15 sucursales de Tacos Gavilan y el almacén central (Bodega).
 *
 * @dataFlow
 *   RONOS API -> ronos-api -> Normalización & Detección de Violaciones -> Endpoints API -> Dashboard /admin/ronos.
 *
 * @notes
 *   - Utiliza credenciales corporativas (carlos@tacosgavilan.com).
 *   - Token válido por 15 días continuos.
 */

import { supabaseAdmin } from './supabase'
import { getAllToastEmployees, calculateNameSimilarity, ToastEmployeeCandidate } from './ronos-mapping'

// Mapping of TEG Stores to RONOS Company IDs
export interface RonosStoreMapping {
  tegStoreId: number
  tegCode: string
  tegName: string
  ronosCompanyId: number
  ronosName: string
  isBodega?: boolean
}

export const RONOS_STORES_MAP: RonosStoreMapping[] = [
  { tegStoreId: 14, tegCode: 'LYNWOOD', tegName: 'Lynwood', ronosCompanyId: 34, ronosName: 'TEG - Lynwood' },
  { tegStoreId: 6, tegCode: 'LACENTRAL', tegName: 'LA Central', ronosCompanyId: 31, ronosName: 'TEG - Central' },
  { tegStoreId: 7, tegCode: 'SLAUSON', tegName: 'Slauson', ronosCompanyId: 328, ronosName: 'Tacos Gavilan - Slauson' },
  { tegStoreId: 5, tegCode: 'LABROADWY', tegName: 'LA Broadway', ronosCompanyId: 30, ronosName: 'TEG - Broadway' },
  { tegStoreId: 16, tegCode: 'DOWNEY', tegName: 'Downey', ronosCompanyId: 32, ronosName: 'TEG - Downey' },
  { tegStoreId: 12, tegCode: 'NORWALK', tegName: 'Norwalk', ronosCompanyId: 292, ronosName: 'TEG - Norwalk' },
  { tegStoreId: 1, tegCode: 'RIALTO', tegName: 'Rialto', ronosCompanyId: 25, ronosName: 'TEG - Rialto' },
  { tegStoreId: 11, tegCode: 'HPARK', tegName: 'Huntington Park', ronosCompanyId: 27, ronosName: 'Tacos Gavilan - HP' },
  { tegStoreId: 3, tegCode: 'WCOVINA', tegName: 'West Covina', ronosCompanyId: 36, ronosName: 'TEG - West Covina' },
  { tegStoreId: 15, tegCode: 'SOUTHGATE', tegName: 'South Gate', ronosCompanyId: 33, ronosName: 'TEG - South Gate' },
  { tegStoreId: 9, tegCode: 'SANTAANA', tegName: 'Santa Ana', ronosCompanyId: 35, ronosName: 'TEG - Santa Ana' },
  { tegStoreId: 10, tegCode: 'LAPUENTE', tegName: 'La Puente', ronosCompanyId: 37, ronosName: 'TEG - La Puente' },
  { tegStoreId: 4, tegCode: 'AZUSA', tegName: 'Azusa', ronosCompanyId: 24, ronosName: 'TEG - Azusa' },
  { tegStoreId: 8, tegCode: 'HOLLYWOOD', tegName: 'Hollywood', ronosCompanyId: 26, ronosName: 'TEG - Hollywood' },
  { tegStoreId: 13, tegCode: 'BELL', tegName: 'Bell', ronosCompanyId: 29, ronosName: 'TEG - Bell' },
  { tegStoreId: 999, tegCode: 'BODEGA', tegName: 'La Bodega (Almacén Central)', ronosCompanyId: 290, ronosName: 'Oceanitan LLC (Warehouse Vernon #2)', isBodega: true }
]

export interface RonosTokenSession {
  accessToken: string
  expiresAt: number
  userName: string
}

export interface RonosWorkWeek {
  weekId: number
  companyId: number
  startDate: string
  endDate: string
}

export interface RonosAtomicPunch {
  punchId: number
  employeeId: number
  workWeekId: number
  assignmentId?: string
  punchType: number // 1=IN/LUNCH_END, 2=OUT, 3=LUNCH_START
  punchTypeName: string
  punchTime: string
  localTime: string
  localTimeWithoutOffset?: string
  photoURL?: string
  addedPunch?: boolean
  offline?: boolean
}

export interface RonosComplianceViolation {
  type: 'MEAL_PENALTY_LATE' | 'MEAL_PENALTY_SHORT' | 'MEAL_PENALTY_MISSED' | 'LONG_LUNCH' | 'BROKEN_TIMECARD' | 'EXCESSIVE_OVERTIME'
  severity: 'danger' | 'warning' | 'info'
  title: string
  description: string
  estimatedCostUsd: number
  minutes?: number
}

export interface RonosMealBreak {
  index: number
  startTime?: string
  startPhoto?: string
  endTime?: string
  endPhoto?: string
  durationMinutes: number
  hoursWorkedBeforeMeal: number
}

export interface RonosDailyPunchesRecord {
  date: string
  dayName: string
  totalHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  lunchHours: number
  lunchDurationMinutes: number
  vacationHours?: number
  sickHours?: number
  holidayHours?: number
  bereavementHours?: number
  unpaidtimeHours?: number
  isVacation?: boolean
  isSick?: boolean
  isHoliday?: boolean
  mealBreaks?: RonosMealBreak[]
  clockInTime?: string
  clockInPhoto?: string
  lunchStartTime?: string
  lunchStartPhoto?: string
  lunchEndTime?: string
  lunchEndPhoto?: string
  clockOutTime?: string
  clockOutPhoto?: string
  punches: RonosAtomicPunch[]
  violations: RonosComplianceViolation[]
}

export interface RonosEmployeeTimecard {
  employeeUserId: number
  employeeId: number
  firstName: string
  lastName: string
  fullName: string
  pin: string
  jobTitle?: string
  departmentName?: string
  totalWeeklyHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  vacationHours?: number
  sickHours?: number
  holidayHours?: number
  bereavementHours?: number
  unpaidLeaveHours?: number
  mealPenaltyCount: number
  brokenHours: boolean
  lockTimecard: boolean
  days: RonosDailyPunchesRecord[]
  totalViolationsCount: number
  totalEstimatedPenaltyCostUsd: number
  toastEmployeeId?: string | null
  toastGuid?: string | null
  toastFullName?: string | null
  toastEmail?: string | null
  mappingType?: 'auto' | 'manual' | 'unmapped'
}

export interface RonosStoreAuditSummary {
  storeId: number
  storeCode: string
  storeName: string
  ronosCompanyId: number
  weekId: number
  startDate: string
  endDate: string
  totalEmployees: number
  activeEmployeesCount: number
  totalChainHours: number
  totalRegularHours: number
  totalOvertimeHours: number
  totalDoubleTimeHours: number
  totalMealPenaltiesCount: number
  totalBrokenTimecardsCount: number
  totalEstimatedPenaltyCostUsd: number
  totalEstimatedOvertimeCostUsd: number
  complianceScorePercent: number
  employees: RonosEmployeeTimecard[]
}

// In-Memory Token Cache
let cachedSession: RonosTokenSession | null = null

const DEFAULT_USER = process.env.RONOS_USER || 'carlos@tacosgavilan.com'
const DEFAULT_PASS = process.env.RONOS_PASS || 'Carlos@tegly26'
const BASE_API = 'https://ronos.com/api/v2.0'
const ESTIMATED_HOURLY_RATE = 19.50 // California QSR estimated average base rate for calculations

/**
 * Autentica y obtiene el token de acceso de RONOS
 */
export async function getRonosAuthToken(forceRefresh = false): Promise<string> {
  const now = Date.now()
  if (!forceRefresh && cachedSession && cachedSession.expiresAt > now + 60000) {
    return cachedSession.accessToken
  }

  const username = DEFAULT_USER
  const password = DEFAULT_PASS

  const params = new URLSearchParams()
  params.append('grant_type', 'password')
  params.append('username', username)
  params.append('password', password)
  params.append('reCaptcha', 'undefined')
  params.append('role', '3')
  params.append('company', '34') // Default to Lynwood

  const response = await fetch('https://ronos.com/Token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error en autenticación RONOS (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const expiresInMs = (data.expires_in || 1295999) * 1000

  cachedSession = {
    accessToken: data.access_token,
    expiresAt: now + expiresInMs,
    userName: data.userName || username
  }

  return cachedSession.accessToken
}

/**
 * Cliente HTTP autenticado para endpoints REST de RONOS
 */
export async function callRonosApi<T = any>(endpoint: string, payload: any = {}): Promise<T> {
  const token = await getRonosAuthToken()

  const response = await fetch(`${BASE_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    // Si el token expiró, refrescar e intentar 1 vez más
    if (response.status === 401) {
      const newToken = await getRonosAuthToken(true)
      const retryRes = await fetch(`${BASE_API}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      if (retryRes.ok) return await retryRes.json()
      const retryErr = await retryRes.text()
      throw new Error(`Error en RONOS API tras reintento [${endpoint}] (${retryRes.status}): ${retryErr.substring(0, 200)}`)
    }
    const errText = await response.text()
    throw new Error(`Error en RONOS API [${endpoint}] (${response.status}): ${errText.substring(0, 200)}`)
  }

  return await response.json()
}

/**
 * Obtiene las semanas de pago de una tienda desde Supabase (o API de RONOS como fallback)
 */
export async function getRonosWeeks(ronosCompanyId: number): Promise<RonosWorkWeek[]> {
  try {
    const { data: dbWeeks, error: dbErr } = await supabaseAdmin
      .from('ronos_work_weeks')
      .select('week_id, company_id, start_date, end_date')
      .eq('company_id', ronosCompanyId)
      .order('start_date', { ascending: false })

    if (!dbErr && dbWeeks && dbWeeks.length > 0) {
      return dbWeeks.map(w => ({
        weekId: w.week_id,
        companyId: w.company_id,
        startDate: w.start_date,
        endDate: w.end_date
      }))
    }
  } catch (err) {
    console.warn('Error fetching weeks from Supabase:', err)
  }

  // Fallback a API en vivo de RONOS
  try {
    const weeks = await callRonosApi<RonosWorkWeek[]>('WorkWeek/GetWeeksByCompany', {
      companyId: ronosCompanyId
    })
    return Array.isArray(weeks) ? weeks : []
  } catch (err) {
    console.error('Error fetching weeks from RONOS API:', err)
    return []
  }
}

/**
 * Analiza las ponchadas de un día individual y detecta violaciones laborales de California
 */
export function analyzeDayCompliance(
  punches: any[],
  workDateStr: string,
  totalHours: number,
  hourlyWage: number = ESTIMATED_HOURLY_RATE
): {
  lunchDurationMinutes: number
  mealBreaks: RonosMealBreak[]
  clockInTime?: string
  clockInPhoto?: string
  lunchStartTime?: string
  lunchStartPhoto?: string
  lunchEndTime?: string
  lunchEndPhoto?: string
  clockOutTime?: string
  clockOutPhoto?: string
  parsedPunches: RonosAtomicPunch[]
  violations: RonosComplianceViolation[]
} {
  const violations: RonosComplianceViolation[] = []
  const parsedPunches: RonosAtomicPunch[] = []

  if (!punches || punches.length === 0) {
    return {
      lunchDurationMinutes: 0,
      mealBreaks: [],
      parsedPunches: [],
      violations: []
    }
  }

  // Ordenar ponchadas por hora
  const sorted = [...punches].sort((a, b) => {
    const timeA = new Date(a.localTime || a.punchTime).getTime()
    const timeB = new Date(b.localTime || b.punchTime).getTime()
    return timeA - timeB
  })

  let inPunch: any = null
  let outPunch: any = null
  const mealBreaks: RonosMealBreak[] = []
  let currentMealStart: any = null
  let mealCount = 0

  sorted.forEach((p) => {
    let typeName = 'PUNCH'

    if (p.punchType === 1) {
      if (!inPunch) {
        inPunch = p
        typeName = 'CLOCK IN'
      } else if (currentMealStart) {
        // Fin del descanso de comida actual
        const startMs = new Date(currentMealStart.localTime || currentMealStart.punchTime).getTime()
        const endMs = new Date(p.localTime || p.punchTime).getTime()
        const duration = Math.max(0, Math.round((endMs - startMs) / 60000))

        const inTimeMs = new Date(inPunch.localTime || inPunch.punchTime).getTime()
        const hoursWorkedBefore = (startMs - inTimeMs) / (1000 * 60 * 60)

        mealCount++
        mealBreaks.push({
          index: mealCount,
          startTime: currentMealStart.localTime || currentMealStart.punchTime,
          startPhoto: currentMealStart.photoURL,
          endTime: p.localTime || p.punchTime,
          endPhoto: p.photoURL,
          durationMinutes: duration,
          hoursWorkedBeforeMeal: hoursWorkedBefore
        })

        typeName = mealCount === 1 ? 'LUNCH END' : `LUNCH ${mealCount} END`
        currentMealStart = null
      } else {
        typeName = 'IN'
      }
    } else if (p.punchType === 2) {
      outPunch = p
      typeName = 'CLOCK OUT'
    } else if (p.punchType === 3) {
      currentMealStart = p
      const nextMealNum = mealBreaks.length + 1
      typeName = nextMealNum === 1 ? 'LUNCH START' : `LUNCH ${nextMealNum} START`
    }

    parsedPunches.push({
      punchId: p.punchId,
      employeeId: p.employeeId,
      workWeekId: p.workWeekId,
      assignmentId: p.assignmentId,
      punchType: p.punchType,
      punchTypeName: typeName,
      punchTime: p.punchTime,
      localTime: p.localTime || p.punchTime,
      localTimeWithoutOffset: p.localTimeWithoutOffset,
      photoURL: p.photoURL,
      addedPunch: p.addedPunch,
      offline: p.offline
    })
  })

  // Si quedó un lunch start sin cerrar (ej. ponchada incompleta)
  if (currentMealStart) {
    mealCount++
    const inTimeMs = inPunch ? new Date(inPunch.localTime || inPunch.punchTime).getTime() : 0
    const startMs = new Date(currentMealStart.localTime || currentMealStart.punchTime).getTime()
    const hoursWorkedBefore = inTimeMs > 0 ? (startMs - inTimeMs) / (1000 * 60 * 60) : 0

    mealBreaks.push({
      index: mealCount,
      startTime: currentMealStart.localTime || currentMealStart.punchTime,
      startPhoto: currentMealStart.photoURL,
      endTime: undefined,
      endPhoto: undefined,
      durationMinutes: 0,
      hoursWorkedBeforeMeal: hoursWorkedBefore
    })
  }

  // Suma total de minutos de lunch
  const totalLunchMinutes = mealBreaks.reduce((sum, m) => sum + m.durationMinutes, 0)

  // Calcular horas trabajadas en el turno si totalHours viene en 0
  let shiftHours = totalHours
  if ((!shiftHours || shiftHours === 0) && inPunch && outPunch) {
    const inMs = new Date(inPunch.localTime || inPunch.punchTime).getTime()
    const outMs = new Date(outPunch.localTime || outPunch.punchTime).getTime()
    const rawElapsedHours = (outMs - inMs) / (1000 * 60 * 60)
    const lunchElapsedHours = totalLunchMinutes / 60
    shiftHours = Math.max(0, rawElapsedHours - lunchElapsedHours)
  }

  // 1. Analizar Duración de cada Comida
  mealBreaks.forEach((m) => {
    if (m.endTime) {
      if (m.durationMinutes < 29.5 && m.durationMinutes > 0) {
        violations.push({
          type: 'MEAL_PENALTY_SHORT',
          severity: 'danger',
          title: m.index === 1 ? 'Lunch Corto (< 30 min)' : `Lunch #${m.index} Corto (< 30 min)`,
          description: `El descanso #${m.index} duró solo ${m.durationMinutes} min (mínimo legal requerido: 30 min).`,
          estimatedCostUsd: hourlyWage,
          minutes: m.durationMinutes
        })
      }

      if (m.durationMinutes > 35) {
        violations.push({
          type: 'LONG_LUNCH',
          severity: 'warning',
          title: m.index === 1 ? 'Exceso de Tiempo en Lunch' : `Exceso de Tiempo en Lunch #${m.index}`,
          description: `El empleado tomó ${m.durationMinutes} min en el descanso #${m.index} (${m.durationMinutes - 30} min en exceso).`,
          estimatedCostUsd: 0,
          minutes: m.durationMinutes
        })
      }
    }
  })

  // 2. Analizar Cumplimiento de la 5ta Hora y Regla de 6 Horas (California Labor Code § 512)
  if (inPunch) {
    if (mealBreaks.length > 0) {
      const firstMeal = mealBreaks[0]
      // Si el primer descanso inició después de 5.0 horas continuas de trabajo
      if (firstMeal.hoursWorkedBeforeMeal > 5.0) {
        const minutesLate = Math.round((firstMeal.hoursWorkedBeforeMeal - 5.0) * 60)
        violations.push({
          type: 'MEAL_PENALTY_LATE',
          severity: 'danger',
          title: 'Violación 5ta Hora (Meal Penalty)',
          description: `Inició su primer lunch a las ${firstMeal.hoursWorkedBeforeMeal.toFixed(2)}h de turno (${minutesLate} min tarde de la 5ta hora).`,
          estimatedCostUsd: hourlyWage,
          minutes: minutesLate
        })
      }
    } else if (shiftHours > 6.0 && outPunch) {
      // Regla de California (Labor Code § 512):
      // Turnos <= 6.0 horas pueden omitir el lunch por mutuo acuerdo sin penalización.
      // Si el turno supera las 6.0 horas (ej. 6.5h, 7h, 8h) y no tomó comida, es penalización por ley.
      violations.push({
        type: 'MEAL_PENALTY_MISSED',
        severity: 'danger',
        title: 'Lunch Omitido (> 6h sin comida)',
        description: `Turno de ${shiftHours.toFixed(2)}h continuas sin descanso de comida (en turnos > 6h el lunch es obligatorio por ley).`,
        estimatedCostUsd: hourlyWage,
        minutes: 0
      })
    }
  }

  // 3. Analizar Tarjetas Incompletas (Broken Timecard)
  if ((inPunch && !outPunch && shiftHours > 0) || (!inPunch && outPunch) || (currentMealStart && !currentMealStart.endTime && outPunch)) {
    violations.push({
      type: 'BROKEN_TIMECARD',
      severity: 'warning',
      title: 'Ponchada Incompleta (Broken Timecard)',
      description: inPunch ? (outPunch ? 'Falta ponchada de regreso de lunch.' : 'Falta ponchada de salida (Clock Out).') : 'Falta ponchada de entrada (Clock In).',
      estimatedCostUsd: 0
    })
  }

  const primaryMeal = mealBreaks[0]

  return {
    lunchDurationMinutes: totalLunchMinutes,
    mealBreaks,
    clockInTime: inPunch?.localTime,
    clockInPhoto: inPunch?.photoURL,
    lunchStartTime: primaryMeal?.startTime,
    lunchStartPhoto: primaryMeal?.startPhoto,
    lunchEndTime: primaryMeal?.endTime,
    lunchEndPhoto: primaryMeal?.endPhoto,
    clockOutTime: outPunch?.localTime,
    clockOutPhoto: outPunch?.photoURL,
    parsedPunches,
    violations
  }
}

// Cache de auditoría por tienda y semana
const storeAuditCache = new Map<string, { data: RonosStoreAuditSummary; timestamp: number }>()
const AUDIT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos para semana activa
const AUDIT_PAST_WEEK_TTL_MS = 24 * 60 * 60 * 1000 // 24 horas para semanas cerradas

/**
 * Obtiene la auditoría completa de una tienda para una semana determinada
 */
export async function getRonosStoreAudit(
  ronosCompanyId: number,
  targetWeekId?: number,
  forceRefresh = false
): Promise<RonosStoreAuditSummary> {
  const storeMeta = RONOS_STORES_MAP.find(s => s.ronosCompanyId === ronosCompanyId) || {
    tegStoreId: 0,
    tegCode: 'UNKNOWN',
    tegName: 'Desconocida',
    ronosCompanyId,
    ronosName: `Store #${ronosCompanyId}`
  }

  // 1. Obtener semanas
  const weeks = await getRonosWeeks(ronosCompanyId)
  if (weeks.length === 0) {
    throw new Error(`No se encontraron semanas registradas para la tienda ${storeMeta.ronosName}`)
  }

  const selectedWeek = targetWeekId ? weeks.find(w => w.weekId === targetWeekId) || weeks[0] : weeks[0]
  const weekId = selectedWeek.weekId
  const isCurrentWeek = weeks[0]?.weekId === weekId

  // Verificar caché
  const cacheKey = `${ronosCompanyId}_${weekId}`
  const cached = storeAuditCache.get(cacheKey)
  const ttl = isCurrentWeek ? AUDIT_CACHE_TTL_MS : AUDIT_PAST_WEEK_TTL_MS
  if (!forceRefresh && cached && (Date.now() - cached.timestamp) < ttl) {
    return cached.data
  }

  // 2. Obtener lista consolidada de la semana (AdminGetWeekByWeekId)
  const weekData = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
    searchTerm: null,
    companyId: ronosCompanyId,
    weekId,
    departmentId: 0,
    pageNumber: 0,
    pageSize: 100,
    sort: 'FirstName',
    showInactive: 0,
    payType: 0,
    internalSalariedRules: false
  })

  const rawEmployees: any[] = weekData.results || []

  // Obtener UUID externo de la tienda en Supabase
  let storeExternalId: string | undefined = undefined
  try {
    const { data: dbStore } = await supabaseAdmin
      .from('stores')
      .select('id, external_id')
      .or(`id.eq.${storeMeta.tegStoreId},code.eq.${storeMeta.tegCode}`)
      .single()
    if (dbStore?.external_id) {
      storeExternalId = dbStore.external_id
    }
  } catch (err) {
    console.warn('Error fetching store external_id in audit:', err)
  }

  // Obtener mapeos existentes de Toast guardados en Supabase
  const savedMappingsMap = new Map<number, any>()
  const usedToastIds = new Set<string>()
  try {
    const { data: savedMappings } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .select('*')
      .eq('ronos_company_id', ronosCompanyId)

    if (savedMappings && Array.isArray(savedMappings)) {
      savedMappings.forEach((m: any) => {
        savedMappingsMap.set(Number(m.ronos_employee_user_id), m)
        if (m.toast_employee_id) {
          usedToastIds.add(m.toast_employee_id)
        }
      })
    }
  } catch (err) {
    console.warn('Error fetching saved mappings in store audit:', err)
  }

  // Obtener catálogo de empleados de Toast para auto-matching en vivo y puestos reales (filtrado por sucursal)
  let allToastEmployees: ToastEmployeeCandidate[] = []
  try {
    allToastEmployees = await getAllToastEmployees(storeExternalId)
  } catch (err) {
    console.warn('Error fetching allToastEmployees in store audit:', err)
  }

  let totalChainHours = 0
  let totalRegularHours = 0
  let totalOvertimeHours = 0
  let totalDoubleTimeHours = 0
  let totalMealPenaltiesCount = 0
  let totalBrokenTimecardsCount = 0
  let totalEstimatedPenaltyCostUsd = 0
  let activeEmployeesCount = 0

  // 3. Procesar en paralelo los detalles y ponchadas atómicas de cada empleado
  const employeeTimecards: RonosEmployeeTimecard[] = await Promise.all(
    rawEmployees.map(async (emp) => {
      const empUserId = Number(emp.employeeUserId || emp.userId)
      const weeklyHours = emp.totalWeeklyHour || 0
      const regHours = emp.totalWeeklyRegHours || 0
      const otHours = emp.totalWeeklyOverTime || 0
      const dtHours = emp.totalWeeklyDoubleTime || 0
      const broken = !!emp.brokenHours

      if (weeklyHours > 0) {
        activeEmployeesCount++
        totalChainHours += weeklyHours
        totalRegularHours += regHours
        totalOvertimeHours += otHours
        totalDoubleTimeHours += dtHours
      }

      if (broken) totalBrokenTimecardsCount++

      let days: RonosDailyPunchesRecord[] = []
      let empViolationsCount = 0
      let empPenaltyCost = 0
      let empVacationHours = 0
      let empSickHours = 0
      let empHolidayHours = 0
      let empBereavementHours = 0
      let empUnpaidHours = 0

      // Consultar detalle día por día si el empleado tiene ID válido (incluye colaboradores de vacaciones con 0h reloj)
      if (empUserId > 0) {
        try {
          const userWeek = await callRonosApi<any>('WorkWeek/ManagerGetUserWeekByWeekId', {
            userId: empUserId,
            weekId
          })

          if (userWeek && Array.isArray(userWeek.workDays)) {
            days = userWeek.workDays.map((wd: any) => {
              const dayTotalHours = wd.totalHours || 0
              const dayRegHours = wd.regularHours || 0
              const dayOtHours = wd.overtimeHours || 0
              const dayDtHours = wd.doubleTimeHours || 0
              const dayLunchHours = wd.lunchHours || 0
              const dayVacHours = Number(wd.vacationHours || 0)
              const daySickHours = Number(wd.sickHours || 0)
              const dayHolHours = Number(wd.holidayHours || 0)
              const dayBereaveHours = Number(wd.bereavementHours || 0)
              const dayUnpaidHours = Number(wd.unpaidtimeHours || 0)

              empVacationHours += dayVacHours
              empSickHours += daySickHours
              empHolidayHours += dayHolHours
              empBereavementHours += dayBereaveHours
              empUnpaidHours += dayUnpaidHours

              const analysis = analyzeDayCompliance(wd.punches, wd.date || wd.startTime, dayTotalHours)

              analysis.violations.forEach((v) => {
                empViolationsCount++
                empPenaltyCost += v.estimatedCostUsd
                if (v.type.startsWith('MEAL_PENALTY')) {
                  totalMealPenaltiesCount++
                  totalEstimatedPenaltyCostUsd += v.estimatedCostUsd
                }
              })

              return {
                date: wd.date || wd.startTime || '',
                dayName: wd.dayName || wd.dayOfWeek || '',
                totalHours: dayTotalHours,
                regularHours: dayRegHours,
                overtimeHours: dayOtHours,
                doubleTimeHours: dayDtHours,
                lunchHours: dayLunchHours,
                lunchDurationMinutes: analysis.lunchDurationMinutes,
                vacationHours: dayVacHours,
                sickHours: daySickHours,
                holidayHours: dayHolHours,
                bereavementHours: dayBereaveHours,
                unpaidtimeHours: dayUnpaidHours,
                isVacation: dayVacHours > 0 || !!wd.vacation,
                isSick: daySickHours > 0 || !!wd.sick,
                isHoliday: dayHolHours > 0 || !!wd.holiday,
                mealBreaks: analysis.mealBreaks,
                clockInTime: analysis.clockInTime,
                clockInPhoto: analysis.clockInPhoto,
                lunchStartTime: analysis.lunchStartTime,
                lunchStartPhoto: analysis.lunchStartPhoto,
                lunchEndTime: analysis.lunchEndTime,
                lunchEndPhoto: analysis.lunchEndPhoto,
                clockOutTime: analysis.clockOutTime,
                clockOutPhoto: analysis.clockOutPhoto,
                punches: analysis.parsedPunches,
                violations: analysis.violations
              }
            })
          }
        } catch (err) {
          console.error(`Error consultando ponchadas de ${emp.firstName} ${emp.lastName}:`, err)
        }
      }

      const empFullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim()
      const savedMap = savedMappingsMap.get(empUserId)

      let toastEmployeeId: string | null = null
      let toastGuid: string | null = null
      let toastFullName: string | null = null
      let toastEmail: string | null = null
      let toastJobTitle: string | null = null
      let mappingType: 'auto' | 'manual' | 'unmapped' = 'unmapped'

      if (savedMap) {
        toastEmployeeId = savedMap.toast_employee_id || null
        toastGuid = savedMap.toast_guid || null
        toastFullName = savedMap.toast_full_name || null
        toastEmail = savedMap.toast_email || null
        toastJobTitle = savedMap.toast_job_title || null
        mappingType = savedMap.mapping_type || (toastEmail ? 'manual' : 'unmapped')
      } else if (allToastEmployees.length > 0) {
        // Auto-matching en vivo por similitud de nombres si no ha sido guardado en DB
        let bestMatch: ToastEmployeeCandidate | null = null
        let bestScore = 0

        for (const t of allToastEmployees) {
          if (usedToastIds.has(t.id)) continue
          const score = calculateNameSimilarity(empFullName, t.full_name)
          if (score > bestScore) {
            bestScore = score
            bestMatch = t
          }
        }

        if (bestScore >= 70 && bestMatch) {
          usedToastIds.add(bestMatch.id)
          toastEmployeeId = bestMatch.id
          toastGuid = bestMatch.toast_guid
          toastFullName = bestMatch.full_name
          toastEmail = bestMatch.email
          toastJobTitle = bestMatch.job_title || null
          mappingType = 'auto'
        }
      }

      const displayJobTitle = toastJobTitle || emp.title || 'Colaborador'

      return {
        employeeUserId: empUserId,
        employeeId: emp.employeeId,
        firstName: emp.firstName || '',
        lastName: emp.lastName || '',
        fullName: empFullName,
        pin: emp.pin || '',
        jobTitle: displayJobTitle,
        departmentName: emp.departmentName || storeMeta.tegName,
        totalWeeklyHours: weeklyHours,
        regularHours: regHours,
        overtimeHours: otHours,
        doubleTimeHours: dtHours,
        vacationHours: empVacationHours,
        sickHours: empSickHours,
        holidayHours: empHolidayHours,
        bereavementHours: empBereavementHours,
        unpaidLeaveHours: empUnpaidHours,
        mealPenaltyCount: emp.mealPenalty || 0,
        brokenHours: broken,
        lockTimecard: !!emp.locktimecard,
        days,
        totalViolationsCount: empViolationsCount,
        totalEstimatedPenaltyCostUsd: empPenaltyCost,
        toastEmployeeId,
        toastGuid,
        toastFullName,
        toastEmail,
        mappingType
      }
    })
  )

  const totalEstimatedOvertimeCostUsd = (totalOvertimeHours * ESTIMATED_HOURLY_RATE * 1.5) + (totalDoubleTimeHours * ESTIMATED_HOURLY_RATE * 2.0)
  const totalShiftsEstimated = Math.max(1, activeEmployeesCount * 5)
  const complianceScorePercent = Math.max(0, Math.min(100, Math.round(100 - ((totalMealPenaltiesCount / totalShiftsEstimated) * 100))))

  const result: RonosStoreAuditSummary = {
    storeId: storeMeta.tegStoreId,
    storeCode: storeMeta.tegCode,
    storeName: storeMeta.tegName,
    ronosCompanyId,
    weekId,
    startDate: selectedWeek.startDate,
    endDate: selectedWeek.endDate,
    totalEmployees: rawEmployees.length,
    activeEmployeesCount,
    totalChainHours: Number(totalChainHours.toFixed(2)),
    totalRegularHours: Number(totalRegularHours.toFixed(2)),
    totalOvertimeHours: Number(totalOvertimeHours.toFixed(2)),
    totalDoubleTimeHours: Number(totalDoubleTimeHours.toFixed(2)),
    totalMealPenaltiesCount,
    totalBrokenTimecardsCount,
    totalEstimatedPenaltyCostUsd: Number(totalEstimatedPenaltyCostUsd.toFixed(2)),
    totalEstimatedOvertimeCostUsd: Number(totalEstimatedOvertimeCostUsd.toFixed(2)),
    complianceScorePercent,
    employees: employeeTimecards.sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }))
  }

  // 4. Persistir permanentemente en Supabase (ronos_employee_timecards_cache)
  try {
    const timecardsToCache = employeeTimecards.map(emp => ({
      company_id: ronosCompanyId,
      week_id: weekId,
      employee_user_id: emp.employeeUserId,
      employee_id: emp.employeeId ? Number(emp.employeeId) : null,
      full_name: emp.fullName,
      first_name: emp.firstName,
      last_name: emp.lastName,
      pin: emp.pin,
      job_title: emp.jobTitle,
      regular_hours: emp.regularHours,
      overtime_hours: emp.overtimeHours,
      double_time_hours: emp.doubleTimeHours,
      total_weekly_hours: emp.totalWeeklyHours,
      meal_penalty_count: emp.mealPenaltyCount,
      sick_hours: emp.sickHours || 0,
      vacation_hours: emp.vacationHours || 0,
      holiday_hours: emp.holidayHours || 0,
      bereavement_hours: emp.bereavementHours || 0,
      unpaid_leave_hours: emp.unpaidLeaveHours || 0,
      broken_hours: emp.brokenHours,
      active: emp.totalWeeklyHours > 0 || (emp.vacationHours || 0) > 0 || (emp.sickHours || 0) > 0,
      updated_at: new Date().toISOString()
    }))

    if (timecardsToCache.length > 0) {
      await supabaseAdmin
        .from('ronos_employee_timecards_cache')
        .upsert(timecardsToCache, { onConflict: 'company_id,week_id,employee_user_id' })
    }
  } catch (err: any) {
    console.warn('Error persisting timecards cache to Supabase:', err?.message)
  }

  storeAuditCache.set(cacheKey, { data: result, timestamp: Date.now() })
  return result
}

/**
 * Consulta la auditoría consolidada de toda la cadena (15 tiendas + Bodega)
 */
export async function getRonosChainWideAudit(): Promise<{
  totalStores: number
  totalChainEmployees: number
  totalActiveEmployees: number
  totalChainHours: number
  totalOvertimeHours: number
  totalDoubleTimeHours: number
  totalMealPenalties: number
  totalBrokenTimecards: number
  totalPenaltyCostUsd: number
  totalOvertimeCostUsd: number
  stores: Array<{
    storeId: number
    storeCode: string
    storeName: string
    ronosCompanyId: number
    weekId: number
    activeEmployees: number
    totalHours: number
    overtimeHours: number
    mealPenalties: number
    brokenTimecards: number
    penaltyCostUsd: number
    complianceScore: number
  }>
}> {
  const storeAudits = await Promise.all(
    RONOS_STORES_MAP.map(async (store) => {
      try {
        const weeks = await getRonosWeeks(store.ronosCompanyId)
        if (!weeks || weeks.length === 0) return null
        const currentWeek = weeks[0]

        const weekData = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
          searchTerm: null,
          companyId: store.ronosCompanyId,
          weekId: currentWeek.weekId,
          departmentId: 0,
          pageNumber: 0,
          pageSize: 100,
          sort: 'FirstName',
          showInactive: 0,
          payType: 0,
          internalSalariedRules: false
        })

        const rawEmployees: any[] = weekData.results || []
        let storeHours = 0
        let storeOt = 0
        let storeDt = 0
        let storePenalties = 0
        let storeBroken = 0
        let activeCount = 0

        rawEmployees.forEach((emp) => {
          const h = emp.totalWeeklyHour || 0
          if (h > 0) {
            activeCount++
            storeHours += h
            storeOt += (emp.totalWeeklyOverTime || 0)
            storeDt += (emp.totalWeeklyDoubleTime || 0)
          }
          if (emp.mealPenalty) storePenalties += emp.mealPenalty
          if (emp.brokenHours) storeBroken++
        })

        const penaltyCost = storePenalties * ESTIMATED_HOURLY_RATE
        const shifts = Math.max(1, activeCount * 5)
        const compliance = Math.max(0, Math.min(100, Math.round(100 - ((storePenalties / shifts) * 100))))

        return {
          storeId: store.tegStoreId,
          storeCode: store.tegCode,
          storeName: store.tegName,
          ronosCompanyId: store.ronosCompanyId,
          weekId: currentWeek.weekId,
          activeEmployees: activeCount,
          totalHours: Number(storeHours.toFixed(2)),
          overtimeHours: Number((storeOt + storeDt).toFixed(2)),
          mealPenalties: storePenalties,
          brokenTimecards: storeBroken,
          penaltyCostUsd: Number(penaltyCost.toFixed(2)),
          complianceScore: compliance
        }
      } catch (err) {
        console.error(`Error auditando tienda ${store.tegName}:`, err)
        return null
      }
    })
  )

  const validStores = storeAudits.filter((s): s is NonNullable<typeof s> => s !== null)

  const totalChainEmployees = validStores.reduce((acc, s) => acc + s.activeEmployees, 0)
  const totalChainHours = validStores.reduce((acc, s) => acc + s.totalHours, 0)
  const totalOvertimeHours = validStores.reduce((acc, s) => acc + s.overtimeHours, 0)
  const totalMealPenalties = validStores.reduce((acc, s) => acc + s.mealPenalties, 0)
  const totalBrokenTimecards = validStores.reduce((acc, s) => acc + s.brokenTimecards, 0)
  const totalPenaltyCostUsd = validStores.reduce((acc, s) => acc + s.penaltyCostUsd, 0)
  const totalOvertimeCostUsd = totalOvertimeHours * ESTIMATED_HOURLY_RATE * 1.5

  return {
    totalStores: validStores.length,
    totalChainEmployees,
    totalActiveEmployees: totalChainEmployees,
    totalChainHours: Number(totalChainHours.toFixed(2)),
    totalOvertimeHours: Number(totalOvertimeHours.toFixed(2)),
    totalDoubleTimeHours: 0,
    totalMealPenalties,
    totalBrokenTimecards,
    totalPenaltyCostUsd: Number(totalPenaltyCostUsd.toFixed(2)),
    totalOvertimeCostUsd: Number(totalOvertimeCostUsd.toFixed(2)),
    stores: validStores.sort((a, b) => b.totalHours - a.totalHours)
  }
}
