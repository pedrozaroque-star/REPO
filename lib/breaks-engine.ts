/**
 * @module breaks-engine
 * @description Motor optimizador universal de Inteligencia Artificial (Motor V30 Multi-Sucursal) para la programación
 * automática y auto-aprendizaje de descansos (Breaks de 10 min y Lunches de 30 min) en las 15 sucursales de Tacos Gavilan.
 * @businessRules
 * - Día laboral oficial de Tacos Gavilan: inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente. El turno PM inicia a las 5:00 PM.
 * - Cumplimiento estricto del Código Laboral de California (§ 512): el 1er Lunch debe iniciar antes de cumplir la 5ta hora (< 5.0h);
 *   turnos de hasta 12.0h exactas llevan 1 Lunch (con exención de 2do meal) y solo turnos > 12.0h generan 2do Lunch.
 * - Aislamiento Multi-Tienda + Memoria por Empleado (`store_id` + `employee_id` + `role` + `day_of_week`): cada sucursal aprende
 *   de forma independiente las preferencias exactas por empleado y cohorte de su propio General Manager, sin nombres fijos en código.
 * - Prioridad de Salida Anticipada: en arranque en frío (Cold Start), quienes salen más temprano van primero a Lunch, separando
 *   turnos cortos de apoyo (6.0h: 1 Lunch + 1 Break, y < 6.0h sin Lunch) para que no roben la primera ventana ni dejen 4.5h sin descanso.
 * - Escalera continua sin desproteger estaciones: 30 min entre Lunches en arranque en frío y 10 min entre Breaks de 10 min (cero solapamiento real),
 *   respetando al minuto las preferencias explícitas entrenadas por el gerente y conectando estaciones reales de `station_assignments`.
 * - General Manager excluido del conteo de cohortes y bloqueos de relevo operativo en tableta.
 * @dataFlow Recibe turnos del día (con `job_id` del turno priorizado y `station_name` opcional), proyección horaria de ventas (`operatingHours`)
 * y preferencias aprendidas (`break_manual_overrides`) → Retorna turnos enriquecidos con `breaks_schedule`.
 * @notes V30 Universal Multi-Store Upgrade:
 * - Eliminados los 21 nombres propios fijos de Slauson en `getShiftOperationalTieRank`; reemplazados por memoria exacta `employee_id`
 *   codificada de forma retrocompatible en `role` (`encodeLearnedRoleMeta`) + desempate universal por estación (`station_assignments`).
 * - Corregida codificación `encodeLearnedSlotMeta` (`10000 + hour*100 + half*50 + cohort`) compatible con turnos 24h (`00:00-05:59 AM`),
 *   entradas `:30` y 100% retrocompatible con registros V25 (`0..23`) y V28/V29 (`50..239`).
 * - Eliminada la reordenación destructiva de `_monotonicMeal0Pref` que pisaba ajustes manuales de Viernes/Sábado/Domingo en turnos de 6.0h.
 * - Reducido `WAVE_SAME_ROLE_REST_MS` de 20m a 10m (cero solapamiento real en breaks de 10m) para respetar escaleras continuas (ej. 1:20 -> 1:30 PM).
 * - Corregido `getPeakHoursForShift` (`endH = 16` en AM para que ventas de 5:00 PM no borren el rush de 11:00 AM - 2:00 PM), activada protección
 *   de rush en breaks de arranque en frío, corregido `getRequiredBreaks` (`h > 12` para 2do lunch) y eliminado el efecto `Tail-Push` en rebalanceos parciales.
 */

import { Shift } from '@/app/planificador/lib/types'
import { OperatingHour } from '@/lib/intelligence'

export type BreakBlock = {
    type: 'rest_10' | 'meal_30'
    start_time: string
    end_time: string
    status?: 'scheduled' | 'taken' | 'waived'
    is_manual?: boolean
}

export type LearnedPreference = {
    id?: number | string
    store_id?: string
    role: string
    employee_id?: string | number | null
    day_of_week: number
    break_type: string
    break_index: number
    offset_from_start_min: number
    shift_duration_min?: number | null
    peak_hour?: number | null
    updated_at?: string | null
    created_at?: string | null
}

export type MatchedLearnedPref = {
    offsetMin: number
    exactStartHour: boolean
    exactCohort: boolean
    exactDay: boolean
    matchedByEmployee: boolean
}

const EMP_ROLE_DELIM = '::emp:'

export function normalizeRoleString(raw?: string | null): string {
    if (!raw) return 'unknown'
    const base = String(raw).split(EMP_ROLE_DELIM)[0] || ''
    return (
        base
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim() || 'unknown'
    )
}

/**
 * Codifica de forma retrocompatible el rol canónico y el `employee_id` dentro del campo `role` (TEXT)
 * de `break_manual_overrides`, sin romper esquemas existentes ni filas históricas.
 */
export function encodeLearnedRoleMeta(roleKey: string, employeeId?: string | number | null): string {
    const cleanRole = normalizeRoleString(roleKey)
    if (employeeId !== null && employeeId !== undefined && String(employeeId).trim() !== '') {
        return `${cleanRole}${EMP_ROLE_DELIM}${String(employeeId).trim()}`
    }
    return cleanRole
}

export function decodeLearnedRoleMeta(
    rawRole?: string | null,
    explicitEmployeeId?: string | number | null
): { role: string; employeeId: string | null } {
    const str = String(rawRole || '')
    let rolePart = str
    let empPart: string | null = null
    const delimIdx = str.indexOf(EMP_ROLE_DELIM)
    if (delimIdx >= 0) {
        rolePart = str.slice(0, delimIdx)
        const extracted = str.slice(delimIdx + EMP_ROLE_DELIM.length).trim()
        if (extracted) empPart = extracted
    }
    if (explicitEmployeeId !== null && explicitEmployeeId !== undefined && String(explicitEmployeeId).trim() !== '') {
        empPart = String(explicitEmployeeId).trim()
    }
    return {
        role: normalizeRoleString(rolePart),
        employeeId: empPart
    }
}

/**
 * Resuelve de forma universal el título del puesto de un turno en las 15 sucursales:
 * Prioriza SIEMPRE el puesto asignado al turno (`shift.job_id` / `shift.toast_job_guid`) sobre el
 * puesto primario del empleado en Toast (`emp.job_references[0]`), evitando clasificar mal a personal multifuncional.
 */
export function resolveShiftRoleTitle(shift: any, emp?: any, jobs?: any[]): string {
    const jobList = Array.isArray(jobs) ? jobs : []

    if (shift?.job_id) {
        const shiftJob = jobList.find(
            (j: any) => j && (j.guid === shift.job_id || String(j.id) === String(shift.job_id))
        )
        if (shiftJob?.title) return String(shiftJob.title).trim()
    }

    if (shift?.toast_job_guid) {
        const toastJob = jobList.find((j: any) => j && j.guid === shift.toast_job_guid)
        if (toastJob?.title) return String(toastJob.title).trim()
    }

    if (shift?.job_title && normalizeRoleString(shift.job_title) !== 'unknown') {
        return String(shift.job_title).trim()
    }

    if (emp?.job_references && Array.isArray(emp.job_references) && emp.job_references.length > 0) {
        const jobRef = emp.job_references[0]
        if (jobRef?.title) return String(jobRef.title).trim()
        if (jobRef?.guid) {
            const empJob = jobList.find(
                (j: any) => j && (j.guid === jobRef.guid || String(j.id) === String(jobRef.guid))
            )
            if (empJob?.title) return String(empJob.title).trim()
        }
    }

    return 'cook'
}

export function resolveShiftIsLeader(roleTitle?: string | null): boolean {
    const clean = normalizeRoleString(roleTitle)
    return (
        clean.includes('manager') ||
        clean.includes('gerente') ||
        clean.includes('leader') ||
        clean.includes('shift') ||
        clean.includes('lead') ||
        clean.includes('assistant') ||
        clean.includes('asistente') ||
        clean.includes('asst') ||
        clean.includes('encargado') ||
        clean.includes('supervisor')
    )
}

/**
 * Calcula el índice específico por tipo de descanso ('meal_30' o 'rest_10')
 * ordenando primero cronológicamente los descansos del turno.
 */
export function getTypeSpecificBreakIndex(breaks: BreakBlock[], targetIdx: number): number {
    if (!Array.isArray(breaks) || targetIdx < 0 || targetIdx >= breaks.length) return 0
    const targetType = breaks[targetIdx].type
    const indexed = breaks.map((b, idx) => ({ b, idx, ms: new Date(b.start_time).getTime() }))
    indexed.sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.idx - b.idx))
    let typeCounter = 0
    for (const item of indexed) {
        if (item.idx === targetIdx) return typeCounter
        if (item.b.type === targetType) typeCounter++
    }
    return 0
}

/**
 * Codifica la hora local de inicio (0-23), bandera de media hora (`:30`) y posición en el cohort (0-49)
 * en un entero compatible con `peak_hour` (`10000 + hour*100 + halfFlag*50 + cohortIdx`).
 * Mantiene compatibilidad total de lectura con V28/V29 (`50..239`) y V25 (`0..23`).
 */
export function encodeLearnedSlotMeta(shiftStartMs: number, cohortIdx: number = 0): number {
    const { hour, minute } = getLocalHourMinute(shiftStartMs)
    const halfFlag = minute >= 25 && minute < 55 ? 1 : 0
    const safeCohort = Math.min(Math.max(0, Math.round(cohortIdx || 0)), 49)
    return 10000 + hour * 100 + halfFlag * 50 + safeCohort
}

export function decodeLearnedSlotMeta(peakHour?: number | null): {
    startHour: number | null
    halfHour: number
    cohortIdx: number
    isV30: boolean
} {
    if (peakHour === null || peakHour === undefined || isNaN(Number(peakHour))) {
        return { startHour: null, halfHour: 0, cohortIdx: 0, isV30: false }
    }
    const val = Math.round(Number(peakHour))
    if (val >= 10000 && val < 13000) {
        const offset = val - 10000
        const startHour = Math.floor(offset / 100)
        const rem = offset % 100
        const halfHour = rem >= 50 ? 1 : 0
        const cohortIdx = rem % 50
        return { startHour, halfHour, cohortIdx, isV30: true }
    }
    if (val >= 50) {
        return { startHour: Math.floor(val / 10), halfHour: 0, cohortIdx: val % 10, isV30: false }
    }
    return { startHour: val, halfHour: 0, cohortIdx: 0, isV30: false }
}

type RoleCategory = 'leader' | 'foh' | 'boh'

type GlobalSlot = {
    type: 'rest_10' | 'meal_30'
    startMs: number
    endMs: number
    roleKey: string
    category: RoleCategory
    empId: string | number | null
    shiftId?: string | number | null
    isGm?: boolean
}

type WaveMode = 'normal' | 'relaxed' | 'off'

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTES OPERATIVAS UNIVERSALES TACOS GAVILAN (15 SUCURSALES)
// ─────────────────────────────────────────────────────────────────────────────

