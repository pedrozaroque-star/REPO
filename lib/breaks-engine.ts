/**
 * @module breaks-engine
 * @description Motor optimizador universal de Inteligencia Artificial (Motor V31 Universal Multi-Sucursal) para la programación
 * automática y auto-aprendizaje de descansos (Breaks de 10 min y Lunches de 30 min) en las 15 sucursales de Tacos Gavilan.
 * @businessRules
 * - Día laboral oficial de Tacos Gavilan: inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente. El turno PM inicia a las 5:00 PM.
 * - Cumplimiento estricto del Código Laboral de California (§ 512): el 1er Lunch debe iniciar antes de cumplir la 5ta hora (< 5.0h);
 *   turnos de hasta 12.0h exactas llevan 1 Lunch (con exención de 2do meal) y solo turnos > 12.0h generan 2do Lunch.
 * - Orden Primario Estricto (Calibrado sobre 4 meses / 2,063 turnos / 3,290 movimientos reales):
 *   1° Hora de Entrada (`start_time` ASC), 2° Hora de Salida (`end_time` ASC), incluyendo turnos de 6.0h.
 * - Escalera limpia Pre-Rush cada 30 min (10:00 -> 10:30 -> 11:00 -> 11:30 AM en AM; 6:00 -> 6:30 -> 7:00 PM en PM) con derrame post-rush
 *   cuando se llena el bloque previo, y Líderes PM (`idx >= 1` o entrada `>= 6:00 PM`) en ventana post-rush con break previo de 10 min.
 * - Ritmo real de ~2 horas (110-120 min después del Lunch y entre breaks) para `rest_10` sin bloqueo `heatBlocks` ni deslizamiento nocturno `heatScan`.
 * - Aislamiento Multi-Tienda + Memoria por Empleado y Escalón (`store_id` + `employee_id` + `role` + `day_of_week` + `pHour` + `pCohort`),
 *   prohibiendo desfases ciegos cuando cambia la hora de entrada (`pHour === startHour`).
 * - Apoyo Temporal en Piso (`[TEMP_ROLE:cook|cashier|shift leader]` en `shifts.notes`): Permite reasignar temporalmente a un empleado
 *   de área hoy sin modificar Toast ni sobrescribir la memoria semanal aprendida (`break_manual_overrides`).
 * - General Manager excluido del conteo de cohortes y bloqueos de relevo operativo en tableta.
 * @dataFlow Recibe turnos del día (con `job_id` del turno priorizado, `[TEMP_ROLE:...]` opcional y `station_name` opcional), proyección horaria de ventas (`operatingHours`)
 * y preferencias aprendidas (`break_manual_overrides`) → Retorna turnos enriquecidos con `breaks_schedule`.
 * @notes V31 Universal Upgrade:
 * - Calibrado estadísticamente con 4 meses históricos reales: corregido `getPeakHoursForShift` para preservar las ventanas pre-rush (AM < 12:00 PM, PM < 7:00 PM).
 * - Prioridad justa por hora de entrada y salida en `compareCohortMembers` y `processed`, evitando relegar turnos de 6.0h.
 * - Eliminadas las 4 trabas que pisaban horas entrenadas por el gerente (penalización Leader+Cook `5e21`, piso mínimo `+40m` vs `+30m`,
 *   contradicción `startDiff >= 20m` en `scoreSlot`, y robo de horario en `Pass 2` contra turnos cortos de 5h).
 * - En `Pass 2`, los breaks de 10 min mantienen pasos parejos de hasta ~2h20m (`stepMs <= 140m`) y `GAP_RR_MS = 75m`, sin deslizamiento tardío.
 * - Exporta helpers `extractTempFloorRole`, `applyTempFloorRoleToNotes` y `resolveShiftBaseRoleTitle` para Escenario 1 y Escenario 2 en `/descansos`.
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
    tsMs?: number
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

export type TempFloorRole = 'Cook' | 'Cashier' | 'Shift Leader'

const TEMP_ROLE_REGEX = /\[TEMP_ROLE:(cook|cashier|shift leader)\]\s*/gi

