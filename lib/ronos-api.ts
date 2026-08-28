/**
 * @module lib/ronos-api
 * @description Motor universal de sincronización de alta resiliencia con la API REST v2.0 de RONOS (Cingular HR).
 *   - Autenticación OAuth2 robusta con promesas unificadas (Anti-Thundering Herd), reintentos exponenciales y caché de sesión (15 días).
 *   - Cliente HTTP blindado con timeouts (AbortController), reintentos con retroceso exponencial (Exponential Backoff + Jitter) para códigos 429/500/502/503/504 y caídas de red.
 *   - Procesamiento en paralelo con control de concurrencia (Concurrency Pool / Chunking) para no saturar los servidores de Cingular HR.
 *   - Extracción y normalización de tarjetas de tiempo, horas regulares, horas extras (OT/DT), PTO (Vacation, Sick, Holiday) y ponchadas atómicas con fotos AWS S3.
 *   - Analizador algorítmico de cumplimiento laboral de California (California Labor Law - IWC Wage Order 5 / Labor Code § 512):
 *     * Detección de Meal Penalties (inicio de comida después de la 5ta hora: > 5.0h).
 *     * Detección de descansos cortos (< 30 min) y excesivos (> 35 min).
 *     * Detección de tarjetas rotas/incompletas (Broken Timecards).
 *     * Estimación del costo financiero de penalizaciones y horas extras.
 *
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día siguiente. El turno PM inicia a las 5:00 PM.
 *   - Penalización de Comida (Meal Penalty): Si el empleado trabaja más de 5.0 horas sin ponchar comida, se genera 1 hora de salario base de penalización.
 *   - Turnos <= 6.0 horas pueden omitir el descanso de comida por mutuo acuerdo sin penalización legal (Labor Code § 512).
 *   - El sistema mapea y audita automáticamente las 15 sucursales de Tacos Gavilan y el almacén central (La Bodega).
 *
 * @dataFlow
 *   RONOS API REST -> ronos-api (Backoff + Pool) -> Normalización & Detección de Violaciones -> Supabase Cache -> Endpoints API -> Dashboard /admin/ronos.
 *
 * @notes
 *   - Utiliza credenciales corporativas (carlos@tacosgavilan.com).
 *   - Concurrency Pool: Límite de 6 llamadas concurrentes por tienda para evitar HTTP 502/429.
 *   - Mantiene compatibilidad total con `ronos-mapping`, `payroll-calculator`, cron jobs y endpoints `/api/ronos/*`.
 */

import { supabaseAdmin } from './supabase'
import { getAllToastEmployees, calculateNameSimilarity, ToastEmployeeCandidate } from './ronos-mapping'

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

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
  { tegStoreId: 999, tegCode: 'BODEGA', tegName: 'La Bodega (Almacén Central)', ronosCompanyId: 28, ronosName: 'TEG - La Bodega (Vernon Warehouse)', isBodega: true }
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

// ============================================================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================================================

const DEFAULT_USER = process.env.RONOS_USER || 'carlos@tacosgavilan.com'
const DEFAULT_PASS = process.env.RONOS_PASS || 'Carlos@tegly26'
const BASE_API = 'https://ronos.com/api/v2.0'
const ESTIMATED_HOURLY_RATE = 19.50
const REQUEST_TIMEOUT_MS = 25000
const MAX_CONCURRENT_CALLS = 6

// In-Memory State & Mutex
let cachedSession: RonosTokenSession | null = null
let authPromiseMutex: Promise<string> | null = null

const storeAuditCache = new Map<string, { data: RonosStoreAuditSummary; timestamp: number }>()
const AUDIT_CACHE_TTL_MS = 5 * 60 * 1000
const AUDIT_PAST_WEEK_TTL_MS = 24 * 60 * 60 * 1000

// ============================================================================
// HELPERS DE TOLERANCIA A FALLOS (RETRY, BACKOFF & CONCURRENCY)
// ============================================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Ejecutor con límite de concurrencia (Concurrency Pool)
 */