const HEAT_MEAL = 0.78
const HEAT_REST = 0.70

export const GAP_RR_MS = 90 * 60_000
export const GAP_MM_MS = 120 * 60_000
export const GAP_MR_MS = 45 * 60_000

const MIN_GAP_BREAKS_MS = 10 * 60_000
const MIN_GAP_LUNCHES_MS = 30 * 60_000

const WAVE_SAME_ROLE_MEAL_MS = 30 * 60_000
const WAVE_LEADER_MEAL_MS = 30 * 60_000
// Un break de 10m separado por 10m de inicio tiene 0m de solapamiento real (ej. 1:20-1:30 y 1:30-1:40)
const WAVE_SAME_ROLE_REST_MS = 10 * 60_000
const WAVE_SAME_CAT_REST_MS = 10 * 60_000

const WAVE_MIN_MEAL_MS = 30 * 60_000
const WAVE_MIN_REST_MS = 10 * 60_000

const SLOT_STEP_MS = 10 * 60_000
const H_MIN_START_MED = 1.0
const H_MIN_START_LONG = 1.0

function hMinStart(durationHrs: number): number {
    if (durationHrs <= 6) return 0.75
    if (durationHrs <= 8) return H_MIN_START_MED
    return H_MIN_START_LONG
}

function hMinStartRest(durationHrs: number): number {
    if (durationHrs <= 6) return 0.75
    return 1.0
}

const H_END_BUFFER = 1.0
// Ley CA: el 1er meal debe INICIAR antes de cumplirse la 5ta hora (< 5.0h = 300m).
// H_FIRST_MEAL_MAX = 5.34h (320m) permite que `wEndMs - 30m` alcance hasta +290m (4h 50m).
const H_FIRST_MEAL_MAX = 5.34
const H_SECOND_MEAL_START = 7.0
const H_SECOND_MEAL_END = 10.5

const ms = (mins: number) => mins * 60_000
const toIso = (d: Date) => d.toISOString()
const midMs = (startMs: number, durMs: number) => startMs + durMs / 2

function sortChron<T extends { start_time: string }>(arr: T[]): T[] {
    return [...arr].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
}

function getRoleKey(shift: any): string {
    return normalizeRoleString(shift?.job_title || shift?.job_id || 'unknown')
}

export function isGeneralManagerRole(rk: string): boolean {
    const clean = normalizeRoleString(rk)
    return (
        (clean.includes('manager') || clean.includes('gerente')) &&
        !clean.includes('asst') &&
        !clean.includes('assist') &&
        !clean.includes('asistente') &&
        !clean.includes('shift')
    )
}

export function getRoleCategory(rk: string): RoleCategory {
    const clean = normalizeRoleString(rk)
    if (resolveShiftIsLeader(clean)) return 'leader'
    if (
        clean.includes('cashier') ||
        clean.includes('cajera') ||
        clean.includes('cajero') ||
        clean.includes('drive') ||
        clean.includes('register') ||
        clean.includes('front')
    ) {
        return 'foh'
    }
    return 'boh'
}

export function getWallClockDurationHours(startMs: number, endMs: number): number {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
    const rawHrs = (endMs - startMs) / 3_600_000
    const s = getLocalHourMinute(startMs)
    const e = getLocalHourMinute(endMs)
    const sMin = s.hour * 60 + s.minute
    let eMin = e.hour * 60 + e.minute
    if (eMin <= sMin && rawHrs > 0.5) eMin += 24 * 60
    const wallHrs = (eMin - sMin) / 60
    if (Math.abs(rawHrs - wallHrs) >= 0.9 && Math.abs(rawHrs - wallHrs) <= 1.1 && wallHrs > 0 && rawHrs < 20) {
        return wallHrs
    }
    return rawHrs
}

export function isShortSixHourSupportShift(startMs: number, endMs: number): boolean {
    const h = getWallClockDurationHours(startMs, endMs)
    return h >= 6.0 && h <= 6.25
}

export function getRequiredBreaks(startMs: number, endMs: number): Omit<BreakBlock, 'start_time' | 'end_time'>[] {
    const h = getWallClockDurationHours(startMs, endMs)
    const result: Omit<BreakBlock, 'start_time' | 'end_time'>[] = []
    // Código Laboral de CA (§ 512) + Regla Operativa Tacos Gavilan:
    // - 3.5h a 6.0h: 1 break de 10m
    // - >6.0h a 10.0h: 2 breaks de 10m
    // - >10.0h a 14.0h: 3 breaks de 10m
    // - >=6.0h: 1er Lunch de 30m
    // - >12.0h (excediendo 12 horas): 2do Lunch de 30m (turnos de hasta 12.0h exactas llevan 1 Lunch + 3 Breaks)
    const restCount = h > 14 ? 4 : h > 10 ? 3 : h > 6 ? 2 : h >= 3.5 ? 1 : 0
    for (let i = 0; i < restCount; i++) result.push({ type: 'rest_10' })
    if (h >= 6) result.push({ type: 'meal_30' })
    if (h > 12) result.push({ type: 'meal_30' })
    return result
}

// ─────────────────────────────────────────────────────────────────────────────
//  HORARIO LOCAL Y DÍA LABORAL CALIFORNIA (6:00 AM - 5:59 AM, DST-SAFE)
// ─────────────────────────────────────────────────────────────────────────────

const LA_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
})

function getLaCalendarParts(tMs: number): {
    year: number
    month: number
    day: number
    weekday: number
    hour: number
    minute: number
} {
    const parts = LA_PARTS_FORMATTER.formatToParts(new Date(tMs))
    let year = 1970, month = 1, day = 1, hour = 0, minute = 0, dayStr = 'Sun'
    for (const p of parts) {
        if (p.type === 'year') year = parseInt(p.value, 10)
        else if (p.type === 'month') month = parseInt(p.value, 10)
        else if (p.type === 'day') day = parseInt(p.value, 10)
        else if (p.type === 'hour') hour = parseInt(p.value, 10)
        else if (p.type === 'minute') minute = parseInt(p.value, 10)
        else if (p.type === 'weekday') dayStr = p.value
    }
    if (hour === 24) hour = 0
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return { year, month, day, weekday: map[dayStr] ?? 0, hour, minute }
}

export function getLocalDayOfWeek(tMs: number): number {
    const parts = getLaCalendarParts(tMs)
    // Día laboral Tacos Gavilan: turnos que inician entre 00:00 y 05:59 AM pertenecen al día laboral previo
    if (parts.hour < 6) {
        return (parts.weekday + 6) % 7
    }
    return parts.weekday
}

export function getLocalHourMinute(tMs: number): { hour: number; minute: number } {
    const { hour, minute } = getLaCalendarParts(tMs)
    return { hour, minute }
}

/**
 * Convierte una hora extendida del día laboral (`6..29`, donde `24=00:00`, `25=01:00`, etc.)
 * a timestamp epoch exacto en `America/Los_Angeles`, inmune a cambios de horario DST y entradas post-medianoche.
 */
export function getBusinessDayHourEpochMs(shiftStartMs: number, extendedHour: number, minute: number = 0): number {
    const startParts = getLaCalendarParts(shiftStartMs)
    const bizDayOffset = startParts.hour < 6 ? -1 : 0
    const extraDays = Math.floor(extendedHour / 24)
    const targetHour = ((extendedHour % 24) + 24) % 24

    // Aproximación inicial asumiendo UTC-8 y corrección iterativa exacta contra America/Los_Angeles
    let guessMs = Date.UTC(
        startParts.year,
        startParts.month - 1,
        startParts.day + bizDayOffset + extraDays,
        targetHour + 8,
        minute,
        0,
        0
    )

    for (let iter = 0; iter < 3; iter++) {
        const actual = getLaCalendarParts(guessMs)
        const targetDayUtc = Date.UTC(startParts.year, startParts.month - 1, startParts.day + bizDayOffset + extraDays)
        const actualDayUtc = Date.UTC(actual.year, actual.month - 1, actual.day)
        const diffDaysMin = Math.round((targetDayUtc - actualDayUtc) / 86_400_000) * 1440
        const diffMin = diffDaysMin + (targetHour - actual.hour) * 60 + (minute - actual.minute)
        if (diffMin === 0) break
        guessMs += diffMin * 60_000
    }
    return guessMs
}

function normalizeOperatingHours(rawHours: any): OperatingHour[] {
    if (!rawHours) return []
    const arr = Array.isArray(rawHours) ? rawHours : (rawHours.hours || rawHours.operatingHours || [])
    if (!Array.isArray(arr)) return []

    return arr
        .map((oh: any) => {
            if (!oh) return null
            let h = oh.hour
            if (typeof h === 'string') {
                const parsed = parseInt(h.split(':')[0], 10)
                if (!isNaN(parsed)) h = parsed
            }
            const sales = Number(oh.projected_sales ?? oh.sales ?? oh.total_sales ?? oh.net_sales ?? oh.demand ?? 0)
            const tickets = Number(oh.projected_tickets ?? oh.tickets ?? oh.orders ?? 0)
            if (typeof h !== 'number' || isNaN(h)) return null
            return {
                ...oh,
                hour: h,
                projected_sales: isNaN(sales) ? 0 : sales,
                projected_tickets: isNaN(tickets) ? 0 : tickets
            } as OperatingHour
        })
        .filter(Boolean) as OperatingHour[]
}

function getPeakHoursForShift(
    shiftStartMs: number,
    shiftEndMs: number,
    operatingHours?: OperatingHour[]
): { start: number; end: number } {
    const { hour: startHour } = getLocalHourMinute(shiftStartMs)
    // Turno PM oficial inicia a las 5:00 PM (17h). Turnos que inician antes de las 3:00 PM evalúan primero el rush de comida AM.
    const isAm = startHour >= 6 && startHour < 15

    if (!operatingHours || operatingHours.length === 0) {
        return isAm ? { start: 11, end: 14 } : { start: 18, end: 20 }
    }

    // `endH = 16` en AM impide que las ventas de las 5:00 PM (17h) eclipsen el rush de almuerzo (11:00 AM - 2:00 PM)
    const startH = isAm ? 6 : 17
    const endH = isAm ? 16 : 29

    let maxSales = -1
    let peakHour = isAm ? 12 : 19

    for (const oh of operatingHours) {
        const h = oh.hour
        const s = oh.projected_sales || 0
        if (h >= startH && h <= endH && s > maxSales) {
            maxSales = s
            peakHour = h
        }
    }

    if (maxSales <= 0) {
        return isAm ? { start: 11, end: 14 } : { start: 18, end: 20 }
    }

    let pStart = peakHour
    let pEnd = peakHour + 1
    const threshold = maxSales * 0.85

    const prevOh = operatingHours.find(o => o.hour === peakHour - 1 && o.hour >= startH)
    const nextOh = operatingHours.find(o => o.hour === peakHour + 1 && o.hour <= endH)
    const next2Oh = operatingHours.find(o => o.hour === peakHour + 2 && o.hour <= endH)

    if (prevOh && (prevOh.projected_sales || 0) >= threshold) {
        pStart = peakHour - 1
    }
    if (nextOh && (nextOh.projected_sales || 0) >= threshold) {
        pEnd = peakHour + 2
        if (next2Oh && (next2Oh.projected_sales || 0) >= threshold && (pEnd - pStart) < 3) {
            pEnd = peakHour + 3
        }
    }

    if (pEnd - pStart < 2) {
        if (pStart > startH) pStart -= 1
        else pEnd += 1
    }

    return { start: pStart, end: pEnd }
}