export function extractTempFloorRole(notes?: string | null): TempFloorRole | null {
    if (!notes) return null
    const m = String(notes).match(/\[TEMP_ROLE:(cook|cashier|shift leader)\]/i)
    if (!m) return null
    const raw = m[1].toLowerCase()
    if (raw === 'cook') return 'Cook'
    if (raw === 'cashier') return 'Cashier'
    if (raw === 'shift leader') return 'Shift Leader'
    return null
}

export function applyTempFloorRoleToNotes(
    notes: string | null | undefined,
    tempRole: TempFloorRole | null
): string {
    const cleaned = String(notes || '').replace(TEMP_ROLE_REGEX, '').trim()
    if (!tempRole) return cleaned
    const tag = `[TEMP_ROLE:${tempRole.toLowerCase()}]`
    return cleaned ? `${tag} ${cleaned}` : tag
}

/**
 * Resuelve el título base oficial del puesto asignado al turno en Toast (`shift.job_id` / `shift.toast_job_guid`),
 * ignorando cualquier rol temporal de apoyo en piso (`[TEMP_ROLE:...]`).
 */
export function resolveShiftBaseRoleTitle(shift: any, emp?: any, jobs?: any[]): string {
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

/**
 * Resuelve de forma universal el título operativo efectivo de un turno en las 15 sucursales:
 * Si el mánager marcó apoyo temporal en piso (`[TEMP_ROLE:...]`) en `shift.notes`, ese rol temporal tiene prioridad;
 * en caso contrario prioriza el puesto asignado al turno (`shift.job_id` / `shift.toast_job_guid`) sobre Toast base.
 */
export function resolveShiftRoleTitle(shift: any, emp?: any, jobs?: any[]): string {
    const tempRole = extractTempFloorRole(shift?.notes)
    if (tempRole) return tempRole
    return resolveShiftBaseRoleTitle(shift, emp, jobs)
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

export const GAP_RR_MS = 75 * 60_000
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
        return isAm ? { start: 12, end: 14 } : { start: 19, end: 21 }
    }

    // `endH = 16` en AM impide que las ventas de las 5:00 PM (17h) eclipsen el rush real de almuerzo (12:00 PM - 2:00 PM)
    const startH = isAm ? 6 : 17
    const endH = isAm ? 16 : 29

    const normalizedOh = operatingHours.map(oh => {
        const extH = oh.hour < 6 ? oh.hour + 24 : oh.hour
        const ohStartMs = getBusinessDayHourEpochMs(shiftStartMs, extH, 0)
        const ohEndMs = ohStartMs + ms(60)
        return {
            extH,
            sales: oh.projected_sales || 0,
            overlapsShift: ohStartMs < shiftEndMs && ohEndMs > shiftStartMs
        }
    })

    let maxSales = -1
    let peakHour = isAm ? 12 : 19

    for (const item of normalizedOh) {
        if (item.extH >= startH && item.extH <= endH && item.overlapsShift && item.sales > maxSales) {
            maxSales = item.sales
            peakHour = item.extH
        }
    }

    if (maxSales <= 0) {
        for (const item of normalizedOh) {
            if (item.extH >= startH && item.extH <= endH && item.sales > maxSales) {
                maxSales = item.sales
                peakHour = item.extH
            }
        }
    }

    if (maxSales <= 0) {
        return isAm ? { start: 12, end: 14 } : { start: 19, end: 21 }
    }

    let pStart = peakHour
    let pEnd = peakHour + 1
    const prevThreshold = maxSales * 0.92
    const nextThreshold = maxSales * 0.85
    const minPeakFloor = isAm ? 12 : 19

    const prevOh = normalizedOh.find(o => o.extH === peakHour - 1 && o.extH >= startH)
    const nextOh = normalizedOh.find(o => o.extH === peakHour + 1 && o.extH <= endH)
    const next2Oh = normalizedOh.find(o => o.extH === peakHour + 2 && o.extH <= endH)

    // Preservar escalera pre-rush: en AM no bajar de las 12:00 PM y en PM no bajar de las 7:00 PM cuando el pico es >= a esa hora
    if (prevOh && prevOh.sales >= prevThreshold && peakHour - 1 >= minPeakFloor) {
        pStart = peakHour - 1
    }
    if (nextOh && nextOh.sales >= nextThreshold) {
        pEnd = peakHour + 2
        if (next2Oh && next2Oh.sales >= nextThreshold && (pEnd - pStart) < 3) {
            pEnd = peakHour + 3
        }
    }

    if (pEnd - pStart < 2) {
        if (pStart > Math.max(startH, minPeakFloor)) pStart -= 1
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
    const catB = getRoleCategory(rkB)

    const sMsA = new Date(a.start_time).getTime()
    const sMsB = new Date(b.start_time).getTime()
    const eMsA = a._effEndMs ?? new Date(a.end_time).getTime()
    const eMsB = b._effEndMs ?? new Date(b.end_time).getTime()

    if (catA === 'leader' && catB === 'leader' && Math.abs(sMsA - sMsB) <= ms(30)) {
        const isAsstA = rkA.includes('asst') || rkA.includes('assistant') || rkA.includes('asistente') || isGeneralManagerRole(rkA)
        const isAsstB = rkB.includes('asst') || rkB.includes('assistant') || rkB.includes('asistente') || isGeneralManagerRole(rkB)
        if (isAsstA !== isAsstB) return isAsstA ? 1 : -1
    }

    // Orden Primario Estricto: 1° Hora de Entrada, 2° Hora de Salida (incluyendo turnos de 6.0h)
    if (sMsA !== sMsB) return sMsA - sMsB
    if (eMsA !== eMsB) return eMsA - eMsB
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
    shiftEmployeeId?: string | number | null,
    activePeerEmpIds?: Set<string>
): MatchedLearnedPref | null {
    if (!learnedPrefs || learnedPrefs.length === 0) return null

    const cleanRk = normalizeRoleString(rk)
    const cleanShiftEmpId =
        shiftEmployeeId !== null && shiftEmployeeId !== undefined && String(shiftEmployeeId).trim() !== ''
            ? String(shiftEmployeeId).trim()
            : null

    const shiftDurMin = Math.round(getWallClockDurationHours(shiftStartMs, shiftEndMs) * 60)
    const isNoMealShift = shiftDurMin < 360
    const isShortShift = shiftDurMin <= 365
    const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs)
    const startHalfHour = startMin >= 25 && startMin < 55 ? 1 : 0
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
        if (isNoMealShift) {
            if (pDur === null || pDur >= 360) continue
        } else {
            if (pDur !== null && pDur < 360) continue
            if (breakType === 'rest_10' && pDur !== null) {
                // Exigir mismo tramo de cantidad de rests (1 rest = 6.0h, 2 rests = 6.5h..10h, 3 rests = >10h)
                if ((shiftDurMin > 360) !== (pDur > 360)) continue
                if ((shiftDurMin > 600) !== (pDur > 600)) continue
            }
        }

        if (p.offset_from_start_min < 30 || p.offset_from_start_min > shiftDurMin - minEndClearance) {
            continue
        }
        if (breakType === 'meal_30' && typeBreakIndex === 0 && p.offset_from_start_min > 290) {
            continue
        }

        const { startHour: pHour, halfHour: pHalfHour, cohortIdx: pCohort, isV30 } = decodeLearnedSlotMeta(p.peak_hour)
        const sameEmp = Boolean(cleanShiftEmpId && pEmpId && cleanShiftEmpId === pEmpId)

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
            // Prohibir desfases ciegos al cambiar la hora de entrada (nunca sumar offset de 10am a entrada de 9am)
            if (pHour !== startHour) continue
        } else {
            if (p.day_of_week !== dayOfWeek) continue
            if (breakType === 'rest_10' && !isShortShift) {
                if (typeBreakIndex === 0 && p.offset_from_start_min > shiftDurMin * 0.62) continue
                if (typeBreakIndex === 1 && p.offset_from_start_min < shiftDurMin * 0.48) continue
            }
        }

        const durDiff = pDur !== null ? Math.abs(pDur - shiftDurMin) : 0
        const sameDurationShape = pDur === null || durDiff <= 35

        let score = 0
        if (pHour !== null) {
            if (sameEmp && p.day_of_week === dayOfWeek && sameDurationShape) {
                // Caso 1: Mismo empleado + mismo día + misma entrada + duración ±35m (sin límite de escalón cuando compañeros cambian)
                score += pCohort === cohortIdx ? 14500 : 13500
                if (!isV30 || pHalfHour === startHalfHour) score += 300
            } else if (p.day_of_week === dayOfWeek && pCohort === cohortIdx && (pDur === null || durDiff <= 60)) {
                // Caso 2: Mismo día + misma entrada + mismo escalón (Anti Double-Dip: no copiar a un compañero activo ese día/hora)
                if (!sameEmp && pEmpId && activePeerEmpIds && activePeerEmpIds.has(pEmpId)) continue
                score += 9500
                if (sameEmp) score += 100
                if (!isV30 || pHalfHour === startHalfHour) score += 200
            } else if (sameEmp && sameDurationShape) {
                // Caso 3: Mismo empleado + misma entrada + duración ±35m en otro día de la semana
                score += pCohort === cohortIdx ? 6000 : 5200
            } else if (!pEmpId && pCohort === cohortIdx && sameDurationShape) {
                // Caso 4: Plantilla histórica del rol por escalón exacto
                score += 2000
            } else {
                continue
            }
            if (sameDurationShape) score += 300
        } else if (p.day_of_week === dayOfWeek && !pEmpId && pCohort === cohortIdx) {
            // Retrocompatibilidad exclusiva para registros antiguos V25 sin metadata de hora
            score += 500
        } else {
            continue
        }

        if (pDur !== null) {
            score -= durDiff * 1.5
        }

        const prefTs = p.updated_at || p.created_at
        const tsMs = prefTs ? new Date(String(prefTs)).getTime() : 0
        if (prefTs && String(prefTs) > '2026-10-20T21:42:00') {
            score += 400
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

    // Si coincidió con la preferencia del propio empleado o con el escalón exacto (pCohort === cohortIdx), NUNCA extrapolar
    if (!best.sameEmp && !(best.pHour !== null && best.pCohort === cohortIdx)) {
        if (best.pHour !== null) {
            const extrapolated = adjustedOffset + (cohortIdx - best.pCohort) * staggerStep
            if (breakType === 'meal_30' && adjustedOffset <= 120 && extrapolated > 150) {
                return null
            }
            adjustedOffset = extrapolated
        } else if (cohortIdx > 0) {
            adjustedOffset += cohortIdx * staggerStep
        }
    }

    const isExactMatch = best.sameEmp || (best.pHour !== null && best.pCohort === cohortIdx)
    const minAllowedOffset = isExactMatch ? 30 : 45
    adjustedOffset = Math.max(minAllowedOffset, Math.min(shiftDurMin - minEndClearance, adjustedOffset))

    return {
        offsetMin: adjustedOffset,
        exactStartHour: best.pHour !== null && best.pHour === startHour,
        exactCohort: isExactMatch,
        exactDay: best.pref.day_of_week === dayOfWeek,
        matchedByEmployee: best.sameEmp,
        tsMs: best.tsMs
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

    function getActivePeerEmpIds(shift: any): Set<string> {
        const rk = getRoleKey(shift)
        const sMs = new Date(shift.start_time).getTime()
        const startHour = getLocalHourMinute(sMs).hour
        const peers = new Set<string>()
        for (const other of augmented) {
            if (other.employee_id == null) continue
            if (getRoleKey(other) !== rk) continue
            if (getLocalHourMinute(new Date(other.start_time).getTime()).hour === startHour) {
                peers.add(String(other.employee_id).trim())
            }
        }
        return peers
    }

    // Pre-evaluar preferencias exactas por empleado + día para respetar los lugares ya entrenados por el gerente
    // antes de acomodar a empleados nuevos o sin historial en ese día.
    for (const s of augmented) {
        const sMs = new Date(s.start_time).getTime()
        const eMs = s._effEndMs ?? new Date(s.end_time).getTime()
        const rk = getRoleKey(s)
        if (isGeneralManagerRole(rk)) continue
        const dayOfWeek = getLocalDayOfWeek(sMs)
        const idx = (s._cohortSize && s._cohortSize > 1) ? (s._cohortIdx ?? 0) : 0
        const pref0 = findBestLearnedPref(learnedPrefs, rk, dayOfWeek, 'meal_30', 0, sMs, eMs, idx, s.employee_id, getActivePeerEmpIds(s))
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
        const rrGap = isExactEmployeeLearned ? ms(40) : GAP_RR_MS
        const mrGap = isExactEmployeeLearned ? ms(20) : GAP_MR_MS
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

        const heatPenalty = isMeal ? Math.pow(h, 4) * 1e12 : Math.pow(h, 4) * 1e10

        let peakPenalty = 0
        if (isMeal && !bypassPeak) {
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
                        wavePenalty += 3e14
                    } else {
                        const ratio = startDiff === 0 ? 1 : 1 - startDiff / MIN_GAP_LUNCHES_MS
                        wavePenalty += ratio * 1e20
                        if (startDiff === 0) wavePenalty += 1e21
                    }
                } else if (sameCat && !isGroup && startDiff < ms(20)) {
                    wavePenalty += 2e14
                }
            }
            if (!isMeal && slot.type === 'rest_10') {
                if (sameCat && (isGroup || !allowLearnedStagger) && startDiff < MIN_GAP_BREAKS_MS) {
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
                        if (isMeal && allowLearnedStagger && startDiff >= ms(10)) {
                            const onDuty = countSameRoleOnDuty(rk, sMs, eMs)
                            const activeOverlaps = countOverlappingSameRoleBreaks(rk, shift._uid, sMs, eMs)
                            if (onDuty - (activeOverlaps + 1) >= 2) {
                                wavePenalty += 4e14
                            } else {
                                const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                                wavePenalty += ratio * 1e32
                            }
                        } else {
                            const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                            wavePenalty += ratio * 1e32
                        }
                    } else {
                        wavePenalty += 4e14
                    }
                } else if (!isMeal && slot.type === 'rest_10') {
                    if (startDiff < ms(20)) {
                        wavePenalty += 2e14
                    }
                }
            } else if (!allowLearnedStagger && overlapMs > 0 && (cat === 'leader' || slot.category === 'leader')) {
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
                      shift.employee_id,
                      getActivePeerEmpIds(shift)
                  )

        if (matchedPref) {
            const isExactMatch = matchedPref.matchedByEmployee || (matchedPref.exactDay && matchedPref.exactCohort)
            const rawTarget = shiftStartMs + ms(matchedPref.offsetMin)
            const effectiveWStart =
                isExactMatch && matchedPref.offsetMin < 55
                    ? Math.min(wStartMs, shiftStartMs + ms(30))
                    : wStartMs
            const clampedTarget = Math.max(effectiveWStart, Math.min(wEndMs - durMs, rawTarget))
            const touchesPeak = heatBlocks(clampedTarget, clampedTarget + durMs, shiftStartMs, shiftEndMs)
            const allowBypass =
                !touchesPeak ||
                clampedTarget <= peakStartMs + ms(60) ||
                matchedPref.exactStartHour ||
                isExactMatch
            return {
                target: midMs(clampedTarget, durMs),
                bypassHeat: allowBypass,
                hasExactLearnedPref: isExactMatch
            }
        }

        // ── HEURÍSTICA UNIVERSAL DE ARRANQUE EN FRÍO (CALIBRADA SOBRE 15 SUCURSALES) ──
        const postPeakSpace = Math.max(0, safeAfterEnd - safeAfterStart)
        const prePeakSpace = Math.max(0, safeBeforeEnd - safeBeforeStart)
        const postFits = postPeakSpace >= durMs
        const preFits = prePeakSpace >= durMs

        if (cat === 'leader') {
            if (startHour >= 6 && startHour < 14) {
                const amTarget = safeBeforeStart + idx * ms(30)
                if (preFits && amTarget + durMs <= safeBeforeEnd) {
                    return { target: midMs(amTarget, durMs), bypassHeat: true, hasExactLearnedPref: false }
                }
                if (postFits) {
                    const postTarget = Math.min(safeAfterEnd - durMs, safeAfterStart + Math.max(0, idx - 2) * ms(30))
                    return { target: midMs(postTarget, durMs), bypassHeat: false, hasExactLearnedPref: false }
                }
                const amFallback = Math.min(wEndMs - durMs, amTarget)
                return { target: midMs(amFallback, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }

            const isSeniorLeader =
                rk.includes('asst') ||
                rk.includes('assistant') ||
                rk.includes('asistente') ||
                (rk.includes('manager') && !rk.includes('shift'))
            const isLateLeader = startHour >= 18
            const hasCoEntryLeader = augmented.some(other => {
                if (other._uid === shift._uid) return false
                const oRk = getRoleKey(other)
                if (isGeneralManagerRole(oRk) || getRoleCategory(oRk) !== 'leader') return false
                return getLocalHourMinute(new Date(other.start_time).getTime()).hour === startHour
            })
            const shouldGoPostPeak =
                (!hasCoEntryLeader && (isSeniorLeader || isLateLeader || startHour >= 16)) ||
                idx >= 1 ||
                isLateLeader

            if (shouldGoPostPeak && postFits) {
                const postRank = !hasCoEntryLeader ? 0 : Math.max(0, idx - (startHour < 18 ? 1 : 0))
                const postOffset = ms(20) + postRank * ms(30)
                const best = Math.min(safeAfterEnd - durMs, safeAfterStart + postOffset)
                return { target: midMs(best, durMs), bypassHeat: best >= peakEndMs, hasExactLearnedPref: false }
            }
            if (shouldGoPostPeak && !postFits && startHour >= 14 && wEndMs - durMs >= shiftStartMs + ms(240)) {
                const latePreFifthBest = Math.max(shiftStartMs + ms(240), wEndMs - durMs - ms(20))
                return { target: midMs(latePreFifthBest, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }
            if (preFits) {
                const best = Math.min(safeBeforeEnd - durMs, safeBeforeStart + ms(30))
                return { target: midMs(best, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }
        }

        if (startHour >= 6 && startHour < 12) {
            const ladderTarget = wStartMs + idx * ms(30)
            if (ladderTarget + durMs <= peakStartMs) {
                return { target: midMs(ladderTarget, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }
            if (postFits) {
                const spillRank = Math.max(0, Math.round((ladderTarget + durMs - peakStartMs) / ms(30)) - 1)
                const postTarget = Math.min(safeAfterEnd - durMs, safeAfterStart + spillRank * ms(30))
                return { target: midMs(postTarget, durMs), bypassHeat: false, hasExactLearnedPref: false }
            }
            const best = Math.min(wEndMs - durMs, preFits ? Math.min(safeBeforeEnd - durMs, ladderTarget) : ladderTarget)
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
            const ladderTarget = wStartMs + idx * ms(30)
            if (ladderTarget + durMs <= peakStartMs + ms(30)) {
                return { target: midMs(ladderTarget, durMs), bypassHeat: true, hasExactLearnedPref: false }
            }
            if (postFits && !isLateNightRush) {
                const spillRank = Math.max(0, Math.round((ladderTarget - peakStartMs) / ms(30)) - 1)
                const postTarget = Math.min(safeAfterEnd - durMs, safeAfterStart + spillRank * ms(30))
                return { target: midMs(postTarget, durMs), bypassHeat: false, hasExactLearnedPref: false }
            }
            const rawBest = Math.min(wEndMs - durMs, ladderTarget)
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
                if (isMeal && !ignorePeak && heatBlocks(t, t + durMs, shiftStartMs, shiftEndMs)) return false
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

        const sMsA = new Date(a.start_time).getTime()
        const sMsB = new Date(b.start_time).getTime()
        const eMsA = a._effEndMs ?? new Date(a.end_time).getTime()
        const eMsB = b._effEndMs ?? new Date(b.end_time).getTime()

        // Priorizar turnos con preferencia exacta (por empleado o por escalón exacto) para proteger su hora entrenada
        const empPrefA = Boolean(a._preMatchedMeal0 && (a._preMatchedMeal0.matchedByEmployee || (a._preMatchedMeal0.exactDay && a._preMatchedMeal0.exactCohort)))
        const empPrefB = Boolean(b._preMatchedMeal0 && (b._preMatchedMeal0.matchedByEmployee || (b._preMatchedMeal0.exactDay && b._preMatchedMeal0.exactCohort)))
        if (empPrefA !== empPrefB) return empPrefA ? -1 : 1
        if (empPrefA && empPrefB) {
            const targetA = sMsA + ms(a._preMatchedMeal0.offsetMin)
            const targetB = sMsB + ms(b._preMatchedMeal0.offsetMin)
            if (targetA !== targetB) return targetA - targetB
            const tsDiff = (b._preMatchedMeal0.tsMs || 0) - (a._preMatchedMeal0.tsMs || 0)
            if (tsDiff !== 0) return tsDiff
        }

        // Regla Universal de Entrada y Salida: 1° quien entra primero, 2° quien termina turno antes
        if (sMsA !== sMsB) return sMsA - sMsB
        if (eMsA !== eMsB) return eMsA - eMsB

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

            const effWStart =
                hasExactLearnedPref && targetMs - ms(15) - sMs < ms(55)
                    ? Math.min(wStartMs, sMs + ms(30))
                    : wStartMs
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
    //  PASS 2 — RESTS (Descansos de 10 min en ritmo real de ~2h sin bloqueo de calor)
    // ══════════════════════════════════════════════════════════════════════════
    for (const s of processed) {
        const sMs = new Date(s.start_time).getTime()
        const eMs = s._effEndMs ?? new Date(s.end_time).getTime()
        const rk = getRoleKey(s)
        if (isGeneralManagerRole(rk)) continue
        const dayOfWeek = getLocalDayOfWeek(sMs)
        const cIdx = (s._cohortSize && s._cohortSize > 1) ? (s._cohortIdx ?? 0) : 0
        s._preMatchedRest0 = findBestLearnedPref(learnedPrefs, rk, dayOfWeek, 'rest_10', 0, sMs, eMs, cIdx, s.employee_id, getActivePeerEmpIds(s))
    }

    const restProcessed = [...processed].sort((a, b) => {
        const gmA = isGeneralManagerRole(getRoleKey(a)), gmB = isGeneralManagerRole(getRoleKey(b))
        if (gmA !== gmB) return gmA ? 1 : -1

        const pA = a._preMatchedRest0 as MatchedLearnedPref | null | undefined
        const pB = b._preMatchedRest0 as MatchedLearnedPref | null | undefined
        const exactA = Boolean(pA && (pA.matchedByEmployee || (pA.exactDay && pA.exactCohort)))
        const exactB = Boolean(pB && (pB.matchedByEmployee || (pB.exactDay && pB.exactCohort)))
        if (exactA !== exactB) return exactA ? -1 : 1
        if (exactA && exactB && pA && pB) {
            const tsDiff = (pB.tsMs || 0) - (pA.tsMs || 0)
            if (tsDiff !== 0) return tsDiff
            const tA = new Date(a.start_time).getTime() + ms(pA.offsetMin)
            const tB = new Date(b.start_time).getTime() + ms(pB.offsetMin)
            if (tA !== tB) return tA - tB
        }

        const sMsA = new Date(a.start_time).getTime()
        const sMsB = new Date(b.start_time).getTime()
        if (sMsA !== sMsB) return sMsA - sMsB
        const eMsA = a._effEndMs ?? new Date(a.end_time).getTime()
        const eMsB = b._effEndMs ?? new Date(b.end_time).getTime()
        return eMsA - eMsB
    })

    for (const shift of restProcessed) {
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
        // Dejar 1.5h antes de salir en turnos >=8h, 1.25h en 6.5-7.5h, y 45m en <=6h (mediana histórica = 120m)
        const endBufferHrs = shiftDurationHrs >= 8 ? 1.5 : shiftDurationHrs > 6 ? 1.25 : 0.75
        const endBuf = eMs - ms(60 * endBufferHrs)

        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const dayOfWeek = getLocalDayOfWeek(sMs)
        const cohortIdx = (shift._cohortSize && shift._cohortSize > 1) ? (shift._cohortIdx ?? 0) : 0
        const cohortStaggerMs = allRests.length === 1 ? 0 : Math.min(cohortIdx, 3) * ms(10)

        const shiftMeals = sortChron((shift.breaks_schedule as BreakBlock[]).filter(b => b.type === 'meal_30'))
        const firstMeal = shiftMeals[0] || null
        const firstMealStartMs = firstMeal ? new Date(firstMeal.start_time).getTime() : null
        const firstMealEndMs = firstMeal ? new Date(firstMeal.end_time).getTime() : null

        const firstRestPref = (shift._preMatchedRest0 as MatchedLearnedPref | null | undefined) ?? findBestLearnedPref(
            learnedPrefs,
            rk,
            dayOfWeek,
            'rest_10',
            0,
            sMs,
            eMs,
            cohortIdx,
            shift.employee_id,
            getActivePeerEmpIds(shift)
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
                    isEarlyMeal = firstMealStartMs - sMs <= (cat === 'leader' ? ms(135) : ms(165))
                }
            } else {
                isEarlyMeal = firstMealStartMs - sMs <= (cat === 'leader' ? ms(135) : ms(165))
            }
        }

        for (let i = 0; i < restsNeeded; i++) {
            const currentAllRests = sortChron((shift.breaks_schedule as BreakBlock[]).filter(b => b.type === 'rest_10'))
            let segStart = minStart
            let segEnd = endBuf
            let globalRestIndex = currentAllRests.length
            let naturalTargetMs = sMs + (eMs - sMs) * 0.50 + cohortStaggerMs

            if (manualRestsCount > 0 && currentAllRests.length > 0) {
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
                    ? new Date(shiftMeals[shiftMeals.length - 1].end_time).getTime()
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
                // Ritmo parejo de ~2h (110-140 min por bloque) replicando la cadencia real operativa
                const stepMs = Math.min(remShiftMs / (allRests.length + 1), ms(140))
                const idealPoint = lastMealEndMs + stepMs * (existingPostRests.length + 1) + cohortStaggerMs
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
                    const stepMs = Math.min(remShiftMs / (postRestsTotal + 1), ms(140))
                    const idealPost = firstMealEndMs + stepMs * (postIdx + 1) + cohortStaggerMs
                    naturalTargetMs = Math.max(segStart, Math.min(segEnd - ms(10), idealPost))
                }
            }

            let targetMs = naturalTargetMs
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
                shift.employee_id,
                getActivePeerEmpIds(shift)
            )

            if (matchedRestPref) {
                const candidateTargetMs = sMs + ms(matchedRestPref.offsetMin)
                const remainingRestsAfterThis = Math.max(0, restsNeeded - 1 - i)
                const isExactRest = matchedRestPref.matchedByEmployee || (matchedRestPref.exactDay && matchedRestPref.exactCohort)
                const minGapPerRemRest = isExactRest ? ms(60) : GAP_RR_MS + ms(10)
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
                        isExactRest
                    )
                ) {
                    segStart = Math.max(learnedMinStart, Math.min(segStart, candidateTargetMs - ms(20)))
                    segEnd = Math.max(segEnd, candidateTargetMs + ms(20))
                    targetMs = candidateTargetMs
                    hasExactRestPref = isExactRest
                } else if (candidateTargetMs >= segStart - ms(30) && candidateTargetMs <= segEnd + ms(30)) {
                    targetMs = Math.max(segStart, Math.min(segEnd - ms(10), candidateTargetMs))
                    hasExactRestPref = isExactRest
                }
            }

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
                true,
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
        delete s._preMatchedRest0
    }

    return augmented as Shift[]
}