export async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items || !Array.isArray(items) || items.length === 0) return []
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++
      results[index] = await fn(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * Fetch seguro con Timeout via AbortController
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return res
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Parseo numérico ultra-seguro (nunca retorna NaN)
 */
function safeNum(val: any, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return isNaN(n) ? fallback : n
}

/**
 * Parseo de fecha timestamp seguro (nunca retorna NaN)
 */
function safeTimestamp(val?: string): number {
  if (!val) return 0
  const t = new Date(val).getTime()
  return isNaN(t) ? 0 : t
}

// ============================================================================
// AUTENTICACIÓN OAUTH2 (RONOS)
// ============================================================================

/**
 * Autentica y obtiene el token de acceso de RONOS con promesas unificadas y reintentos.
 */
export async function getRonosAuthToken(forceRefresh = false): Promise<string> {
  const now = Date.now()

  // 1. Reutilizar sesión válida con 5 minutos de margen de seguridad
  if (!forceRefresh && cachedSession && cachedSession.expiresAt > now + 300000) {
    return cachedSession.accessToken
  }

  // 2. Si ya hay una autenticación en vuelo, reusar la misma promesa (Anti-Thundering Herd)
  if (authPromiseMutex) {
    return await authPromiseMutex
  }

  authPromiseMutex = (async () => {
    const username = DEFAULT_USER
    const password = DEFAULT_PASS
    const params = new URLSearchParams()
    params.append('grant_type', 'password')
    params.append('username', username)
    params.append('password', password)
    params.append('reCaptcha', 'undefined')
    params.append('role', '3')
    params.append('company', '34')

    let lastError: Error | null = null
    const maxRetries = 3

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetchWithTimeout('https://ronos.com/Token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        }, 15000)

        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`)
        }

        const rawText = await response.text()
        const data = JSON.parse(rawText)

        if (!data?.access_token) {
          throw new Error('Respuesta de autenticación sin access_token válido')
        }

        const expiresInMs = (safeNum(data.expires_in, 1295999)) * 1000

        cachedSession = {
          accessToken: data.access_token,
          expiresAt: Date.now() + expiresInMs,
          userName: data.userName || username
        }

        return cachedSession.accessToken
      } catch (err: any) {
        lastError = err
        cachedSession = null
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500
          console.warn(`[RONOS Auth] Intento ${attempt}/${maxRetries} fallido (${err?.message || String(err)}). Reintentando en ${Math.round(delay)}ms...`)
          await sleep(delay)
        }
      }
    }

    throw new Error(`Error fatal en autenticación RONOS tras ${maxRetries} intentos: ${lastError?.message || String(lastError)}`)
  })()

  try {
    return await authPromiseMutex
  } finally {
    authPromiseMutex = null
  }
}

// ============================================================================
// CLIENTE HTTP CON RETROCESO EXPONENCIAL
// ============================================================================

/**
 * Cliente HTTP autenticado con reintentos exponenciales, timeouts y tolerancia a fallos.
 */
export async function callRonosApi<T = any>(endpoint: string, payload: any = {}, maxRetries = 3): Promise<T> {
  let token = await getRonosAuthToken()

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(`${BASE_API}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (response.status === 401 && attempt < maxRetries) {
        console.warn(`[RONOS API 401] Token expirado en [${endpoint}]. Forzando refresco de token...`)
        token = await getRonosAuthToken(true)
        continue
      }

      if (!response.ok) {
        const isTransient = [408, 429, 500, 502, 503, 504].includes(response.status)
        const errText = await response.text().catch(() => '')

        if (isTransient && attempt < maxRetries) {
          const backoffDelay = Math.pow(2, attempt - 1) * 800 + Math.random() * 400
          console.warn(`[RONOS API ${response.status}] en [${endpoint}] (Intento ${attempt}/${maxRetries}). Reintentando en ${Math.round(backoffDelay)}ms...`)
          await sleep(backoffDelay)
          continue
        }

        throw new Error(`Error en RONOS API [${endpoint}] (${response.status}): ${errText.substring(0, 250)}`)
      }

      const rawText = await response.text()
      try {
        return JSON.parse(rawText) as T
      } catch {
        throw new Error(`Respuesta inválida (no-JSON) de RONOS API [${endpoint}]: ${rawText.substring(0, 150)}`)
      }
    } catch (err: any) {
      const isNetworkError = err?.name === 'AbortError' || err?.message?.includes('fetch failed') || err?.message?.includes('network')
      if (isNetworkError && attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500
        console.warn(`[RONOS Network Error] en [${endpoint}]: ${err?.message || String(err)}. Reintento ${attempt}/${maxRetries} en ${Math.round(delay)}ms...`)
        await sleep(delay)
        continue
      }

      throw err
    }
  }

  throw new Error(`Fallo inesperado al ejecutar RONOS API [${endpoint}]`)
}

// ============================================================================
// SEMANAS DE PAGO (WORK WEEKS)
// ============================================================================

const weeksMemoryCache = new Map<number, { data: RonosWorkWeek[]; timestamp: number }>()

/**
 * Obtiene las semanas de pago de una tienda desde memoria / Supabase (o API de RONOS con normalización y auto-caché)
 */
export async function getRonosWeeks(ronosCompanyId: number): Promise<RonosWorkWeek[]> {
  const cachedMem = weeksMemoryCache.get(ronosCompanyId)
  if (cachedMem && (Date.now() - cachedMem.timestamp) < 15 * 60 * 1000) {
    return cachedMem.data
  }

  try {
    const { data: dbWeeks, error: dbErr } = await supabaseAdmin
      .from('ronos_work_weeks')
      .select('week_id, company_id, start_date, end_date')
      .eq('company_id', ronosCompanyId)
      .order('start_date', { ascending: false })

    if (!dbErr && dbWeeks && dbWeeks.length > 0) {
      const parsed = dbWeeks.map(w => ({
        weekId: safeNum(w.week_id),
        companyId: safeNum(w.company_id, ronosCompanyId),
        startDate: String(w.start_date || ''),
        endDate: String(w.end_date || '')
      })).filter(w => w.weekId > 0)

      weeksMemoryCache.set(ronosCompanyId, { data: parsed, timestamp: Date.now() })
      return parsed
    }
  } catch (err) {
    console.warn(`[RONOS Weeks] Advertencia al consultar Supabase para compañía ${ronosCompanyId}:`, err)
  }

  try {
    const rawWeeks = await callRonosApi<any>('WorkWeek/GetWeeksByCompany', {
      companyId: ronosCompanyId
    })

    const weeksArray: any[] = Array.isArray(rawWeeks)
      ? rawWeeks
      : Array.isArray(rawWeeks?.results)
        ? rawWeeks.results
        : Array.isArray(rawWeeks?.data)
          ? rawWeeks.data
          : []

    const normalized: RonosWorkWeek[] = weeksArray.map((w: any) => ({
      weekId: safeNum(w?.weekId || w?.id || w?.WeekId),
      companyId: safeNum(w?.companyId || w?.CompanyId, ronosCompanyId),
      startDate: String(w?.startDate || w?.start_date || w?.StartDate || ''),
      endDate: String(w?.endDate || w?.end_date || w?.EndDate || '')
    })).filter(w => w.weekId > 0)

    if (normalized.length > 0) {
      weeksMemoryCache.set(ronosCompanyId, { data: normalized, timestamp: Date.now() })
      const rowsToUpsert = normalized.slice(0, 8).map(w => ({
        week_id: w.weekId,
        company_id: w.companyId,
        start_date: w.startDate,
        end_date: w.endDate
      }))

      Promise.resolve(
        supabaseAdmin
          .from('ronos_work_weeks')
          .upsert(rowsToUpsert, { onConflict: 'week_id' })
      ).then(({ error }: any) => {
        if (error) console.warn('[RONOS Weeks] Error guardando caché en Supabase:', error?.message || error)
      }).catch((err: any) => {
        console.warn('[RONOS Weeks] Excepción guardando caché en Supabase:', err?.message || err)
      })
    }

    return normalized
  } catch (apiErr: any) {
    console.error(`[RONOS Weeks] Error crítico consultando semanas para compañía ${ronosCompanyId}:`, apiErr?.message || String(apiErr))
    return []
  }
}

// ============================================================================
// MOTOR DE CUMPLIMIENTO LABORAL DE CALIFORNIA (COMPLIANCE ANALYZER)
// ============================================================================

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

  if (!punches || !Array.isArray(punches) || punches.length === 0) {
    return {
      lunchDurationMinutes: 0,
      mealBreaks: [],
      parsedPunches: [],
      violations: []
    }
  }

  const validPunches = (punches || []).filter(Boolean)
  const sorted = [...validPunches].sort((a, b) => {
    const timeA = safeTimestamp(a?.localTime || a?.punchTime)
    const timeB = safeTimestamp(b?.localTime || b?.punchTime)
    return timeA - timeB
  })

  let inPunch: any = null
  let outPunch: any = null
  const mealBreaks: RonosMealBreak[] = []
  let currentMealStart: any = null
  let mealCount = 0

  sorted.forEach((p) => {
    let typeName = 'PUNCH'
    const pType = safeNum(p?.punchType)

    if (pType === 1) {
      if (!inPunch) {
        inPunch = p
        typeName = 'CLOCK IN'
      } else if (currentMealStart) {
        const startMs = safeTimestamp(currentMealStart?.localTime || currentMealStart?.punchTime)
        const endMs = safeTimestamp(p?.localTime || p?.punchTime)
        const duration = (startMs > 0 && endMs > startMs) ? Math.max(0, Math.round((endMs - startMs) / 60000)) : 0

        const inTimeMs = safeTimestamp(inPunch?.localTime || inPunch?.punchTime)
        const hoursWorkedBefore = (inTimeMs > 0 && startMs > inTimeMs) ? (startMs - inTimeMs) / (1000 * 60 * 60) : 0

        mealCount++
        mealBreaks.push({
          index: mealCount,
          startTime: currentMealStart?.localTime || currentMealStart?.punchTime,
          startPhoto: currentMealStart?.photoURL,
          endTime: p?.localTime || p?.punchTime,
          endPhoto: p?.photoURL,
          durationMinutes: duration,
          hoursWorkedBeforeMeal: Number(hoursWorkedBefore.toFixed(2))
        })

        typeName = mealCount === 1 ? 'LUNCH END' : `LUNCH ${mealCount} END`
        currentMealStart = null
      } else {
        typeName = 'IN'
      }
    } else if (pType === 2) {
      outPunch = p
      typeName = 'CLOCK OUT'
    } else if (pType === 3) {
      currentMealStart = p
      const nextMealNum = mealBreaks.length + 1
      typeName = nextMealNum === 1 ? 'LUNCH START' : `LUNCH ${nextMealNum} START`
    }

    parsedPunches.push({
      punchId: safeNum(p?.punchId),
      employeeId: safeNum(p?.employeeId),
      workWeekId: safeNum(p?.workWeekId),
      assignmentId: p?.assignmentId,
      punchType: pType,
      punchTypeName: typeName,
      punchTime: p?.punchTime || '',
      localTime: p?.localTime || p?.punchTime || '',
      localTimeWithoutOffset: p?.localTimeWithoutOffset,
      photoURL: p?.photoURL,
      addedPunch: !!p?.addedPunch,
      offline: !!p?.offline
    })
  })

  if (currentMealStart) {
    mealCount++
    const inTimeMs = inPunch ? safeTimestamp(inPunch?.localTime || inPunch?.punchTime) : 0
    const startMs = safeTimestamp(currentMealStart?.localTime || currentMealStart?.punchTime)
    const hoursWorkedBefore = (inTimeMs > 0 && startMs > inTimeMs) ? (startMs - inTimeMs) / (1000 * 60 * 60) : 0

    mealBreaks.push({
      index: mealCount,
      startTime: currentMealStart.localTime || currentMealStart.punchTime,
      startPhoto: currentMealStart.photoURL,
      endTime: undefined,
      endPhoto: undefined,
      durationMinutes: 0,
      hoursWorkedBeforeMeal: Number(hoursWorkedBefore.toFixed(2))
    })
  }

  const totalLunchMinutes = mealBreaks.reduce((sum, m) => sum + m.durationMinutes, 0)

  let shiftHours = safeNum(totalHours, 0)
  if (shiftHours === 0 && inPunch && outPunch) {
    const inMs = safeTimestamp(inPunch.localTime || inPunch.punchTime)
    const outMs = safeTimestamp(outPunch.localTime || outPunch.punchTime)
    if (inMs > 0 && outMs > inMs) {
      const rawElapsedHours = (outMs - inMs) / (1000 * 60 * 60)
      const lunchElapsedHours = totalLunchMinutes / 60
      shiftHours = Math.max(0, rawElapsedHours - lunchElapsedHours)
    }
  }

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

  if (inPunch) {
    if (mealBreaks.length > 0) {
      const firstMeal = mealBreaks[0]
      if (firstMeal.hoursWorkedBeforeMeal > 5.0) {
        const minutesLate = Math.max(1, Math.round((firstMeal.hoursWorkedBeforeMeal - 5.0) * 60))
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

  if ((inPunch && !outPunch && shiftHours > 0) || (!inPunch && outPunch) || (currentMealStart && outPunch)) {
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

// ============================================================================
// AUDITORÍA DE TIENDA INDIVIDUAL
// ============================================================================

/**
 * Obtiene la auditoría completa de una tienda para una semana determinada con control de concurrencia y tolerancia a fallos
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

  const weeks = await getRonosWeeks(ronosCompanyId)
  if (weeks.length === 0) {
    throw new Error(`No se encontraron semanas registradas para la tienda ${storeMeta.ronosName}`)
  }

  const selectedWeek = targetWeekId ? weeks.find(w => w.weekId === targetWeekId) || weeks[0] : weeks[0]
  if (!selectedWeek) {
    throw new Error(`No se encontró semana válida para ${storeMeta.ronosName}`)
  }
  const weekId = safeNum(selectedWeek.weekId)
  const isCurrentWeek = weeks[0]?.weekId === weekId

  const cacheKey = `${ronosCompanyId}_${weekId}`
  const cached = storeAuditCache.get(cacheKey)
  const ttl = isCurrentWeek ? AUDIT_CACHE_TTL_MS : AUDIT_PAST_WEEK_TTL_MS
  if (!forceRefresh && cached && (Date.now() - cached.timestamp) < ttl) {
    return cached.data
  }

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

  const rawEmployees: any[] = Array.isArray(weekData)
    ? weekData
    : Array.isArray(weekData?.results)
      ? weekData.results
      : Array.isArray(weekData?.employees)
        ? weekData.employees
        : Array.isArray(weekData?.data)
          ? weekData.data
          : []

  let storeExternalId: string | undefined = undefined
  try {
    const { data: dbStore } = await supabaseAdmin
      .from('stores')
      .select('id, external_id')
      .or(`id.eq.${storeMeta.tegStoreId},code.eq.${storeMeta.tegCode}`)
      .maybeSingle()
    if (dbStore?.external_id) {
      storeExternalId = dbStore.external_id
    }
  } catch (err) {
    console.warn('[RONOS Audit] Error consultando external_id de tienda:', err)
  }

  const savedMappingsMap = new Map<number, any>()
  const usedToastIds = new Set<string>()
  try {
    const { data: savedMappings } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .select('*')
      .eq('ronos_company_id', ronosCompanyId)

    if (savedMappings && Array.isArray(savedMappings)) {
      savedMappings.forEach((m: any) => {
        if (!m) return
        const empUid = safeNum(m.ronos_employee_user_id)
        if (empUid > 0) {
          savedMappingsMap.set(empUid, m)
          if (m.toast_employee_id) {
            usedToastIds.add(String(m.toast_employee_id))
          }
        }
      })
    }
  } catch (err) {
    console.warn('[RONOS Audit] Error consultando mapeos en Supabase:', err)
  }

  let allToastEmployees: ToastEmployeeCandidate[] = []
  try {
    allToastEmployees = (await getAllToastEmployees(storeExternalId)) || []
  } catch (err) {
    console.warn('[RONOS Audit] Error consultando empleados Toast:', err)
    allToastEmployees = []
  }

  const employeeTimecards: RonosEmployeeTimecard[] = await mapConcurrent(
    rawEmployees,
    MAX_CONCURRENT_CALLS,
    async (emp) => {
      if (!emp) return null as any
      const empUserId = safeNum(emp.employeeUserId || emp.userId || emp.id)
      const empId = safeNum(emp.employeeId || emp.empId)
      const weeklyHours = safeNum(emp.totalWeeklyHour || emp.totalWeeklyHours || emp.totalHours)
      const regHours = safeNum(emp.totalWeeklyRegHours || emp.regularHours)
      const otHours = safeNum(emp.totalWeeklyOverTime || emp.totalWeeklyOvertime || emp.overtimeHours)
      const dtHours = safeNum(emp.totalWeeklyDoubleTime || emp.doubleTimeHours)
      const broken = !!emp.brokenHours

      let days: RonosDailyPunchesRecord[] = []
      let empViolationsCount = 0
      let empPenaltyCost = 0
      let empVacationHours = 0
      let empSickHours = 0
      let empHolidayHours = 0
      let empBereavementHours = 0
      let empUnpaidHours = 0

      if (empUserId > 0) {
        try {
          const userWeek = await callRonosApi<any>('WorkWeek/ManagerGetUserWeekByWeekId', {
            userId: empUserId,
            weekId
          })

          const workDays: any[] = Array.isArray(userWeek?.workDays) ? userWeek.workDays : []

          days = (workDays || []).filter(Boolean).map((wd: any) => {
            const dayTotalHours = safeNum(wd?.totalHours)
            const dayRegHours = safeNum(wd?.regularHours)
            const dayOtHours = safeNum(wd?.overtimeHours)
            const dayDtHours = safeNum(wd?.doubleTimeHours)
            const dayLunchHours = safeNum(wd?.lunchHours)
            const dayVacHours = safeNum(wd?.vacationHours)
            const daySickHours = safeNum(wd?.sickHours)
            const dayHolHours = safeNum(wd?.holidayHours)
            const dayBereaveHours = safeNum(wd?.bereavementHours)
            const dayUnpaidHours = safeNum(wd?.unpaidtimeHours)

            empVacationHours += dayVacHours
            empSickHours += daySickHours
            empHolidayHours += dayHolHours
            empBereavementHours += dayBereaveHours
            empUnpaidHours += dayUnpaidHours

            const analysis = analyzeDayCompliance(wd?.punches, wd?.date || wd?.startTime, dayTotalHours)

            let dayHasMealPenalty = false
            analysis.violations.forEach((v) => {
              if (v?.type?.startsWith('MEAL_PENALTY')) {
                if (!dayHasMealPenalty) {
                  dayHasMealPenalty = true
                  empViolationsCount++
                  empPenaltyCost += safeNum(v?.estimatedCostUsd, 0)
                }
              } else {
                empViolationsCount++
                empPenaltyCost += safeNum(v?.estimatedCostUsd, 0)
              }
            })

            return {
              date: wd?.date || wd?.startTime || '',
              dayName: wd?.dayName || wd?.dayOfWeek || '',
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
              isVacation: dayVacHours > 0 || !!wd?.vacation,
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
        } catch (err: any) {
          console.warn(`[RONOS Audit] Error consultando ponchadas de ${emp.firstName} ${emp.lastName}:`, err.message)
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
      } else if (allToastEmployees.length > 0 && empFullName.length >= 3) {
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

      const displayJobTitle = toastJobTitle || emp.title || emp.jobTitle || 'Colaborador'

      return {
        employeeUserId: empUserId,
        employeeId: empId,
        firstName: emp.firstName || '',
        lastName: emp.lastName || '',
        fullName: empFullName || `Empleado #${empUserId}`,
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
        mealPenaltyCount: days.reduce((count, d) => count + (d.violations.some(v => v.type.startsWith('MEAL_PENALTY')) ? 1 : 0), 0) || safeNum(emp.mealPenalty),
        brokenHours: broken,
        lockTimecard: !!emp.locktimecard,
        days,
        totalViolationsCount: empViolationsCount,
        totalEstimatedPenaltyCostUsd: Number(empPenaltyCost.toFixed(2)),
        toastEmployeeId,
        toastGuid,
        toastFullName,
        toastEmail,
        mappingType
      }
    }
  )

  const activeEmployeesCount = employeeTimecards.filter(e => e.totalWeeklyHours > 0 || (e.vacationHours || 0) > 0 || (e.sickHours || 0) > 0).length
  const totalChainHours = employeeTimecards.reduce((sum, e) => sum + e.totalWeeklyHours, 0)
  const totalRegularHours = employeeTimecards.reduce((sum, e) => sum + e.regularHours, 0)
  const totalOvertimeHours = employeeTimecards.reduce((sum, e) => sum + e.overtimeHours, 0)
  const totalDoubleTimeHours = employeeTimecards.reduce((sum, e) => sum + e.doubleTimeHours, 0)
  const totalBrokenTimecardsCount = employeeTimecards.filter(e => e.brokenHours).length

  let totalMealPenaltiesCount = 0
  let totalEstimatedPenaltyCostUsd = 0

  employeeTimecards.forEach((emp) => {
    emp?.days?.forEach((d) => {
      const dayMealViolations = (d?.violations || []).filter(v => v?.type?.startsWith('MEAL_PENALTY'))
      if (dayMealViolations.length > 0) {
        totalMealPenaltiesCount += 1
        totalEstimatedPenaltyCostUsd += safeNum(dayMealViolations[0]?.estimatedCostUsd, ESTIMATED_HOURLY_RATE)
      }
    })
  })

  const totalEstimatedOvertimeCostUsd = (totalOvertimeHours * ESTIMATED_HOURLY_RATE * 1.5) + (totalDoubleTimeHours * ESTIMATED_HOURLY_RATE * 2.0)
  const totalShiftsEstimated = Math.max(1, activeEmployeesCount * 5)
  const complianceScorePercent = Math.max(0, Math.min(100, Math.round(100 - ((totalMealPenaltiesCount / totalShiftsEstimated) * 100))))

  const result: RonosStoreAuditSummary = {
    storeId: storeMeta.tegStoreId,
    storeCode: storeMeta.tegCode,
    storeName: storeMeta.tegName,
    ronosCompanyId,
    weekId,
    startDate: selectedWeek?.startDate || '',
    endDate: selectedWeek?.endDate || '',
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
    employees: employeeTimecards.sort((a, b) => (b.totalWeeklyHours || 0) - (a.totalWeeklyHours || 0))
  }

  // Persistir en caché de Supabase de forma segura
  try {
    const timecardsToCache = employeeTimecards
      .filter(emp => emp.employeeUserId > 0)
      .map(emp => ({
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
      const { error } = await supabaseAdmin
        .from('ronos_employee_timecards_cache')
        .upsert(timecardsToCache, { onConflict: 'company_id,week_id,employee_user_id' })
      if (error) {
        console.warn('[RONOS Cache Upsert Error]:', error?.message || error)
      }
    }
  } catch (err: any) {
    console.warn('Error persisting timecards cache to Supabase:', err?.message)
  }

  storeAuditCache.set(cacheKey, { data: result, timestamp: Date.now() })
  return result
}

// ============================================================================
// AUDITORÍA DE CADENA COMPLETA (CHAIN-WIDE)
// ============================================================================

/**
 * Consulta la auditoría consolidada de toda la cadena (15 tiendas + Bodega)
 * para una semana específica (o la semana cerrada más reciente).
 * Lee de ronos_employee_timecards_cache o ejecuta live audit con análisis de ponchadas reales.
 */
export async function getRonosChainWideAudit(
  targetWeekId?: number,
  targetStartDate?: string,
  forceLive: boolean = false
): Promise<{
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
  selectedStartDate?: string
  stores: Array<{
    storeId: number
    storeCode: string
    storeName: string
    ronosCompanyId: number
    weekId: number
    activeEmployees: number
    totalHours: number
    overtimeHours: number
    doubleTimeHours: number
    mealPenalties: number
    brokenTimecards: number
    penaltyCostUsd: number
    complianceScore: number
  }>
}> {
  // 1. Determinar la fecha de inicio objetivo (targetStartDate)
  let resolvedStartDate = targetStartDate

  if (!resolvedStartDate && targetWeekId) {
    // Buscar la fecha de la semana en alguna tienda
    for (const store of RONOS_STORES_MAP) {
      const weeks = await getRonosWeeks(store.ronosCompanyId)
      const matching = weeks.find(w => w.weekId === targetWeekId)
      if (matching?.startDate) {
        resolvedStartDate = matching.startDate.substring(0, 10)
        break
      }
    }
  }

  // Si aún no hay fecha objetivo, obtener la semana cerrada más reciente de Lynwood (ID 34)
  if (!resolvedStartDate) {
    const lynwoodWeeks = await getRonosWeeks(34)
    if (lynwoodWeeks.length > 0) {
      const isWeek0Future = new Date(lynwoodWeeks[0]?.endDate || '').getTime() > Date.now()
      const defaultWeek = isWeek0Future && lynwoodWeeks.length > 1 ? lynwoodWeeks[1] : lynwoodWeeks[0]
      resolvedStartDate = defaultWeek?.startDate ? defaultWeek.startDate.substring(0, 10) : undefined
    }
  }

  // 2. Procesar las 16 tiendas en paralelo con control de concurrencia
  const storeAudits = await mapConcurrent(
    RONOS_STORES_MAP,
    4,
    async (store) => {
      try {
        const weeks = await getRonosWeeks(store.ronosCompanyId)
        if (!weeks || weeks.length === 0) return null

        let matchingWeek = resolvedStartDate
          ? weeks.find(w => w.startDate?.startsWith(resolvedStartDate!))
          : undefined

        if (!matchingWeek) {
          const isWeek0Future = new Date(weeks[0]?.endDate || '').getTime() > Date.now()
          matchingWeek = isWeek0Future && weeks.length > 1 ? weeks[1] : weeks[0]
        }

        if (!matchingWeek?.weekId) return null

        const storeWeekId = matchingWeek.weekId

        // Verificar si tenemos datos completos en caché
        if (!forceLive) {
          const { data: cached } = await supabaseAdmin
            .from('ronos_employee_timecards_cache')
            .select('regular_hours, overtime_hours, double_time_hours, meal_penalty_count, broken_hours')
            .eq('company_id', store.ronosCompanyId)
            .eq('week_id', storeWeekId)

          if (cached && cached.length > 0) {
            let storeHours = 0
            let storeOt = 0
            let storeDt = 0
            let storePenalties = 0
            let storeBroken = 0
            let activeCount = 0

            cached.forEach((r: any) => {
              if (!r) return
              const reg = safeNum(r?.regular_hours)
              const ot = safeNum(r?.overtime_hours)
              const dt = safeNum(r?.double_time_hours)
              const h = reg + ot + dt
              if (h > 0) {
                activeCount++
                storeHours += h
                storeOt += ot
                storeDt += dt
              }
              storePenalties += safeNum(r?.meal_penalty_count)
              if (r?.broken_hours) storeBroken++
            })

            const penaltyCost = storePenalties * ESTIMATED_HOURLY_RATE
            const shifts = Math.max(1, activeCount * 5)
            const compliance = Math.max(0, Math.min(100, Math.round(100 - ((storePenalties / shifts) * 100))))

            return {
              storeId: store.tegStoreId,
              storeCode: store.tegCode,
              storeName: store.tegName,
              ronosCompanyId: store.ronosCompanyId,
              weekId: storeWeekId,
              activeEmployees: activeCount,
              totalHours: Number(storeHours.toFixed(2)),
              overtimeHours: Number(storeOt.toFixed(2)),
              doubleTimeHours: Number(storeDt.toFixed(2)),
              mealPenalties: storePenalties,
              brokenTimecards: storeBroken,
              penaltyCostUsd: Number(penaltyCost.toFixed(2)),
              complianceScore: compliance
            }
          }
        }

        // Si no está en caché o se solicitó forzar actualización en vivo, auditar ponchadas reales
        const liveAudit = await getRonosStoreAudit(store.ronosCompanyId, storeWeekId)

        return {
          storeId: store.tegStoreId,
          storeCode: store.tegCode,
          storeName: store.tegName,
          ronosCompanyId: store.ronosCompanyId,
          weekId: storeWeekId,
          activeEmployees: liveAudit.activeEmployeesCount,
          totalHours: liveAudit.totalChainHours,
          overtimeHours: liveAudit.totalOvertimeHours,
          doubleTimeHours: liveAudit.totalDoubleTimeHours,
          mealPenalties: liveAudit.totalMealPenaltiesCount,
          brokenTimecards: liveAudit.totalBrokenTimecardsCount,
          penaltyCostUsd: liveAudit.totalEstimatedPenaltyCostUsd,
          complianceScore: liveAudit.complianceScorePercent
        }
      } catch (err: any) {
        console.error(`Error auditando tienda ${store.tegName}:`, err.message)
        return null
      }
    }
  )

  const validStores = storeAudits.filter((s): s is NonNullable<typeof s> => Boolean(s))

  const totalChainEmployees = validStores.reduce((acc, s) => acc + s.activeEmployees, 0)
  const totalChainHours = validStores.reduce((acc, s) => acc + s.totalHours, 0)
  const totalOvertimeHours = validStores.reduce((acc, s) => acc + s.overtimeHours, 0)
  const totalDoubleTimeHours = validStores.reduce((acc, s) => acc + s.doubleTimeHours, 0)
  const totalMealPenalties = validStores.reduce((acc, s) => acc + s.mealPenalties, 0)
  const totalBrokenTimecards = validStores.reduce((acc, s) => acc + s.brokenTimecards, 0)
  const totalPenaltyCostUsd = validStores.reduce((acc, s) => acc + s.penaltyCostUsd, 0)
  const totalOvertimeCostUsd = (totalOvertimeHours * ESTIMATED_HOURLY_RATE * 1.5) + (totalDoubleTimeHours * ESTIMATED_HOURLY_RATE * 2.0)

  return {
    totalStores: validStores.length,
    totalChainEmployees,
    totalActiveEmployees: totalChainEmployees,
    totalChainHours: Number(totalChainHours.toFixed(2)),
    totalOvertimeHours: Number(totalOvertimeHours.toFixed(2)),
    totalDoubleTimeHours: Number(totalDoubleTimeHours.toFixed(2)),
    totalMealPenalties,
    totalBrokenTimecards,
    totalPenaltyCostUsd: Number(totalPenaltyCostUsd.toFixed(2)),
    totalOvertimeCostUsd: Number(totalOvertimeCostUsd.toFixed(2)),
    selectedStartDate: resolvedStartDate,
    stores: validStores.sort((a, b) => b.totalHours - a.totalHours)
  }
}