function buildHeatFn(
    operatingHours?: OperatingHour[],
    shiftStartMs?: number,
    shiftEndMs?: number
): (tMs: number) => number {
    const MOCK: Record<number, number> = {
        0: 0.25, 1: 0.15, 2: 0.10, 3: 0.05, 4: 0.05, 5: 0.05,
        6: 0.08, 7: 0.15, 8: 0.25, 9: 0.35, 10: 0.55,
        11: 0.85, 12: 1.00, 13: 0.95, 14: 0.70, 15: 0.45,
        16: 0.50, 17: 0.65, 18: 0.90, 19: 1.00, 20: 0.92,
        21: 0.80, 22: 0.60, 23: 0.40
    }

    let map: Record<number, number> = {}
    let useMock = true

    if (operatingHours && operatingHours.length > 0) {
        let relevantHours = operatingHours
        if (shiftStartMs !== undefined && shiftEndMs !== undefined) {
            const marginStart = shiftStartMs - ms(60)
            const marginEnd = shiftEndMs + ms(60)
            relevantHours = operatingHours.filter(oh => {
                const ohStartMs = getBusinessDayHourEpochMs(shiftStartMs, oh.hour, 0)
                const ohEndMs = ohStartMs + ms(60)
                return ohEndMs > marginStart && ohStartMs < marginEnd
            })
            if (relevantHours.length === 0) relevantHours = operatingHours
        }

        const vals = relevantHours.map(h => (h.projected_sales || 0) + (h.projected_tickets || 0) * 18)
        const maxVal = Math.max(...vals, 1)
        const minVal = Math.min(...vals, 0)
        const range = maxVal - minVal

        if (maxVal > 10 && range > 5) {
            useMock = false
            operatingHours.forEach(oh => {
                const raw = (oh.projected_sales || 0) + (oh.projected_tickets || 0) * 18
                const normalized = Math.max(0, Math.min(1, (raw - minVal) / range))
                map[oh.hour % 24] = Math.round(normalized * 100) / 100
            })
        }
    }
    if (useMock) map = MOCK

    return (tMs: number): number => {
        const { hour: h, minute: m } = getLocalHourMinute(tMs)
        const frac = m / 60
        const cur = map[h] ?? 0.3
        const nxt = map[(h + 1) % 24] ?? cur
        return cur + (nxt - cur) * frac
    }
}

function spanHeat(sMs: number, eMs: number, getHeat: (t: number) => number): number {
    let worst = 0
    for (let t = sMs; t < eMs; t += ms(5)) {
        const h = getHeat(t)
        if (h > worst) worst = h
    }
    return worst
}

function stripAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Resuelve la estación operativa principal de un turno a partir de las filas de `station_assignments`
 * (`assignment_date`, `main_station`, `sub_position`, `station_group`), filtrando por bloque AM/PM
 * y priorizando estaciones operativas reales sobre tareas secundarias (`ACTIVIDADES EXTRA`, `LIMPIEZA`).
 */
export function resolveShiftStationSummary(shift: any, stationRows?: any[]): string {
    if (!shift || !Array.isArray(stationRows) || stationRows.length === 0) {
        return String(shift?.station_name || shift?.main_station || shift?.sub_position || '')
    }
    const empId = shift.employee_id != null ? String(shift.employee_id) : ''
    if (!empId) return ''

    const shiftDate = shift.shift_date ? String(shift.shift_date) : ''
    let matches = stationRows.filter((r: any) => {
        if (String(r?.employee_id || '') !== empId) return false
        if (shiftDate && r?.assignment_date && String(r.assignment_date) !== shiftDate) return false
        return true
    })
    if (matches.length === 0) return String(shift?.station_name || '')

    const sMs = shift.start_time ? new Date(shift.start_time).getTime() : NaN
    if (!isNaN(sMs)) {
        const { hour } = getLocalHourMinute(sMs)
        const suffix = hour < 15 ? '_AM' : '_PM'
        const suffixMatches = matches.filter((r: any) =>
            String(r?.sub_position || '').toUpperCase().endsWith(suffix)
        )
        if (suffixMatches.length > 0) matches = suffixMatches
    }

    const nonExtra = matches.filter((r: any) => {
        const msName = stripAccents(String(r?.main_station || '').toLowerCase())
        const grp = String(r?.station_group || '').toLowerCase()
        return !msName.startsWith('actividades extra') && grp !== 'leadership'
    })
    const pool = nonExtra.length > 0 ? nonExtra : matches

    const scoreStationRow = (r: any): number => {
        const name = stripAccents(String(r?.main_station || r?.sub_position || '').toLowerCase())
        if (name.includes('cubrir descansos')) return 100
        if (name.includes('caja 1') || name.includes('ventana 1')) return 95
        if (name.includes('tacos') || name.includes('carnes')) return 94
        if (name.includes('caja 2') || name.includes('caja 3') || name.includes('ventana 2')) return 90
        if (name.includes('burritos') || name.includes('tortas') || name.includes('tortillas')) return 88
        if (name.includes('uber') || name.includes('salsas')) return 85
        if (name.includes('preparacion')) return 82
        if (name.includes('entrega') || name.includes('limpieza')) return 50
        return 60
    }

    const sorted = [...pool].sort((a, b) => scoreStationRow(b) - scoreStationRow(a))
    return String(sorted[0]?.main_station || sorted[0]?.sub_position || '')
}

/**
 * Desempate operativo 100% Universal basado exclusivamente en la estación asignada (`station_assignments`),
 * sin ningún nombre de empleado fijo en código. Funciona de forma idéntica en las 15 sucursales:
 * - `CUBRIR DESCANSOS` sale primero para regresar fresco a relevar a todas las demás estaciones.
 * - Estaciones de apoyo/secundarias (`PREPARACION`, `Uber + Salsas`, `Caja 2`, `TORTAS`, `BURRITOS`) salen antes
 *   que las estaciones ancla primarias (`Caja 1 / Salón`, `Ventana 1`, `TACOS`, `CARNES`).
 */
export function getShiftOperationalTieRank(shift: any): number {
    const rawStation = String(shift?.station_name || shift?.main_station || shift?.sub_position || '')
    const station = stripAccents(rawStation.toLowerCase()).trim()
    if (!station) return 50

    if (station.includes('cubrir descansos')) return 10
    if (station.includes('preparacion') || station.includes('prep')) return 15
    if (station.includes('uber') || station.includes('delivery') || station.includes('salsas') || station.includes('limpieza') || station.includes('entrega')) return 18
    if (station.includes('caja 3') || station.includes('caja 2') || station.includes('cashier 2') || station.includes('ventana 2')) return 22
    if (station.includes('tortillas') || station.includes('tortas') || station.includes('mulitas') || station.includes('quesadillas')) return 24
    if (station.includes('burritos')) return 28
    if (station.includes('caja 1') || station.includes('cashier 1') || station.includes('ventana 1') || station.includes('drive')) return 32
    if (station.includes('tacos') || station.includes('carnes') || station.includes('parrilla') || station.includes('grill')) return 36

    return 50
}

function getCohortGroupKey(s: any): string {
    const sMs = new Date(s.start_time).getTime()
    const eMs = s._effEndMs ?? new Date(s.end_time).getTime()
    const rk = getRoleKey(s)
    const cat = getRoleCategory(rk)
    if (isGeneralManagerRole(rk)) {
        return `gm|${s._uid || s.id || s.employee_id || sMs}`
    }
    const durHrs = getWallClockDurationHours(sMs, eMs)
    // Turnos cortos sin lunch (< 6.0h) nunca deben desplazar el _cohortIdx de turnos con lunch
    if (durHrs < 6.0) {
        const block = Math.floor(sMs / ms(30))
        return `nomeal|${block}|${rk}`
    }
    if (cat === 'leader') {
        const { hour } = getLocalHourMinute(sMs)
        const period = hour < 14 ? 'am_leader' : 'pm_leader'
        return `${period}|leader`
    }
    const block = Math.floor(sMs / ms(30))
    return `${block}|${rk}`
}

function compareCohortMembers(a: any, b: any): number {
    const rkA = getRoleKey(a)
    const rkB = getRoleKey(b)
    const catA = getRoleCategory(rkA)

    if (catA === 'leader') {
        const isAsstA = rkA.includes('asst') || rkA.includes('assistant') || rkA.includes('asistente') || (rkA.includes('manager') && !rkA.includes('shift'))
        const isAsstB = rkB.includes('asst') || rkB.includes('assistant') || rkB.includes('asistente') || (rkA.includes('manager') && !rkB.includes('shift'))
        if (isAsstA !== isAsstB) return isAsstA ? 1 : -1
    }

    const sMsA = new Date(a.start_time).getTime()
    const sMsB = new Date(b.start_time).getTime()
    const eMsA = a._effEndMs ?? new Date(a.end_time).getTime()
    const eMsB = b._effEndMs ?? new Date(b.end_time).getTime()

    // Turnos cortos de apoyo de 6.0h (1 Lunch + 1 Break) no deben robar cohort 0 (la 1ra hora de entrada)
    // a los turnos completos de 7h-10h, evitando dejar al apoyo 4.5h seguidas con un solo break.
    const short6A = isShortSixHourSupportShift(sMsA, eMsA)
    const short6B = isShortSixHourSupportShift(sMsB, eMsB)
    if (short6A !== short6B) return short6A ? 1 : -1

    if (eMsA !== eMsB) return eMsA - eMsB
    if (sMsA !== sMsB) return sMsA - sMsB
    const tieA = getShiftOperationalTieRank(a)
    const tieB = getShiftOperationalTieRank(b)
    if (tieA !== tieB) return tieA - tieB
    return String(a.employee_id || a.id || '').localeCompare(String(b.employee_id || b.id || ''))
}

export function assignCohorts(shifts: any[]): void {
    const groups = new Map<string, any[]>()
    for (const s of shifts) {
        const key = getCohortGroupKey(s)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(s)
    }
    for (const group of groups.values()) {
        group.sort(compareCohortMembers)
        group.forEach((s, i) => {
            s._cohortIdx = i
            s._cohortSize = group.length
        })
    }
}

/**
 * Helper compartido por UI (`/descansos`) y Backend para calcular exactamente el mismo `cohortIdx`
 * de un turno específico frente a los turnos activos del día.
 */
export function computeCohortIndexForShift(targetShift: any, allActiveShifts: any[]): number {
    if (!targetShift || !Array.isArray(allActiveShifts) || allActiveShifts.length === 0) return 0
    const targetKey = getCohortGroupKey(targetShift)
    if (targetKey.startsWith('gm|')) return 0
    const group = allActiveShifts.filter(s => getCohortGroupKey(s) === targetKey)
    group.sort(compareCohortMembers)
    const idx = group.findIndex(s =>
        (targetShift.id && s.id === targetShift.id) ||
        (targetShift._uid && s._uid === targetShift._uid)
    )
    return idx >= 0 ? idx : 0
}

function getShiftPeriodBucket(startHour: number): 'late_night' | 'am' | 'mid' | 'pm' {
    if (startHour < 6) return 'late_night'
    if (startHour < 12) return 'am'
    if (startHour < 15) return 'mid'
    return 'pm'
}

export function findBestLearnedPref(
    learnedPrefs: LearnedPreference[],
    rk: string,
    dayOfWeek: number,
    breakType: 'meal_30' | 'rest_10',
    typeBreakIndex: number,
    shiftStartMs: number,
    shiftEndMs: number,
    cohortIdx: number,
    shiftEmployeeId?: string | number | null
): MatchedLearnedPref | null {
    if (!learnedPrefs || learnedPrefs.length === 0) return null

    const cleanRk = normalizeRoleString(rk)
    const cleanShiftEmpId =
        shiftEmployeeId !== null && shiftEmployeeId !== undefined && String(shiftEmployeeId).trim() !== ''
            ? String(shiftEmployeeId).trim()
            : null

    const shiftDurMin = Math.round(getWallClockDurationHours(shiftStartMs, shiftEndMs) * 60)
    const isNoMealShift = shiftDurMin <= 330
    const isSixHourShift = shiftDurMin > 330 && shiftDurMin <= 375
    const isShortShift = shiftDurMin <= 375
    const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs)
    const startHalfHour = startMin >= 25 && startMin < 55 ? 1 : 0
    const shiftPeriod = getShiftPeriodBucket(startHour)
    const minEndClearance = breakType === 'meal_30' ? 35 : 15

    type ScoredCandidate = {
        pref: LearnedPreference
        score: number
        pHour: number | null
        pHalfHour: number
        pCohort: number
        isV30: boolean
        sameEmp: boolean
        tsMs: number
    }

    const candidates: ScoredCandidate[] = []

    for (const p of learnedPrefs) {
        const { role: pRole, employeeId: pEmpId } = decodeLearnedRoleMeta(p.role, p.employee_id)
        if (pRole !== cleanRk) continue
        if (p.break_type !== breakType) continue

        const pDur = p.shift_duration_min ? Number(p.shift_duration_min) : null
        // Filtro estricto por cubeta de duración (incluyendo meal_30 en turnos de 6.0h vs >=6.5h)
        if (isNoMealShift) {
            if (pDur === null || pDur > 330) continue
        } else if (isSixHourShift) {
            if (pDur === null || pDur <= 330 || pDur > 375) continue
        } else {
            if (pDur !== null && pDur <= 375) continue
        }

        if (p.offset_from_start_min < 30 || p.offset_from_start_min > shiftDurMin - minEndClearance) {
            continue
        }
        if (breakType === 'meal_30' && typeBreakIndex === 0 && p.offset_from_start_min > 290) {
            continue
        }

        const { startHour: pHour, halfHour: pHalfHour, cohortIdx: pCohort, isV30 } = decodeLearnedSlotMeta(p.peak_hour)
        const sameEmp = Boolean(cleanShiftEmpId && pEmpId && cleanShiftEmpId === pEmpId)

        // Si un override es específico de OTRO empleado distinto en el mismo día, no robar su preferencia personal
        // cuando ya tenemos preferencias por empleado; permitir solo como respaldo genérico de cohorte con menor puntaje.
        if (!sameEmp && breakType === 'meal_30' && pHour !== null && pCohort !== cohortIdx && p.offset_from_start_min >= 175) {
            continue
        }

        if (p.break_index !== typeBreakIndex) {
            const isLegacySingleMeal =
                pHour === null &&
                breakType === 'meal_30' &&
                typeBreakIndex === 0 &&
                shiftDurMin <= 600 &&
                p.break_index <= 2
            if (!isLegacySingleMeal) continue
        }

        if (pHour !== null) {
            const pPeriod = getShiftPeriodBucket(pHour)
            if (pPeriod !== shiftPeriod) continue
            if (Math.abs(pHour - startHour) > 1) continue
        } else {
            if (p.day_of_week !== dayOfWeek) continue
            if (breakType === 'rest_10' && !isShortShift) {
                if (typeBreakIndex === 0 && p.offset_from_start_min > shiftDurMin * 0.62) continue
                if (typeBreakIndex === 1 && p.offset_from_start_min < shiftDurMin * 0.48) continue
            }
        }

        let score = 0
        if (sameEmp && p.day_of_week === dayOfWeek && pHour !== null && Math.abs(pHour - startHour) === 0) {
            // Prioridad #1 Absoluta: Mismo empleado + mismo día + misma hora de entrada
            score += 12000
            if (!isV30 || pHalfHour === startHalfHour) score += 300
        } else if (sameEmp && p.day_of_week === dayOfWeek) {
            score += 9500
        } else if (p.day_of_week === dayOfWeek) {
            score += 2500
            if (pEmpId && cleanShiftEmpId && pEmpId !== cleanShiftEmpId) {
                // Fue guardado para otro compañero específico; solo sirve de plantilla si coincide exactamente el cohort
                if (pCohort !== cohortIdx) continue
                score -= 400
            }
        } else if (sameEmp && pHour !== null && Math.abs(pHour - startHour) === 0) {
            // Mismo empleado trabajando el mismo turno en un día nuevo de la semana
            score += 1800
        } else if (!pEmpId && pHour !== null && Math.abs(pHour - startHour) === 0 && pCohort === cohortIdx) {
            score += 900
        } else {
            continue
        }

        if (pHour !== null) {
            score += 1000 - Math.abs(pHour - startHour) * 350
            if (sameEmp) {
                score += 600
            } else if (pCohort === cohortIdx) {
                score += 600
            } else {
                score += Math.max(0, 180 - Math.abs(pCohort - cohortIdx) * 100)
            }
        }

        if (pDur !== null) {
            score -= Math.abs(pDur - shiftDurMin) * 1.5
            if (breakType === 'rest_10' && (shiftDurMin >= 605) !== (pDur >= 605)) {
                score -= 500
            }
        }

        const prefTs = p.updated_at || p.created_at
        const tsMs = prefTs ? new Date(String(prefTs)).getTime() : 0
        if (prefTs && String(prefTs) > '2026-10-20T21:42:00') {
            score += 600
        }

        candidates.push({
            pref: p,
            score,
            pHour,
            pHalfHour,
            pCohort,
            isV30,
            sameEmp,
            tsMs: isNaN(tsMs) ? 0 : tsMs
        })
    }

    if (candidates.length === 0) return null

    candidates.sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.5) return b.score - a.score
        return b.tsMs - a.tsMs
    })
    const best = candidates[0]

    let adjustedOffset = best.pref.offset_from_start_min
    const staggerStep = breakType === 'meal_30' ? 30 : 10

    // Si coincidió con la preferencia exacta del propio empleado, NUNCA extrapolar ni desplazar su hora entrenada
    if (!best.sameEmp) {
        if (best.pHour !== null) {
            if (best.pCohort !== cohortIdx) {
                const extrapolated = adjustedOffset + (cohortIdx - best.pCohort) * staggerStep
                // No extrapolar un lunch pre-peak dentro de la hora pico (>150m)
                if (breakType === 'meal_30' && adjustedOffset <= 120 && extrapolated > 150) {
                    return null
                }
                adjustedOffset = extrapolated
            }
        } else if (cohortIdx > 0) {
            adjustedOffset += cohortIdx * staggerStep
        }
    }

    const minAllowedOffset = best.sameEmp ? 30 : 45
    adjustedOffset = Math.max(minAllowedOffset, Math.min(shiftDurMin - minEndClearance, adjustedOffset))

    return {
        offsetMin: adjustedOffset,
        exactStartHour: best.pHour !== null && Math.abs(best.pHour - startHour) <= 1,
        exactCohort: best.sameEmp || (best.pHour !== null && best.pCohort === cohortIdx),
        exactDay: best.pref.day_of_week === dayOfWeek,
        matchedByEmployee: best.sameEmp
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT PRINCIPAL — MOTOR V30 UNIVERSAL
// ─────────────────────────────────────────────────────────────────────────────

export function scheduleBreaksWithDemand(
    shifts: Shift[],
    rawOperatingHours: OperatingHour[],
    learnedPrefs: LearnedPreference[] = []
): Shift[] {
    const operatingHours = normalizeOperatingHours(rawOperatingHours)
    let getHeat = buildHeatFn(operatingHours)

    const augmented: any[] = shifts.map((s, idx) => {
        const sMs = new Date(s.start_time).getTime()
        const rawEMs = new Date(s.end_time).getTime()
        const rawDurHrs = getWallClockDurationHours(sMs, rawEMs)
        const effEndMs = rawDurHrs >= 15 ? sMs + ms(60 * Math.max(8, Math.min(10, rawDurHrs - 12))) : rawEMs
        const durHrs = getWallClockDurationHours(sMs, effEndMs)
        const rawManual = sortChron<BreakBlock>(
            ((s.breaks_schedule || []) as BreakBlock[]).filter((b: BreakBlock) => b && b.is_manual)
        )
        const validManual: BreakBlock[] = []
        if (durHrs >= 3.5) {
            for (const b of rawManual) {
                const bStart = new Date(b.start_time).getTime()
                const bEnd = new Date(b.end_time).getTime()
                // Respetar siempre los descansos manuales confirmados por el gerente mientras estén dentro del turno y sin solaparse entre sí
                if (bStart < sMs + ms(10) || bEnd > effEndMs - ms(5)) continue
                const overlapsPrev = validManual.some(prev => {
                    const pStart = new Date(prev.start_time).getTime()
                    const pEnd = new Date(prev.end_time).getTime()
                    return bStart < pEnd && bEnd > pStart
                })
                if (overlapsPrev) continue
                validManual.push(b)
            }
        }
        return { ...s, _uid: `shift_${idx}`, _effEndMs: effEndMs, breaks_schedule: validManual }
    })

    assignCohorts(augmented)
    const globalSlots: GlobalSlot[] = []

    augmented.forEach(s => {
        const rk = getRoleKey(s)
        const cat = getRoleCategory(rk)
        const empId = s.employee_id ?? null
        const isGm = isGeneralManagerRole(rk)
        s.breaks_schedule.forEach((b: BreakBlock) => {
            globalSlots.push({
                type: b.type,
                startMs: new Date(b.start_time).getTime(),
                endMs: new Date(b.end_time).getTime(),
                roleKey: rk,
                category: cat,
                empId,
                shiftId: s._uid,
                isGm
            })
        })
    })

    // Pre-evaluar preferencias exactas por empleado + día para respetar los lugares ya entrenados por el gerente
    // antes de acomodar a empleados nuevos o sin historial en ese día.
    for (const s of augmented) {
        const sMs = new Date(s.start_time).getTime()
        const eMs = s._effEndMs ?? new Date(s.end_time).getTime()
        const rk = getRoleKey(s)
        if (isGeneralManagerRole(rk)) continue
        const dayOfWeek = getLocalDayOfWeek(sMs)
        const idx = (s._cohortSize && s._cohortSize > 1) ? (s._cohortIdx ?? 0) : 0
        const pref0 = findBestLearnedPref(learnedPrefs, rk, dayOfWeek, 'meal_30', 0, sMs, eMs, idx, s.employee_id)
        if (pref0) {
            s._preMatchedMeal0 = pref0
        }
    }

    function getPeakWindowMs(shiftStartMs: number, shiftEndMs: number): { peakStartTs: number; peakEndTs: number; peak: { start: number; end: number } } {
        const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
        const peakStartTs = getBusinessDayHourEpochMs(shiftStartMs, peak.start, 0)
        const peakEndTs = getBusinessDayHourEpochMs(shiftStartMs, peak.end, 0)
        return { peakStartTs, peakEndTs, peak }
    }

    function heatBlocks(sMs: number, eMs: number, shiftStartMs: number, shiftEndMs: number): boolean {
        const { peakStartTs, peakEndTs } = getPeakWindowMs(shiftStartMs, shiftEndMs)
        return sMs < peakEndTs && eMs > peakStartTs
    }

    function personalViolation(
        sMs: number,
        eMs: number,
        newType: 'rest_10' | 'meal_30',
        existing: BreakBlock[],
        isExactEmployeeLearned: boolean = false
    ): boolean {
        const rrGap = isExactEmployeeLearned ? ms(50) : GAP_RR_MS
        const mrGap = isExactEmployeeLearned ? ms(30) : GAP_MR_MS
        for (const pb of existing) {
            const ps = new Date(pb.start_time).getTime()
            const pe = new Date(pb.end_time).getTime()
            if (sMs < pe && eMs > ps) return true
            const requiredGap =
                newType === 'rest_10' && pb.type === 'rest_10'
                    ? rrGap
                    : newType === 'meal_30' && pb.type === 'meal_30'
                      ? GAP_MM_MS
                      : mrGap
            const dist = sMs >= pe ? sMs - pe : ps - eMs
            if (dist < requiredGap) return true
        }
        return false
    }

    function countSameRoleOnDuty(rk: string, tStart: number, tEnd: number): number {
        let cnt = 0
        for (const other of augmented) {
            const oS = new Date(other.start_time).getTime()
            const oE = other._effEndMs ?? new Date(other.end_time).getTime()
            if (getRoleKey(other) === rk && tStart < oE && tEnd > oS) cnt++
        }
        return cnt
    }

    function countOverlappingSameRoleBreaks(rk: string, shiftUid: string, tStart: number, tEnd: number): number {
        let cnt = 0
        for (const slot of globalSlots) {
            if (slot.shiftId === shiftUid || slot.isGm) continue
            if (slot.roleKey === rk && tStart < slot.endMs && tEnd > slot.startMs) cnt++
        }
        return cnt
    }

    function waveViolation(
        sMs: number,
        eMs: number,
        shift: any,
        isMeal: boolean,
        mode: WaveMode,
        allowLearnedStagger: boolean = false
    ): boolean {
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const thisIsGm = isGeneralManagerRole(rk)

        for (const slot of globalSlots) {
            if (slot.shiftId !== undefined && slot.shiftId === shift._uid) continue
            if (slot.isGm || thisIsGm) continue
            const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
            const startDiff = Math.abs(sMs - slot.startMs)
            const sameRole = slot.roleKey === rk
            const sameCat = slot.category === cat
            const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
            const sameGroupMeal = sameRole || isLeaderConflict

            if (mode !== 'off') {
                if (isMeal && slot.type === 'meal_30') {
                    if (isLeaderConflict) {
                        const gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_LEADER_MEAL_MS
                        if (overlapMs > 0 || startDiff < gap) return true
                    } else if (sameGroupMeal) {
                        if (allowLearnedStagger && startDiff >= ms(10)) {
                            const onDuty = countSameRoleOnDuty(rk, sMs, eMs)
                            const activeOverlaps = countOverlappingSameRoleBreaks(rk, shift._uid, sMs, eMs)
                            // Si el gerente entrenó explícitamente un relevo escalonado (ej. 6:00 -> 6:20 -> 6:30 PM)
                            // y hay >= 4 empleados del rol en piso (quedando >= 2 activos en estación), respetarlo.
                            if (onDuty - (activeOverlaps + 1) >= 2) {
                                continue
                            }
                        }
                        const gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_SAME_ROLE_MEAL_MS
                        if (overlapMs > 0 || startDiff < gap) return true
                    }
                }
                if (!isMeal && slot.type === 'rest_10') {
                    if (sameRole) {
                        const gap = mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_ROLE_REST_MS
                        if (startDiff < gap) return true
                    } else if (sameCat && !allowLearnedStagger) {
                        const gap = mode === 'relaxed' ? 0 : WAVE_SAME_CAT_REST_MS
                        if (startDiff < gap) return true
                    }
                }
            }
        }
        return false
    }

    function scoreSlot(
        sMs: number,
        durMs: number,
        isMeal: boolean,
        targetMs: number,
        shift: any,
        shiftStartMs: number,
        bypassPeak: boolean = false,
        allowLearnedStagger: boolean = false
    ): number {
        const eMs = sMs + durMs
        const h = spanHeat(sMs, eMs, getHeat)
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null
        const thisIsGm = isGeneralManagerRole(rk)

        const heatPenalty = Math.pow(h, 4) * 1e12

        let peakPenalty = 0
        if (!bypassPeak) {
            const shiftEndMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
            if (heatBlocks(sMs, eMs, shiftStartMs, shiftEndMs)) {
                peakPenalty = 1e30
            }
        }

        const distPenalty = (Math.abs(midMs(sMs, durMs) - targetMs) / ms(1)) * 1e15

        let wavePenalty = 0

        for (const slot of globalSlots) {
            if (slot.shiftId !== undefined && slot.shiftId === shift._uid) continue
            if (slot.isGm || thisIsGm) continue
            const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
            const startDiff = Math.abs(sMs - slot.startMs)
            const isSameEmpOtherShift = empId !== null && slot.empId === empId
            const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
            const isGroup = slot.roleKey === rk || isLeaderConflict || isSameEmpOtherShift
            const sameCat = slot.category === cat

            if (isMeal && slot.type === 'meal_30') {
                if (isGroup && startDiff < MIN_GAP_LUNCHES_MS) {
                    const onDuty = allowLearnedStagger && !isLeaderConflict ? countSameRoleOnDuty(rk, sMs, eMs) : 0
                    const activeOverlaps = allowLearnedStagger && !isLeaderConflict ? countOverlappingSameRoleBreaks(rk, shift._uid, sMs, eMs) : 0
                    if (allowLearnedStagger && !isLeaderConflict && startDiff >= ms(10) && onDuty - (activeOverlaps + 1) >= 2) {
                        wavePenalty += 3e15
                    } else {
                        const ratio = startDiff === 0 ? 1 : 1 - startDiff / MIN_GAP_LUNCHES_MS
                        wavePenalty += ratio * 1e20
                        if (startDiff === 0) wavePenalty += 1e21
                    }
                } else if (sameCat && !isGroup && startDiff < ms(20)) {
                    // Distintos puestos dentro de BOH (ej. Cook vs Dishwasher): penalización suave que no rompe preferencias aprendidas
                    wavePenalty += 2e15
                }
            }
            if (!isMeal && slot.type === 'rest_10') {
                if (sameCat && startDiff < MIN_GAP_BREAKS_MS) {
                    const ratio = startDiff === 0 ? 1 : 1 - startDiff / MIN_GAP_BREAKS_MS
                    wavePenalty += ratio * 1e19
                    if (isGroup && startDiff === 0) wavePenalty += 1e20
                }
            }

            if (isGroup) {
                if (overlapMs > 0) {
                    if (isLeaderConflict) {
                        const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                        wavePenalty += ratio * 1e32
                    } else if (slot.type === (isMeal ? 'meal_30' : 'rest_10')) {
                        if (isMeal && allowLearnedStagger && startDiff >= ms(20)) {
                            const onDuty = countSameRoleOnDuty(rk, sMs, eMs)
                            const activeOverlaps = countOverlappingSameRoleBreaks(rk, shift._uid, sMs, eMs)
                            if (onDuty - (activeOverlaps + 1) >= 2) {
                                wavePenalty += 4e15
                            } else {
                                const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                                wavePenalty += ratio * 1e32
                            }
                        } else {
                            const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                            wavePenalty += ratio * 1e32
                        }
                    } else {
                        // Coexistencia de un rest_10 y un meal_30 del mismo rol cuando hay >=3 personas activas
                        wavePenalty += 4e15
                    }
                } else if (!isMeal && slot.type === 'rest_10') {
                    // En arranque en frío prefiere ligeramente 20m cuando es gratis (< 1 min de distPenalty = 1e15),
                    // pero respeta al 100% cualquier preferencia aprendida a 10m exactos (ej. 1:20 PM y 1:30 PM)
                    if (startDiff < ms(20)) {
                        wavePenalty += 2e14
                    }
                }
            } else if (overlapMs > 0 && (cat === 'leader' || slot.category === 'leader')) {
                const stationCat = cat === 'leader' ? slot.category : cat
                const stationOnDutyCount = augmented.filter(other => {
                    const oS = new Date(other.start_time).getTime()
                    const oE = other._effEndMs ?? new Date(other.end_time).getTime()
                    return getRoleCategory(getRoleKey(other)) === stationCat && sMs < oE && eMs > oS
                }).length
                if (stationOnDutyCount <= 1) {
                    wavePenalty += 5e21
                }
            }
        }
        return heatPenalty + peakPenalty + distPenalty + wavePenalty
    }

    function getMealTargetOutsidePeak(
        wStartMs: number,
        wEndMs: number,
        durMs: number,
        shiftStartMs: number,
        globalMealIndex: number,
        shiftDurationHrs: number,
        shift: any
    ): { target: number; bypassHeat: boolean; hasExactLearnedPref: boolean } {
        const shiftEndMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
        const { peakStartTs: peakStartMs, peakEndTs: peakEndMs, peak } = getPeakWindowMs(shiftStartMs, shiftEndMs)
        const { hour: startHour } = getLocalHourMinute(shiftStartMs)

        const safeBeforeStart = wStartMs
        const safeBeforeEnd = Math.min(wEndMs, peakStartMs + ms(30))
        const safeAfterStart = Math.max(wStartMs, peakEndMs)
        const safeAfterEnd = wEndMs

        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const dayOfWeek = getLocalDayOfWeek(shiftStartMs)
        const idx = (shift._cohortSize && shift._cohortSize > 1) ? shift._cohortIdx : 0
        const size = Math.max((shift._cohortSize && shift._cohortSize > 1) ? shift._cohortSize : 1, 1)

        const matchedPref =
            globalMealIndex === 0 && shift._preMatchedMeal0
                ? (shift._preMatchedMeal0 as MatchedLearnedPref)
                : findBestLearnedPref(
                      learnedPrefs,
                      rk,
                      dayOfWeek,
                      'meal_30',
                      globalMealIndex,
                      shiftStartMs,
                      shiftEndMs,
                      idx,
                      shift.employee_id
                  )

        if (matchedPref) {
            const rawTarget = shiftStartMs + ms(matchedPref.offsetMin)
            const effectiveWStart = matchedPref.matchedByEmployee ? Math.min(wStartMs, shiftStartMs + ms(40)) : wStartMs
            const clampedTarget = Math.max(effectiveWStart, Math.min(wEndMs - durMs, rawTarget))
            const touchesPeak = heatBlocks(clampedTarget, clampedTarget + durMs, shiftStartMs, shiftEndMs)
            const allowBypass =
                !touchesPeak ||
                clampedTarget <= peakStartMs + ms(60) ||
                matchedPref.exactStartHour ||
                matchedPref.matchedByEmployee
            return {
                target: midMs(clampedTarget, durMs),
                bypassHeat: allowBypass,
                hasExactLearnedPref: matchedPref.matchedByEmployee || (matchedPref.exactDay && matchedPref.exactCohort)
            }
        }

        // ── HEURÍSTICA UNIVERSAL DE ARRANQUE EN FRÍO (15 SUCURSALES) ──
        const postPeakSpace = Math.max(0, safeAfterEnd - safeAfterStart)
        const prePeakSpace = Math.max(0, safeBeforeEnd - safeBeforeStart)
        const postFits = postPeakSpace >= durMs
        const preFits = prePeakSpace >= durMs

        // Turnos cortos de apoyo de 6.0h (1 Lunch + 1 Break): ideal a mitad de turno (~2h a 2.5h de entrada),
        // evitando mandarlos a la 1ra hora y dejarles 4.5h seguidas con un solo break.
        if (isShortSixHourSupportShift(shiftStartMs, shiftEndMs) && cat !== 'leader') {
            const idealShort = Math.min(wEndMs - durMs, shiftStartMs + ms(120))
            if (!heatBlocks(idealShort, idealShort + durMs, shiftStartMs, shiftEndMs)) {
                return { target: midMs(idealShort, durMs), bypassHeat: false, hasExactLearnedPref: false }
            }
            if (preFits) {
                const preShort = Math.max(wStartMs, Math.min(safeBeforeEnd - durMs, shiftStartMs + ms(90)))
                return { target: midMs(preShort, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }
        }

        if (cat === 'leader') {
            const isSeniorLeader =
                rk.includes('asst') ||
                rk.includes('assistant') ||
                rk.includes('asistente') ||
                (rk.includes('manager') && !rk.includes('shift'))
            const isLateLeader = startHour >= 19
            const shouldGoPostPeak =
                (size === 1 && (isSeniorLeader || isLateLeader || startHour >= 16)) ||
                idx === 1 ||
                (idx >= 2 && safeAfterStart + ms(40) + durMs <= safeAfterEnd)

            if (shouldGoPostPeak && postFits) {
                const postRank = size === 1 ? 0 : idx - 1
                const postOffset = postRank === 0 ? ms(10) : ms(10) + postRank * ms(30)
                const best = Math.min(safeAfterEnd - durMs, safeAfterStart + postOffset)
                return { target: midMs(best, durMs), bypassHeat: false, hasExactLearnedPref: false }
            }
            if (shouldGoPostPeak && !postFits && startHour >= 6 && startHour < 12 && wEndMs - durMs >= peakStartMs + ms(60)) {
                const lateWindowBest = Math.max(peakStartMs + ms(70), wEndMs - durMs - ms(5))
                return { target: midMs(lateWindowBest, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }
            if (preFits) {
                const preRank = idx === 0 ? 0 : idx - 1
                const basePre =
                    startHour >= 6 && startHour < 12 && idx === 0 && safeBeforeStart + ms(60) <= safeBeforeEnd - durMs
                        ? safeBeforeStart + ms(60)
                        : safeBeforeStart + preRank * ms(30)
                const best = Math.min(safeBeforeEnd - durMs, basePre)
                return { target: midMs(best, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }
        }

        if (startHour >= 6 && startHour < 12) {
            const rawTarget = Math.min(wEndMs - durMs, wStartMs + idx * ms(30))
            const best = preFits ? Math.min(safeBeforeEnd - durMs, rawTarget) : rawTarget
            return { target: midMs(best, durMs), bypassHeat: true, hasExactLearnedPref: false }
        }

        if (startHour >= 12 && startHour < 15) {
            if (postFits) {
                const best = Math.min(safeAfterEnd - durMs, safeAfterStart + idx * ms(30))
                return { target: midMs(best, durMs), bypassHeat: false, hasExactLearnedPref: false }
            }
            const best = Math.min(wEndMs - durMs, shiftStartMs + ms(120) + idx * ms(30))
            return { target: midMs(best, durMs), bypassHeat: true, hasExactLearnedPref: false }
        }

        const isLateNightRush = peak.start >= 20
        if (startHour >= 15 && startHour <= 17) {
            const step = ms(30)
            const rawBest = Math.min(wEndMs - durMs, wStartMs + idx * step)
            const best = isLateNightRush ? Math.min(peakStartMs - durMs, rawBest) : rawBest
            return { target: midMs(best, durMs), bypassHeat: !isLateNightRush, hasExactLearnedPref: false }
        }

        if (startHour === 18) {
            const offsetBase = ms(90)
            const step = ms(30)
            const rawBest = Math.min(wEndMs - durMs, shiftStartMs + offsetBase + idx * step)
            const best = isLateNightRush ? Math.min(peakStartMs - durMs, rawBest) : rawBest
            return { target: midMs(best, durMs), bypassHeat: !isLateNightRush, hasExactLearnedPref: false }
        }

        if (postFits) {
            const best = Math.min(safeAfterEnd - durMs, safeAfterStart + idx * ms(30))
            return { target: midMs(best, durMs), bypassHeat: false, hasExactLearnedPref: false }
        }
        const fallbackBest = Math.min(wEndMs - durMs, shiftStartMs + ms(90) + idx * ms(30))
        return { target: midMs(fallbackBest, durMs), bypassHeat: true, hasExactLearnedPref: false }
    }

    function findSlot(
        wStartMs: number,
        wEndMs: number,
        durationMins: number,
        personalBreaks: BreakBlock[],
        shift: any,
        isMeal: boolean,
        targetMs: number,
        shiftStartMs: number,
        shiftEndMs: number,
        bypassHeatBlocks: boolean = false,
        hasExactLearnedPref: boolean = false
    ): Date {
        const durMs = ms(durationMins)
        const type = isMeal ? 'meal_30' : 'rest_10'

        const hardMinStart = shiftStartMs + ms(30)
        const hardMaxEnd = shiftEndMs - ms(10)
        const safeWStart = Math.max(hardMinStart, Math.min(wStartMs, hardMaxEnd - durMs))
        const safeWEnd = Math.max(safeWStart + durMs, Math.min(wEndMs, hardMaxEnd))

        const buildCandidates = (startBound: number, endBound: number): number[] => {
            const first = Math.ceil(startBound / SLOT_STEP_MS) * SLOT_STEP_MS
            const list: number[] = []
            for (let t = first; t <= endBound - durMs; t += SLOT_STEP_MS) list.push(t)
            return list
        }

        let candidates = buildCandidates(safeWStart, safeWEnd)
        if (candidates.length === 0) {
            candidates = buildCandidates(hardMinStart, hardMaxEnd)
        }
        if (candidates.length === 0) return new Date(hardMinStart)

        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null
        const thisIsGm = isGeneralManagerRole(rk)

        const filterPool = (candList: number[], ignorePeak: boolean, ignoreRoleOverlap: boolean): number[] => {
            return candList.filter(t => {
                if (!ignorePeak && heatBlocks(t, t + durMs, shiftStartMs, shiftEndMs)) return false
                if (personalViolation(t, t + durMs, type, personalBreaks, hasExactLearnedPref)) return false
                for (const slot of globalSlots) {
                    if (slot.shiftId !== undefined && slot.shiftId === shift._uid) continue
                    if (slot.isGm || thisIsGm) continue
                    if (empId !== null && slot.empId === empId) {
                        if (t < slot.endMs + ms(30) && t + durMs > slot.startMs - ms(30)) return false
                    }
                    if (!ignoreRoleOverlap) {
                        const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                        const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                        if (overlapMs > 0 && (slot.roleKey === rk || isLeaderConflict)) {
                            if (isLeaderConflict) return false
                            if (slot.type === type) {
                                // En arranque en frío NUNCA solapar dos lunches del mismo rol.
                                // Si el gerente entrenó explícitamente un escalonamiento (ej. 6:00 -> 6:20 -> 6:30 PM)
                                // cuando hay >= 4 empleados del mismo rol en piso (quedando >= 2 activos en estación), permitirlo.
                                if (isMeal && hasExactLearnedPref && Math.abs(t - slot.startMs) >= ms(10)) {
                                    const onDuty = countSameRoleOnDuty(rk, t, t + durMs)
                                    const activeOverlaps = countOverlappingSameRoleBreaks(rk, shift._uid, t, t + durMs)
                                    if (onDuty - (activeOverlaps + 1) >= 2) {
                                        continue
                                    }
                                }
                                return false
                            }
                            if (countSameRoleOnDuty(rk, t, t + durMs) < 3) {
                                return false
                            }
                        }
                    }
                }
                return true
            })
        }

        const hardValid = filterPool(candidates, bypassHeatBlocks, false)

        let pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'normal', hasExactLearnedPref))
        if (pool.length === 0) {
            pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'relaxed', hasExactLearnedPref))
        }
        if (pool.length === 0) {
            pool = hardValid
        }

        const isSecondMealWindow = isMeal && safeWStart >= shiftStartMs + ms(60 * (H_SECOND_MEAL_START - 0.5))
        const fallbackStart = isSecondMealWindow ? safeWStart : shiftStartMs + ms(40)
        const fallbackEnd = isMeal
            ? isSecondMealWindow
                ? shiftEndMs - ms(40)
                : Math.min(shiftStartMs + ms(60 * H_FIRST_MEAL_MAX), shiftEndMs - ms(40))
            : shiftEndMs - ms(20)
        const fullShiftCandidates = buildCandidates(fallbackStart, fallbackEnd)

        if (pool.length === 0) {
            pool = filterPool(candidates, true, false).filter(
                t => !waveViolation(t, t + durMs, shift, isMeal, 'normal', hasExactLearnedPref)
            )
        }
        if (pool.length === 0) {
            pool = filterPool(candidates, true, false)
        }
        if (pool.length === 0) {
            pool = filterPool(fullShiftCandidates, true, false)
        }

        const buildRelaxedFilter = (candList: number[], ignoreRole: boolean) =>
            candList.filter(t => {
                for (const pb of personalBreaks) {
                    const ps = new Date(pb.start_time).getTime()
                    const pe = new Date(pb.end_time).getTime()
                    const minGap = isMeal && pb.type === 'meal_30' ? GAP_MM_MS : ms(35)
                    if (t < pe + minGap && t + durMs > ps - minGap) return false
                }
                for (const slot of globalSlots) {
                    if (slot.shiftId !== undefined && slot.shiftId === shift._uid) continue
                    if (slot.isGm || thisIsGm) continue
                    if (empId !== null && slot.empId === empId) {
                        if (t < slot.endMs + ms(30) && t + durMs > slot.startMs - ms(30)) return false
                    }
                    if (!ignoreRole) {
                        const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                        const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                        if ((slot.roleKey === rk || isLeaderConflict) && overlapMs > 0) return false
                    }
                }
                return true
            })

        if (pool.length === 0) pool = buildRelaxedFilter(candidates, false)
        if (pool.length === 0) pool = buildRelaxedFilter(fullShiftCandidates, false)
        if (pool.length === 0) pool = filterPool(fullShiftCandidates, true, true)
        if (pool.length === 0) pool = buildRelaxedFilter(candidates, true)

        if (pool.length === 0) {
            const emergencyCandidates = buildCandidates(shiftStartMs + ms(30), shiftEndMs - ms(15)).filter(t => {
                for (const pb of personalBreaks) {
                    const ps = new Date(pb.start_time).getTime()
                    const pe = new Date(pb.end_time).getTime()
                    if (t < pe + ms(30) && t + durMs > ps - ms(30)) return false
                }
                return true
            })
            if (emergencyCandidates.length > 0) {
                pool = emergencyCandidates
            } else {
                const allPossible = buildCandidates(hardMinStart, hardMaxEnd)
                let bestT = allPossible[0] ?? hardMinStart
                let bestMinDist = -1
                for (const t of allPossible) {
                    let minDist = Infinity
                    for (const pb of personalBreaks) {
                        const ps = new Date(pb.start_time).getTime()
                        const pe = new Date(pb.end_time).getTime()
                        if (t < pe && t + durMs > ps) {
                            minDist = -1
                            break
                        }
                        const d = t >= pe ? t - pe : ps - (t + durMs)
                        if (d < minDist) minDist = d
                    }
                    if (minDist > bestMinDist) {
                        bestMinDist = minDist
                        bestT = t
                    }
                }
                return new Date(bestT)
            }
        }

        let bestSlot = pool[0]
        let bestCost = Infinity
        for (const t of pool) {
            const cost = scoreSlot(
                t,
                durMs,
                isMeal,
                targetMs,
                shift,
                shiftStartMs,
                bypassHeatBlocks,
                hasExactLearnedPref
            )
            if (cost < bestCost) {
                bestCost = cost
                bestSlot = t
            }
        }
        return new Date(bestSlot)
    }

    function countCoolMealSlots(shift: any, shiftStartMs: number): number {
        const sMs = shiftStartMs
        const eMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
        const durationHrs = getWallClockDurationHours(sMs, eMs)
        const wEnd = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), eMs - ms(60 * H_END_BUFFER))
        const wStart = sMs + ms(60 * hMinStart(durationHrs))
        let cool = 0
        for (let t = wStart; t <= wEnd - ms(30); t += SLOT_STEP_MS) {
            if (!heatBlocks(t, t + ms(30), shiftStartMs, eMs)) cool++
        }
        return cool
    }

    const processed = [...augmented].sort((a, b) => {
        const rkA = getRoleKey(a), rkB = getRoleKey(b)
        const gmA = isGeneralManagerRole(rkA), gmB = isGeneralManagerRole(rkB)
        if (gmA !== gmB) return gmA ? 1 : -1

        // Priorizar empleados con preferencia exacta por empleado + día entrenada por el gerente
        // para que al agregar un empleado nuevo no desplace en efecto dominó a los compañeros ya entrenados.
        const empPrefA = Boolean(a._preMatchedMeal0?.matchedByEmployee && a._preMatchedMeal0?.exactDay)
        const empPrefB = Boolean(b._preMatchedMeal0?.matchedByEmployee && b._preMatchedMeal0?.exactDay)
        if (empPrefA !== empPrefB) return empPrefA ? -1 : 1
        if (empPrefA && empPrefB) {
            const targetA = new Date(a.start_time).getTime() + ms(a._preMatchedMeal0.offsetMin)
            const targetB = new Date(b.start_time).getTime() + ms(b._preMatchedMeal0.offsetMin)
            if (targetA !== targetB) return targetA - targetB
        }

        const sMsA = new Date(a.start_time).getTime()
        const sMsB = new Date(b.start_time).getTime()
        const eMsA = a._effEndMs ?? new Date(a.end_time).getTime()
        const eMsB = b._effEndMs ?? new Date(b.end_time).getTime()

        // En arranque en frío: los apoyos cortos de 6.0h (1 Lunch + 1 Break) se acomodan después de la plantilla completa
        const short6A = isShortSixHourSupportShift(sMsA, eMsA)
        const short6B = isShortSixHourSupportShift(sMsB, eMsB)
        if (short6A !== short6B) return short6A ? 1 : -1

        // Regla Universal de Salida Anticipada: quien termina turno antes come primero
        if (eMsA !== eMsB) return eMsA - eMsB
        if (sMsA !== sMsB) return sMsA - sMsB

        const durA = eMsA - sMsA
        const durB = eMsB - sMsB
        if (durA !== durB) return durA - durB

        const aCool = countCoolMealSlots(a, sMsA)
        const bCool = countCoolMealSlots(b, sMsB)
        if (aCool !== bCool) return aCool - bCool
        const aCat = getRoleCategory(rkA), bCat = getRoleCategory(rkB)
        if (aCat === 'leader' && bCat !== 'leader') return -1
        if (bCat === 'leader' && aCat !== 'leader') return 1
        const tieA = getShiftOperationalTieRank(a)
        const tieB = getShiftOperationalTieRank(b)
        if (tieA !== tieB) return tieA - tieB
        return String(a.employee_id || a.id || '').localeCompare(String(b.employee_id || b.id || ''))
    })

    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 1 — MEALS (Lunches de 30 min)
    // ══════════════════════════════════════════════════════════════════════════
    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
        getHeat = buildHeatFn(operatingHours, sMs, eMs)
        const req = getRequiredBreaks(sMs, eMs)
        const allMeals = req.filter(b => b.type === 'meal_30')
        const manualMealsCount = shift.breaks_schedule.filter((b: BreakBlock) => b.type === 'meal_30' && b.is_manual).length
        const meals = allMeals.slice(manualMealsCount)
        const endBuf = eMs - ms(60 * H_END_BUFFER)

        meals.forEach((_, loopIdx) => {
            const globalMealIndex = manualMealsCount + loopIdx
            const durationHrs = getWallClockDurationHours(sMs, eMs)
            let wStartMs: number, wEndMs: number

            if (globalMealIndex === 0) {
                wStartMs = sMs + ms(60 * hMinStart(durationHrs))
                wEndMs = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), endBuf)
            } else {
                wStartMs = sMs + ms(60 * H_SECOND_MEAL_START)
                wEndMs = Math.min(sMs + ms(60 * H_SECOND_MEAL_END), endBuf)
            }
            if (wEndMs - wStartMs < ms(60)) wEndMs = Math.min(endBuf, wStartMs + ms(90))

            const { target: targetMs, bypassHeat, hasExactLearnedPref } = getMealTargetOutsidePeak(
                wStartMs,
                wEndMs,
                ms(30),
                sMs,
                globalMealIndex,
                durationHrs,
                shift
            )

            const effWStart = hasExactLearnedPref ? Math.min(wStartMs, sMs + ms(40)) : wStartMs
            const best = findSlot(
                effWStart,
                wEndMs,
                30,
                shift.breaks_schedule,
                shift,
                true,
                targetMs,
                sMs,
                eMs,
                bypassHeat,
                hasExactLearnedPref
            )
            const bestEnd = new Date(best.getTime() + ms(30))
            shift.breaks_schedule.push({
                type: 'meal_30',
                start_time: toIso(best),
                end_time: toIso(bestEnd),
                status: 'scheduled'
            })
            const rk = getRoleKey(shift)
            globalSlots.push({
                type: 'meal_30',
                startMs: best.getTime(),
                endMs: bestEnd.getTime(),
                roleKey: rk,
                category: getRoleCategory(rk),
                empId: shift.employee_id ?? null,
                shiftId: shift._uid,
                isGm: isGeneralManagerRole(rk)
            })
        })
        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 2 — RESTS (Descansos de 10 min relativos a Meals y huecos reales)
    // ══════════════════════════════════════════════════════════════════════════
    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
        getHeat = buildHeatFn(operatingHours, sMs, eMs)
        const req = getRequiredBreaks(sMs, eMs)
        const allRests = req.filter(b => b.type === 'rest_10')
        const manualRestsCount = shift.breaks_schedule.filter((b: BreakBlock) => b.type === 'rest_10' && b.is_manual).length
        const restsNeeded = allRests.length - manualRestsCount
        if (restsNeeded <= 0) continue

        const shiftDurationHrs = getWallClockDurationHours(sMs, eMs)
        const minStart = sMs + ms(60 * hMinStartRest(shiftDurationHrs))
        const endBufferHrs = shiftDurationHrs > 10 ? 1.0 : shiftDurationHrs > 8 ? 0.75 : 0.60
        const endBuf = eMs - ms(60 * endBufferHrs)

        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const dayOfWeek = getLocalDayOfWeek(sMs)
        const cohortIdx = (shift._cohortSize && shift._cohortSize > 1) ? (shift._cohortIdx ?? 0) : 0
        const cohortStaggerMs = allRests.length === 1 ? 0 : cohortIdx * ms(10)

        const shiftMeals = sortChron((shift.breaks_schedule as BreakBlock[]).filter(b => b.type === 'meal_30'))
        const firstMeal = shiftMeals[0] || null
        const firstMealStartMs = firstMeal ? new Date(firstMeal.start_time).getTime() : null
        const firstMealEndMs = firstMeal ? new Date(firstMeal.end_time).getTime() : null

        const firstRestPref = findBestLearnedPref(
            learnedPrefs,
            rk,
            dayOfWeek,
            'rest_10',
            0,
            sMs,
            eMs,
            cohortIdx,
            shift.employee_id
        )

        let isEarlyMeal = false
        if (firstMealStartMs !== null && firstMealEndMs !== null) {
            if (firstRestPref) {
                const prefRest0Ms = sMs + ms(firstRestPref.offsetMin)
                if (prefRest0Ms >= firstMealEndMs + ms(15)) {
                    isEarlyMeal = true
                } else if (prefRest0Ms <= firstMealStartMs - ms(25) && firstMealStartMs - sMs >= ms(130)) {
                    isEarlyMeal = false
                } else {
                    isEarlyMeal = firstMealStartMs - sMs <= (cat === 'leader' ? ms(160) : ms(185))
                }
            } else {
                isEarlyMeal = firstMealStartMs - sMs <= (cat === 'leader' ? ms(160) : ms(185))
            }
        }

        for (let i = 0; i < restsNeeded; i++) {
            // Si ya existen rests manuales en el turno (ej. el gerente arrastró el 2do break a las 3:00 PM),
            // detectar el mayor hueco libre real para no empujar el break restante a 20 min de salir (`Tail-Push Fix`).
            const currentAllRests = sortChron((shift.breaks_schedule as BreakBlock[]).filter(b => b.type === 'rest_10'))
            let segStart = minStart
            let segEnd = endBuf
            let globalRestIndex = currentAllRests.length
            let naturalTargetMs = sMs + (eMs - sMs) * 0.50 + cohortStaggerMs

            if (manualRestsCount > 0 && currentAllRests.length > 0) {
                // Construir obstáculos ordenados (meals ± 45m, rests ± 65m) y elegir el mayor hueco disponible
                const obstacles = sortChron(shift.breaks_schedule as BreakBlock[]).map(b => {
                    const bs = new Date(b.start_time).getTime()
                    const be = new Date(b.end_time).getTime()
                    const pad = b.type === 'meal_30' ? GAP_MR_MS : ms(65)
                    return { forbidStart: bs - ms(10) - pad, forbidEnd: be + pad, rawStart: bs }
                })

                let cursor = Math.max(sMs + ms(40), minStart - ms(15))
                const maxEndCursor = Math.max(endBuf, eMs - ms(30))
                const openIntervals: { s: number; e: number }[] = []

                for (const ob of obstacles) {
                    if (ob.forbidStart >= cursor + ms(10)) {
                        openIntervals.push({ s: cursor, e: ob.forbidStart + ms(10) })
                    }
                    if (ob.forbidEnd > cursor) cursor = ob.forbidEnd
                }
                if (maxEndCursor >= cursor + ms(10)) {
                    openIntervals.push({ s: cursor, e: maxEndCursor })
                }

                if (openIntervals.length > 0) {
                    openIntervals.sort((a, b) => (b.e - b.s) - (a.e - a.s))
                    const chosen = openIntervals[0]
                    segStart = chosen.s
                    segEnd = chosen.e
                    const midGap = chosen.s + (chosen.e - chosen.s) * 0.50
                    naturalTargetMs = Math.max(segStart, Math.min(segEnd - ms(10), midGap))
                    globalRestIndex = currentAllRests.filter(r => new Date(r.start_time).getTime() < naturalTargetMs).length
                }
            } else if (!firstMeal || firstMealStartMs === null || firstMealEndMs === null) {
                segStart = minStart
                segEnd = endBuf
                const frac = allRests.length === 1 ? 0.50 : (globalRestIndex + 1) / (allRests.length + 1)
                naturalTargetMs = sMs + (eMs - sMs) * frac + cohortStaggerMs
            } else if (isEarlyMeal) {
                const lastMealEndMs = shiftMeals.length > 1
                    ? new Date(shiftMeals[0].end_time).getTime()
                    : firstMealEndMs
                const postMealMinStart = Math.max(minStart, lastMealEndMs + GAP_MR_MS)
                const existingPostRests = sortChron(
                    (shift.breaks_schedule as BreakBlock[]).filter(
                        b => b.type === 'rest_10' && new Date(b.start_time).getTime() >= lastMealEndMs
                    )
                )
                if (existingPostRests.length > 0) {
                    const lastRestEnd = new Date(existingPostRests[existingPostRests.length - 1].end_time).getTime()
                    segStart = Math.max(postMealMinStart, lastRestEnd + GAP_RR_MS)
                } else {
                    segStart = postMealMinStart
                }
                const remainingRestsAfterThis = Math.max(0, restsNeeded - 1 - i)
                const reservedTailMs = remainingRestsAfterThis * (GAP_RR_MS + ms(10))
                segEnd = Math.max(segStart + ms(30), endBuf - reservedTailMs)
                const remShiftMs = eMs - lastMealEndMs
                const idealPoint = lastMealEndMs + remShiftMs * ((globalRestIndex + 1) / (allRests.length + 1)) + cohortStaggerMs
                naturalTargetMs = Math.max(segStart, Math.min(segEnd - ms(10), idealPoint))
            } else {
                const hasPreMealRest = (shift.breaks_schedule as BreakBlock[]).some(
                    b => b.type === 'rest_10' && new Date(b.start_time).getTime() < firstMealStartMs
                )
                if (!hasPreMealRest && firstMealStartMs - GAP_MR_MS >= minStart + ms(10)) {
                    segStart = minStart
                    segEnd = firstMealStartMs - GAP_MR_MS
                    const idealPre = sMs + (firstMealStartMs - sMs) * 0.45 + cohortStaggerMs
                    naturalTargetMs = Math.max(segStart, Math.min(segEnd - ms(10), idealPre))
                } else {
                    const postMealMinStart = Math.max(minStart, firstMealEndMs + GAP_MR_MS)
                    const existingPostRests = sortChron(
                        (shift.breaks_schedule as BreakBlock[]).filter(
                            b => b.type === 'rest_10' && new Date(b.start_time).getTime() >= firstMealEndMs
                        )
                    )
                    if (existingPostRests.length > 0) {
                        const lastRestEnd = new Date(existingPostRests[existingPostRests.length - 1].end_time).getTime()
                        segStart = Math.max(postMealMinStart, lastRestEnd + GAP_RR_MS)
                    } else {
                        segStart = postMealMinStart
                    }
                    const remainingRestsAfterThis = Math.max(0, restsNeeded - 1 - i)
                    const reservedTailMs = remainingRestsAfterThis * (GAP_RR_MS + ms(10))
                    segEnd = Math.max(segStart + ms(30), endBuf - reservedTailMs)
                    const postRestsTotal = Math.max(1, allRests.length - (hasPreMealRest || globalRestIndex > 0 ? 1 : 0))
                    const postIdx = existingPostRests.length
                    const remShiftMs = eMs - firstMealEndMs
                    const idealPost = firstMealEndMs + remShiftMs * ((postIdx + 1) / (postRestsTotal + 1)) + cohortStaggerMs
                    naturalTargetMs = Math.max(segStart, Math.min(segEnd - ms(10), idealPost))
                }
            }

            let targetMs = naturalTargetMs
            let bypassHeatSnap = false
            let hasExactRestPref = false

            const matchedRestPref = findBestLearnedPref(
                learnedPrefs,
                rk,
                dayOfWeek,
                'rest_10',
                globalRestIndex,
                sMs,
                eMs,
                cohortIdx,
                shift.employee_id
            )

            if (matchedRestPref) {
                const candidateTargetMs = sMs + ms(matchedRestPref.offsetMin)
                const remainingRestsAfterThis = Math.max(0, restsNeeded - 1 - i)
                const minGapPerRemRest = matchedRestPref.matchedByEmployee ? ms(70) : GAP_RR_MS + ms(10)
                const learnedMaxEnd = eMs - ms(15) - remainingRestsAfterThis * minGapPerRemRest
                const learnedMinStart = sMs + ms(30)

                if (
                    candidateTargetMs >= learnedMinStart &&
                    candidateTargetMs + ms(10) <= learnedMaxEnd &&
                    !personalViolation(
                        candidateTargetMs,
                        candidateTargetMs + ms(10),
                        'rest_10',
                        shift.breaks_schedule,
                        matchedRestPref.matchedByEmployee
                    )
                ) {
                    segStart = Math.min(segStart, candidateTargetMs)
                    segEnd = Math.max(segEnd, candidateTargetMs + ms(20))
                    targetMs = candidateTargetMs
                    bypassHeatSnap = true
                    hasExactRestPref = matchedRestPref.matchedByEmployee || (matchedRestPref.exactDay && matchedRestPref.exactCohort)
                } else if (candidateTargetMs >= segStart - ms(30) && candidateTargetMs <= segEnd + ms(30)) {
                    targetMs = Math.max(segStart, Math.min(segEnd - ms(10), candidateTargetMs))
                    bypassHeatSnap = true
                    hasExactRestPref = matchedRestPref.matchedByEmployee || (matchedRestPref.exactDay && matchedRestPref.exactCohort)
                }
            }

            if (!bypassHeatSnap) {
                const existingPersonalBreaks = (shift.breaks_schedule as BreakBlock[]).map((b: BreakBlock) => ({
                    ms: new Date(b.start_time).getTime(),
                    endMs: new Date(b.end_time).getTime(),
                    gap: b.type === 'rest_10' ? GAP_RR_MS : GAP_MR_MS
                }))
                const scanRadius = shiftDurationHrs <= 6 ? ms(25) : ms(45)
                const heatScanStart = Math.max(segStart, targetMs - scanRadius)
                const heatScanEnd = Math.min(segEnd, targetMs + scanRadius)
                let heatBest = targetMs
                let heatBestScore = Infinity

                for (let t = heatScanStart; t + ms(10) <= heatScanEnd; t += SLOT_STEP_MS) {
                    const tooClose = existingPersonalBreaks.some(pb => {
                        const dist = t >= pb.endMs ? t - pb.endMs : pb.ms - (t + ms(10))
                        return dist < pb.gap
                    })
                    if (tooClose) continue
                    const h = spanHeat(t, t + ms(10), getHeat)
                    if (h < heatBestScore) {
                        heatBestScore = h
                        heatBest = t
                    }
                }

                const originalHeat = spanHeat(targetMs, targetMs + ms(10), getHeat)
                if (heatBestScore < Infinity && heatBestScore < originalHeat * 0.85) {
                    targetMs = heatBest
                }
            }

            // En arranque en frío (`!bypassHeatSnap`), evitar horas pico si existen candidatos fuera del rush dentro del segmento;
            // si hay preferencia aprendida (`bypassHeatSnap`), respetar al minuto la hora del gerente.
            const best = findSlot(
                segStart,
                segEnd,
                10,
                shift.breaks_schedule,
                shift,
                false,
                midMs(targetMs, ms(10)),
                sMs,
                eMs,
                bypassHeatSnap,
                hasExactRestPref
            )
            const bestEnd = new Date(best.getTime() + ms(10))
            shift.breaks_schedule.push({
                type: 'rest_10',
                start_time: toIso(best),
                end_time: toIso(bestEnd),
                status: 'scheduled'
            })
            globalSlots.push({
                type: 'rest_10',
                startMs: best.getTime(),
                endMs: bestEnd.getTime(),
                roleKey: rk,
                category: cat,
                empId: shift.employee_id ?? null,
                shiftId: shift._uid,
                isGm: isGeneralManagerRole(rk)
            })
        }
        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    // Limpiar metadatos internos temporales antes de retornar
    for (const s of augmented) {
        delete s._preMatchedMeal0
    }

    return augmented as Shift[]
}
