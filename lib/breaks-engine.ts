/**
 * @module breaks-engine
 * @description Motor optimizador de Inteligencia Artificial para la programación automática de descansos (Breaks de 10 min y Lunches de 30 min) en sucursales de Tacos Gavilan.
 * @businessRules
 * - Cumplimiento de la ley laboral de California (lunches obligatorios antes de la 5ta hora de trabajo).
 * - Bloqueo de zona de pico (rush de ventas) para prevenir falta de personal en horas de alta demanda.
 * - PRIORIDAD DE SALIDA ANTECIPADA (Regla Manager Jesús): Empleados que terminan su turno más temprano son priorizados para salir primero a lunch antes que los que terminan más tarde.
 * - Escalera de relevo Slauson: 30 min entre lunches (cero solapamiento) y 10-20 min entre breaks de 10 min.
 * - Respeto y persistencia de preferencias manuales guardadas por managers (AI Learning).
 * @dataFlow Recibe turnos de la tienda, proyección de ventas por hora y preferencias aprendidas → Retorna turnos enriquecidos con breaks_schedule.
 * @notes V28 Fix (Calibración Forense Slauson - Manager Jesús):
 * - Eliminado el efecto rebote de `WAVE_SAME_ROLE_REST_MS = 75m` que bloqueaba toda la tarde y aventaba el 1er break a medianoche/4PM y el 2do break antes del lunch.
 * - Reserva obligatoria de espacio (`reservedTailMs`) para el 2do break post-lunch en turnos con Lunch temprano (`isEarlyMeal`), garantizando siempre el orden `LUNCH -> Break 1 -> Break 2`.
 * - Ajustado `MIN_GAP_LUNCHES_MS = 30m` para respetar la escalera exacta de 30 min (`10:00 -> 10:30 -> 11:00 -> 11:30 AM` y `6:00 -> 6:30 -> 7:00 -> 7:30 PM`).
 * - Aislamiento de General Manager (`isGeneralManagerRole`) para que su turno administrativo (oculto en la tableta) no robe cohorts ni bloquee a Shift Leaders / Asst. Managers.
 */

import { Shift } from '@/app/planificador/lib/types'
import { OperatingHour } from '@/lib/intelligence'

// ══════════════════════════════════════════════════════════════════════════════
//  BREAKS ENGINE V28 — AI LEARNING & SLAUSON RUSH-HOUR PRECISION
//
//  NUEVO:
//  ✅ Índices por tipo (meal_30[0], rest_10[0..1]) y separación AM/MID/PM + Cohort
//  ✅ Prioridad a empleados que salen más temprano (end_time) para ir a lunch primero (Regla Manager Jesús)
//  ✅ Escalera exacta Slauson: 30m entre Lunches y 10-20m entre Breaks de 10m (cero rebote pre-lunch)
//  ✅ Reserva de ventana post-lunch para impedir que el 1er break se vaya al final del turno
//  ✅ Aislamiento de General Manager y blindaje absoluto de límites de turno
// ══════════════════════════════════════════════════════════════════════════════

export type BreakBlock = {
    type: 'rest_10' | 'meal_30'
    start_time: string
    end_time: string
    status?: 'scheduled' | 'taken' | 'waived'
    is_manual?: boolean
}

export type LearnedPreference = {
    role: string;
    day_of_week: number;
    break_type: string;
    break_index: number;
    offset_from_start_min: number;
    shift_duration_min?: number | null;
    peak_hour?: number | null;
    updated_at?: string | null;
}

/**
 * Calcula el índice específico por tipo de descanso ('meal_30' o 'rest_10')
 * ordenando primero cronológicamente los descansos del turno.
 * Ejemplo: [rest_10 @ 10:30, meal_30 @ 13:00, rest_10 @ 15:30]
 * -> rest_10 @ 10:30 es index 0, meal_30 @ 13:00 es index 0, rest_10 @ 15:30 es index 1.
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
 * Codifica la hora local de inicio del turno (0-23) y la posición en el cohort (0-9)
 * en un entero compatible con la columna `peak_hour` de `break_manual_overrides`.
 * Ejemplo: 9:00 AM cohort 0 -> 90; 5:00 PM (17h) cohort 1 -> 171.
 */
export function encodeLearnedSlotMeta(shiftStartMs: number, cohortIdx: number = 0): number {
    const { hour } = getLocalHourMinute(shiftStartMs)
    const safeCohort = Math.min(Math.max(0, Math.round(cohortIdx || 0)), 9)
    return hour * 10 + safeCohort
}

export function decodeLearnedSlotMeta(peakHour?: number | null): { startHour: number | null; cohortIdx: number } {
    if (peakHour === null || peakHour === undefined || isNaN(Number(peakHour))) {
        return { startHour: null, cohortIdx: 0 }
    }
    const val = Math.round(Number(peakHour))
    if (val >= 50) {
        return { startHour: Math.floor(val / 10), cohortIdx: val % 10 }
    }
    return { startHour: val, cohortIdx: 0 }
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
//  CONSTANTES CALIBRADAS A OPERACIÓN REAL SLAUSON
// ─────────────────────────────────────────────────────────────────────────────

const HEAT_MEAL = 0.78
const HEAT_REST = 0.70

const GAP_RR_MS = 90 * 60_000
const GAP_MM_MS = 120 * 60_000
const GAP_MR_MS = 45 * 60_000

// Gaps mínimos sin solapamiento entre compañeros del mismo equipo:
// - Un break dura 10 min → 10 min entre inicios = 0 solapamiento (ej. 12:30 PM y 12:40 PM)
// - Un lunch dura 30 min → 30 min entre inicios = 0 solapamiento (ej. 6:00 PM, 6:30 PM, 7:00 PM, 7:30 PM)
const MIN_GAP_BREAKS_MS = 10 * 60_000
const MIN_GAP_LUNCHES_MS = 30 * 60_000

// Wave gaps para distribución orgánica sin bloquear ventanas de 4 horas
const WAVE_SAME_ROLE_MEAL_MS = 30 * 60_000
const WAVE_LEADER_MEAL_MS = 30 * 60_000
const WAVE_SAME_ROLE_REST_MS = 20 * 60_000
const WAVE_SAME_CAT_REST_MS = 10 * 60_000
const WAVE_CROSS_REST_MS = 10 * 60_000

const WAVE_MIN_MEAL_MS = 30 * 60_000
const WAVE_MIN_REST_MS = 10 * 60_000

const SLOT_STEP_MS = 10 * 60_000
const H_MIN_START_SHORT = 1.0
const H_MIN_START_MED   = 1.0
const H_MIN_START_LONG  = 1.0

function hMinStart(durationHrs: number): number {
    if (durationHrs <= 6) return 0.75
    if (durationHrs <= 8) return H_MIN_START_MED
    return H_MIN_START_LONG
}

function hMinStartRest(durationHrs: number): number {
    if (durationHrs <= 6) return 0.75
    if (durationHrs <= 8) return 1.0
    return 1.0
}
const H_END_BUFFER = 1.0
// Ley CA: el 1er meal debe INICIAR antes de cumplirse la 5ta hora (< 5.0h = 300m).
// Como buildCandidates evalúa `t <= wEndMs - durMs` (restando 30m de duración del lunch),
// H_FIRST_MEAL_MAX = 5.25h (315m) permite que el INICIO del lunch llegue hasta 4.75h (285m = 4h 45m,
// ej. 9:30 PM o 9:40 PM para un turno de 5:00 PM), respetando la ley de CA y los lunches de +260m/+270m de Jesús.
const H_FIRST_MEAL_MAX = 5.25
const H_SECOND_MEAL_START = 7.0
const H_SECOND_MEAL_END = 10.0

const ms = (mins: number) => mins * 60_000
const toIso = (d: Date) => d.toISOString()
const midMs = (startMs: number, durMs: number) => startMs + durMs / 2

function normalizeHour(h: number): number {
    if (h < 0) return h + 24
    if (h > 23) return h - 24
    return h
}

function sortChron<T extends { start_time: string }>(arr: T[]): T[] {
    return [...arr].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
}

function getRoleKey(shift: any): string {
    return ((shift.job_title || shift.job_id || 'unknown') as string).toLowerCase().trim()
}

export function isGeneralManagerRole(rk: string): boolean {
    const clean = (rk || '').toLowerCase().trim()
    return (clean.includes('manager') || clean.includes('gerente')) &&
        !clean.includes('asst') &&
        !clean.includes('assist') &&
        !clean.includes('asistente') &&
        !clean.includes('shift')
}

function getRoleCategory(rk: string): RoleCategory {
    if (
        rk.includes('manager') || rk.includes('leader') ||
        rk.includes('shift') || rk.includes('lead') ||
        rk.includes('assistant') || rk.includes('asistente') ||
        rk.includes('asst') || rk.includes('encargado')
    ) return 'leader'
    if (rk.includes('cashier') || rk.includes('cajera') || rk.includes('cajero')) return 'foh'
    return 'boh'
}

function getRequiredBreaks(startMs: number, endMs: number): Omit<BreakBlock, 'start_time' | 'end_time'>[] {
    const h = (endMs - startMs) / 3_600_000
    const result: Omit<BreakBlock, 'start_time' | 'end_time'>[] = []
    const restCount = h > 14 ? 4 : h > 10 ? 3 : h > 6 ? 2 : h >= 3.5 ? 1 : 0
    for (let i = 0; i < restCount; i++) result.push({ type: 'rest_10' })
    if (h > 6) result.push({ type: 'meal_30' })
    if (h > 10) result.push({ type: 'meal_30' })
    return result
}

// ─────────────────────────────────────────────────────────────────────────────
//  HORARIO LOCAL FIABLE (ZONA HORARIA CALIFORNIA)
// ─────────────────────────────────────────────────────────────────────────────

export function getLocalDayOfWeek(tMs: number): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        weekday: 'short'
    })
    const dayStr = formatter.format(new Date(tMs))
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return map[dayStr] ?? new Date(tMs).getDay()
}

export function getLocalHourMinute(tMs: number): { hour: number; minute: number } {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    })
    const parts = formatter.formatToParts(new Date(tMs))
    let hour = 0, minute = 0
    for (const part of parts) {
        if (part.type === 'hour') hour = parseInt(part.value, 10)
        if (part.type === 'minute') minute = parseInt(part.value, 10)
    }
    if (hour === 24) hour = 0
    return { hour, minute }
}

function normalizeOperatingHours(rawHours: any): OperatingHour[] {
    if (!rawHours) return []
    if (Array.isArray(rawHours)) {
        return rawHours.map(h => ({
            hour: Number(h.hour),
            projected_sales: Number(h.projected_sales ?? (h as any).sales ?? 0),
            projected_tickets: Number(h.projected_tickets ?? (h as any).tickets ?? 0),
            required_kitchen: Number(h.required_kitchen ?? 0),
            required_foh: Number(h.required_foh ?? 0),
            reasoning: String(h.reasoning ?? '')
        }))
    }
    if (typeof rawHours === 'object') {
        return Object.entries(rawHours).map(([hStr, s]) => ({
            hour: Number(hStr),
            projected_sales: Number(s ?? 0),
            projected_tickets: 0,
            required_kitchen: 0,
            required_foh: 0,
            reasoning: ''
        })).sort((a, b) => a.hour - b.hour)
    }
    return []
}

// ─────────────────────────────────────────────────────────────────────────────
//  ZONA DE PICO SEGÚN TURNO (AM: 11-14h, PM: 18-20h)
// ─────────────────────────────────────────────────────────────────────────────

function getPeakHoursForShift(shiftStartMs: number, shiftEndMs: number, rawOperatingHours: OperatingHour[]): { start: number; end: number } {
    const operatingHours = normalizeOperatingHours(rawOperatingHours)
    const midMs = shiftStartMs + (shiftEndMs - shiftStartMs) / 2
    const { hour } = getLocalHourMinute(midMs)
    const isAm = hour >= 6 && hour < 17

    if (!operatingHours || operatingHours.length === 0) {
        return isAm ? { start: 11, end: 14 } : { start: 18, end: 20 }
    }

    let maxSales = 0
    let peakHour = isAm ? 12 : 19

    const startH = isAm ? 6 : 17
    const endH = isAm ? 17 : 29

    for (const oh of operatingHours) {
        const h = Number(oh.hour)
        const s = Number(oh.projected_sales || 0)
        if (h >= startH && h <= endH && s > maxSales) {
            maxSales = s
            peakHour = h
        }
    }

    if (maxSales === 0) {
        return isAm ? { start: 11, end: 14 } : { start: 18, end: 20 }
    }

    let pStart = peakHour
    let pEnd = peakHour + 1

    for (let h = peakHour - 1; h >= startH; h--) {
        const hData = operatingHours.find(o => Number(o.hour) === h)
        const s = hData ? Number(hData.projected_sales || 0) : 0
        if (s >= maxSales * 0.85) pStart = h
        else break
    }

    for (let h = peakHour + 1; h <= endH; h++) {
        const hData = operatingHours.find(o => Number(o.hour) === h)
        const s = hData ? Number(hData.projected_sales || 0) : 0
        if (s >= maxSales * 0.85) pEnd = h + 1
        else break
    }

    if (pEnd - pStart < 2) {
        pStart = Math.max(startH, pStart - 1)
        if (pEnd - pStart < 2) pEnd = Math.min(endH, pEnd + 1)
    }

    return { start: pStart, end: pEnd }
}

function isInPeakZoneForShift(tMs: number, shiftStartMs: number, shiftEndMs: number, operatingHours: OperatingHour[]): boolean {
    const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
    const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs)
    const shiftMidnightMs = shiftStartMs - ms(60 * startHour) - ms(startMin)
    const peakStartTs = shiftMidnightMs + ms(60 * peak.start)
    const peakEndTs = shiftMidnightMs + ms(60 * peak.end)
    return tMs >= peakStartTs && tMs < peakEndTs
}

// ─────────────────────────────────────────────────────────────────────────────
//  HEATMAP (solo para scoring)
// ─────────────────────────────────────────────────────────────────────────────

function buildHeatFn(rawOperatingHours: OperatingHour[], shiftStartMs?: number, shiftEndMs?: number): (tMs: number) => number {
    const operatingHours = normalizeOperatingHours(rawOperatingHours)
    const MOCK: Record<number, number> = {
        6: 10, 7: 30, 8: 80, 9: 150, 10: 300, 11: 600, 12: 950, 13: 850, 14: 400,
        15: 250, 16: 300, 17: 500, 18: 800, 19: 900, 20: 750, 21: 500, 22: 300, 23: 150,
        0: 50, 1: 20, 2: 10, 3: 5
    }

    let windowStart = 6, windowEnd = 29
    if (shiftStartMs && shiftEndMs) {
        const midMs = shiftStartMs + (shiftEndMs - shiftStartMs) / 2
        const { hour } = getLocalHourMinute(midMs)
        const isAm = hour >= 6 && hour < 17
        windowStart = isAm ? 6 : 17
        windowEnd = isAm ? 17 : 29
    }

    let maxS = 0
    if (operatingHours.length > 0) {
        for (const oh of operatingHours) {
            const h = Number(oh.hour)
            const s = Number(oh.projected_sales || 0)
            if (h >= windowStart && h < windowEnd && s > maxS) maxS = s
        }
        if (maxS < 10) {
            maxS = Math.max(...operatingHours.map(h => Number(h.projected_sales || 0)))
        }
    }

    const scores = new Map<number, number>()
    if (maxS < 10) {
        maxS = 950
        for (const [h, s] of Object.entries(MOCK)) scores.set(parseInt(h), s / maxS)
    } else {
        for (const h of operatingHours) {
            const val = Number(h.projected_sales || 0) / maxS
            scores.set(normalizeHour(Number(h.hour)), Math.min(val, 1.0))
        }
    }
    return (tMs: number): number => {
        const { hour } = getLocalHourMinute(tMs)
        return scores.get(normalizeHour(hour)) ?? 0.05
    }
}

function spanHeat(sMs: number, eMs: number, getHeat: (t: number) => number): number {
    let worst = 0
    for (let t = sMs; t < eMs; t += ms(5)) {
        const sc = getHeat(t)
        if (sc > worst) worst = sc
    }
    return worst
}

function assignCohorts(shifts: any[]): void {
    const groups = new Map<string, any[]>()
    for (const s of shifts) {
        const sMs = new Date(s.start_time).getTime()
        const rk = getRoleKey(s)
        const cat = getRoleCategory(rk)
        let key: string
        if (isGeneralManagerRole(rk)) {
            // El General Manager está oculto en la vista de tableta (/descansos),
            // por lo que nunca debe alterar el _cohortIdx de Shift Leaders ni Asst. Managers.
            key = `gm|${s._uid || s.id}`
        } else if (cat === 'leader') {
            const { hour } = getLocalHourMinute(sMs)
            const period = hour < 14 ? 'am_leader' : 'pm_leader'
            key = `${period}|${cat}`
        } else {
            const block = Math.floor(sMs / ms(30))
            key = `${block}|${cat}`
        }
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(s)
    }
    for (const group of groups.values()) {
        group.sort((a, b) => {
            const rkA = getRoleKey(a)
            const rkB = getRoleKey(b)
            const catA = getRoleCategory(rkA)
            if (catA === 'leader') {
                const isAsstA = rkA.includes('asst') || rkA.includes('assistant') || rkA.includes('asistente') || (rkA.includes('manager') && !rkA.includes('shift'))
                const isAsstB = rkB.includes('asst') || rkB.includes('assistant') || rkA.includes('asistente') || (rkB.includes('manager') && !rkB.includes('shift'))
                if (isAsstA !== isAsstB) return isAsstA ? 1 : -1
            }

            const eMsA = new Date(a.end_time).getTime()
            const eMsB = new Date(b.end_time).getTime()
            if (eMsA !== eMsB) return eMsA - eMsB
            const sMsA = new Date(a.start_time).getTime()
            const sMsB = new Date(b.start_time).getTime()
            if (sMsA !== sMsB) return sMsA - sMsB
            return String(a.employee_id || a.id || '').localeCompare(String(b.employee_id || b.id || ''))
        })

        group.forEach((s, i) => {
            s._cohortIdx = i
            s._cohortSize = group.length
        })
    }
}

function getShiftPeriodBucket(startHour: number): 'am' | 'mid' | 'pm' {
    if (startHour < 12) return 'am'
    if (startHour < 15) return 'mid'
    return 'pm'
}

function findBestLearnedPref(
    learnedPrefs: LearnedPreference[],
    rk: string,
    dayOfWeek: number,
    breakType: 'meal_30' | 'rest_10',
    typeBreakIndex: number,
    shiftStartMs: number,
    shiftEndMs: number,
    cohortIdx: number
): { offsetMin: number; exactStartHour: boolean; exactCohort: boolean; exactDay: boolean } | null {
    if (!learnedPrefs || learnedPrefs.length === 0) return null

    const shiftDurMin = Math.round((shiftEndMs - shiftStartMs) / 60000)
    const isShortShift = shiftDurMin <= 360
    const { hour: startHour } = getLocalHourMinute(shiftStartMs)
    const shiftPeriod = getShiftPeriodBucket(startHour)
    const minEndClearance = breakType === 'meal_30' ? 40 : 20

    type ScoredCandidate = {
        pref: LearnedPreference
        score: number
        pHour: number | null
        pCohort: number
    }

    const candidates: ScoredCandidate[] = []

    for (const p of learnedPrefs) {
        if ((p.role || '').toLowerCase().trim() !== rk) continue
        if (p.break_type !== breakType) continue

        // 1. Validar duración compatible (NUNCA mezclar turnos cortos <=6h con turnos completos >6h)
        const pDur = p.shift_duration_min ? Number(p.shift_duration_min) : null
        if (isShortShift) {
            if (pDur === null || pDur > 360) continue
        } else {
            if (pDur !== null && pDur <= 360) continue
        }

        // El offset debe caber dentro de la duración del turno actual (y antes de la 5ta hora para 1er lunch)
        if (p.offset_from_start_min < 30 || p.offset_from_start_min > shiftDurMin - minEndClearance) {
            continue
        }
        if (breakType === 'meal_30' && typeBreakIndex === 0 && p.offset_from_start_min > 290) {
            continue
        }

        const { startHour: pHour, cohortIdx: pCohort } = decodeLearnedSlotMeta(p.peak_hour)

        // 2. Validar índice específico por tipo
        if (p.break_index !== typeBreakIndex) {
            const isLegacySingleMeal = pHour === null && breakType === 'meal_30' && typeBreakIndex === 0 && shiftDurMin <= 600 && p.break_index <= 2
            if (!isLegacySingleMeal) continue
        }

        // 3. Validar bloque horario (AM vs MID vs PM)
        if (pHour !== null) {
            const pPeriod = getShiftPeriodBucket(pHour)
            if (pPeriod !== shiftPeriod) continue
            if (Math.abs(pHour - startHour) > 2) continue
        } else {
            if (p.day_of_week !== dayOfWeek) continue
            if (breakType === 'rest_10' && !isShortShift) {
                if (typeBreakIndex === 0 && p.offset_from_start_min > shiftDurMin * 0.62) continue
                if (typeBreakIndex === 1 && p.offset_from_start_min < shiftDurMin * 0.48) continue
            }
        }

        let score = 0
        if (p.day_of_week === dayOfWeek) score += 2000
        else if (pHour !== null && Math.abs(pHour - startHour) === 0) score += 900
        else continue

        if (pHour !== null) {
            score += 1000 - Math.abs(pHour - startHour) * 250
            if (pCohort === cohortIdx) score += 600
            else score += Math.max(0, 200 - Math.abs(pCohort - cohortIdx) * 90)
        }

        if (pDur !== null) {
            score -= Math.abs(pDur - shiftDurMin) * 1.2
        }

        // Bonus a movimientos manuales recientes sobre semillas históricas
        const prefTs = p.updated_at || (p as any).created_at
        if (prefTs && String(prefTs) > '2026-10-14T00:00:00') {
            score += 150
        }

        candidates.push({ pref: p, score, pHour, pCohort })
    }

    if (candidates.length === 0) return null

    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0]

    let adjustedOffset = best.pref.offset_from_start_min
    const staggerStep = breakType === 'meal_30' ? 30 : 10

    if (best.pHour !== null) {
        if (best.pCohort !== cohortIdx) {
            adjustedOffset += (cohortIdx - best.pCohort) * staggerStep
        }
    } else if (cohortIdx > 0) {
        adjustedOffset += cohortIdx * staggerStep
    }

    adjustedOffset = Math.max(45, Math.min(shiftDurMin - minEndClearance, adjustedOffset))

    return {
        offsetMin: adjustedOffset,
        exactStartHour: best.pHour !== null && Math.abs(best.pHour - startHour) <= 1,
        exactCohort: best.pHour !== null && best.pCohort === cohortIdx,
        exactDay: best.pref.day_of_week === dayOfWeek
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function scheduleBreaksWithDemand(shifts: Shift[], rawOperatingHours: OperatingHour[], learnedPrefs: LearnedPreference[] = []): Shift[] {
    const operatingHours = normalizeOperatingHours(rawOperatingHours)
    console.warn('%c🧠 BREAKS ENGINE V28 — AI LEARNING & SLAUSON RUSH-HOUR PRECISION', 'background:#0f2447;color:#60a5fa;font-size:14px;font-weight:bold;padding:4px 10px;border-radius:4px')

    let getHeat = buildHeatFn(operatingHours)
    const augmented: any[] = shifts.map((s, idx) => {
        const sMs = new Date(s.start_time).getTime()
        const rawEMs = new Date(s.end_time).getTime()
        const rawDurHrs = (rawEMs - sMs) / 3_600_000
        const effEndMs = rawDurHrs >= 15 ? sMs + ms(60 * Math.max(8, Math.min(10, rawDurHrs - 12))) : rawEMs
        const durHrs = (effEndMs - sMs) / 3_600_000
        const rawManual = sortChron<BreakBlock>(((s.breaks_schedule || []) as BreakBlock[]).filter((b: BreakBlock) => b.is_manual))
        const validManual: BreakBlock[] = []
        if (durHrs >= 3.5) {
            let mealSeen = 0
            for (const b of rawManual) {
                const bStart = new Date(b.start_time).getTime()
                const bEnd = new Date(b.end_time).getTime()
                if (bStart < sMs + ms(20) || bEnd > effEndMs - ms(10)) continue
                if (b.type === 'meal_30' && durHrs < 5) continue
                if (b.type === 'meal_30') {
                    if (mealSeen === 0 && bStart > sMs + ms(299)) continue
                    mealSeen++
                }
                const clashesWithPrev = validManual.some(prev => {
                    const pStart = new Date(prev.start_time).getTime()
                    const pEnd = new Date(prev.end_time).getTime()
                    return bStart < pEnd + ms(30) && bEnd > pStart - ms(30)
                })
                if (clashesWithPrev) continue
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

    function heatBlocks(sMs: number, eMs: number, shiftStartMs: number, shiftEndMs: number): boolean {
        const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
        const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs)
        const shiftMidnightMs = shiftStartMs - ms(60 * startHour) - ms(startMin)
        const peakStartTs = shiftMidnightMs + ms(60 * peak.start)
        const peakEndTs = shiftMidnightMs + ms(60 * peak.end)
        return sMs < peakEndTs && eMs > peakStartTs
    }

    function personalViolation(sMs: number, eMs: number, newType: 'rest_10' | 'meal_30', existing: BreakBlock[]): boolean {
        for (const pb of existing) {
            const ps = new Date(pb.start_time).getTime()
            const pe = new Date(pb.end_time).getTime()
            if (sMs < pe && eMs > ps) return true
            const requiredGap = newType === 'rest_10' && pb.type === 'rest_10' ? GAP_RR_MS :
                newType === 'meal_30' && pb.type === 'meal_30' ? GAP_MM_MS : GAP_MR_MS
            const dist = sMs >= pe ? sMs - pe : ps - eMs
            if (dist < requiredGap) return true
        }
        return false
    }

    function waveViolation(sMs: number, eMs: number, shift: any, isMeal: boolean, mode: WaveMode): boolean {
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
                    if (sameGroupMeal && overlapMs === 0) {
                        const gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_SAME_ROLE_MEAL_MS
                        if (startDiff < gap) return true
                    }
                    if (isLeaderConflict && overlapMs === 0) {
                        const gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_LEADER_MEAL_MS
                        if (startDiff < gap) return true
                    }
                }
                if (!isMeal && slot.type === 'rest_10') {
                    if (sameRole) {
                        const gap = mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_ROLE_REST_MS
                        if (startDiff < gap) return true
                    } else if (sameCat) {
                        const gap = mode === 'relaxed' ? 0 : WAVE_SAME_CAT_REST_MS
                        if (startDiff < gap) return true
                    }
                }
            }
        }
        return false
    }

    function scoreSlot(sMs: number, durMs: number, isMeal: boolean, targetMs: number, shift: any, shiftStartMs: number, bypassPeak: boolean = false): number {
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
            const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
            const { hour: sH, minute: sM } = getLocalHourMinute(shiftStartMs)
            const shiftMidnightMs = shiftStartMs - ms(60 * sH) - ms(sM)
            const pStartTs = shiftMidnightMs + ms(60 * peak.start)
            const pEndTs = shiftMidnightMs + ms(60 * peak.end)
            if (sMs < pEndTs && eMs > pStartTs) {
                peakPenalty = 1e30
            }
        }

        const distPenalty = Math.abs(midMs(sMs, durMs) - targetMs) / ms(1) * 1e15

        let wavePenalty = 0

        for (const slot of globalSlots) {
            if (slot.shiftId !== undefined && slot.shiftId === shift._uid) continue
            if (slot.isGm || thisIsGm) continue
            const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
            const startDiff = Math.abs(sMs - slot.startMs)
            const isSameEmpOtherShift = empId !== null && slot.empId === empId
            const isGroup = slot.roleKey === rk || (cat === 'leader' && slot.category === 'leader') || isSameEmpOtherShift
            const sameCat = slot.category === cat

            if (isMeal && slot.type === 'meal_30') {
                if (sameCat && startDiff < MIN_GAP_LUNCHES_MS) {
                    const ratio = startDiff === 0 ? 1 : (1 - startDiff / MIN_GAP_LUNCHES_MS)
                    wavePenalty += ratio * 1e20
                    if (isGroup && startDiff === 0) wavePenalty += 1e21
                }
            }
            if (!isMeal && slot.type === 'rest_10') {
                if (sameCat && startDiff < MIN_GAP_BREAKS_MS) {
                    const ratio = startDiff === 0 ? 1 : (1 - startDiff / MIN_GAP_BREAKS_MS)
                    wavePenalty += ratio * 1e19
                    if (isGroup && startDiff === 0) wavePenalty += 1e20
                }
            }

            if (isGroup) {
                if (overlapMs > 0) {
                    if (slot.type === (isMeal ? 'meal_30' : 'rest_10') || (cat === 'leader' && slot.category === 'leader')) {
                        const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                        wavePenalty += ratio * 1e32
                    } else {
                        // Solapamiento entre un rest_10 y un meal_30 del mismo rol cuando hay >=3 personas activas:
                        // penalización suave menor a 15m de distPenalty para respetar preferencias aprendidas exactas (ej. 6:20 PM / 6:30 PM)
                        wavePenalty += 4e15
                    }
                } else if (slot.type === (isMeal ? 'meal_30' : 'rest_10')) {
                    const diff = Math.abs(sMs - slot.startMs)
                    const ref = isMeal ? WAVE_SAME_ROLE_MEAL_MS : WAVE_SAME_ROLE_REST_MS
                    if (diff < ref) {
                        const prox = 1 - diff / ref
                        // Penalización suave (menor a 10m de distPenalty = 1e16) cuando no hay solapamiento
                        // para que una preferencia aprendida a 10 min (ej. 12:30 PM y 12:40 PM) se respete al minuto
                        wavePenalty += prox * prox * (isMeal ? 1e20 : 5e14)
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

    function getMealTargetOutsidePeak(wStartMs: number, wEndMs: number, durMs: number, cohortIdx: number, cohortSize: number, shiftStartMs: number, allShiftMealsCount: number, globalMealIndex: number, shiftDurationHrs: number, shift: any): { target: number; bypassHeat: boolean } {
        const shiftEndMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
        const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
        const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs)
        const shiftStartMidnightMs = shiftStartMs - ms(60 * startHour) - ms(startMin)

        const peakStartMs = shiftStartMidnightMs + ms(60 * peak.start)
        const peakEndMs = shiftStartMidnightMs + ms(60 * peak.end)

        const safeBeforeStart = wStartMs
        const safeBeforeEnd = Math.min(wEndMs, peakStartMs + ms(30))
        const safeAfterStart = Math.max(wStartMs, peakEndMs)
        const safeAfterEnd = wEndMs

        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const dayOfWeek = getLocalDayOfWeek(shiftStartMs)
        const idx = (shift._cohortSize && shift._cohortSize > 1) ? shift._cohortIdx : 0
        const size = Math.max((shift._cohortSize && shift._cohortSize > 1) ? shift._cohortSize : 1, 1)

        // ── 1. PREFERENCES CHECK ──
        const matchedPref = findBestLearnedPref(
            learnedPrefs,
            rk,
            dayOfWeek,
            'meal_30',
            globalMealIndex,
            shiftStartMs,
            shiftEndMs,
            idx
        )

        if (matchedPref) {
            const rawTarget = shiftStartMs + ms(matchedPref.offsetMin)
            const clampedTarget = Math.max(wStartMs, Math.min(wEndMs - durMs, rawTarget))
            const touchesPeak = heatBlocks(clampedTarget, clampedTarget + durMs, shiftStartMs, shiftEndMs)
            const allowBypass = !touchesPeak || clampedTarget <= peakStartMs + ms(60) || matchedPref.exactStartHour
            console.warn(`   → 🧠 LEARNED PREFERENCE applied for ${rk} (cohort ${idx}/${size}) meal#${globalMealIndex}: offset ${matchedPref.offsetMin}m -> target ${new Date(clampedTarget).toLocaleTimeString()} (bypassHeat=${allowBypass})`)
            return { target: midMs(clampedTarget, durMs), bypassHeat: allowBypass }
        }

        // ── 2. HEURÍSTICA INTELIGENTE SLAUSON (Cuando no hay override previo) ──
        const postPeakSpace = Math.max(0, safeAfterEnd - safeAfterStart)
        const prePeakSpace = Math.max(0, safeBeforeEnd - safeBeforeStart)
        const postFits = postPeakSpace >= durMs
        const preFits = prePeakSpace >= durMs

        if (cat === 'leader') {
            const isSeniorLeader = rk.includes('asst') || rk.includes('assistant') || rk.includes('asistente') || (rk.includes('manager') && !rk.includes('shift'))
            const isLateLeader = startHour >= 19
            const shouldGoPostPeak = (size === 1 && (isSeniorLeader || isLateLeader || startHour >= 16)) || idx === 1 || (idx >= 2 && (safeAfterStart + ms(40) + durMs <= safeAfterEnd))

            if (shouldGoPostPeak && postFits) {
                const postRank = size === 1 ? 0 : (idx - 1)
                const postOffset = postRank === 0 ? ms(10) : ms(10) + postRank * ms(30)
                const best = Math.min(safeAfterEnd - durMs, safeAfterStart + postOffset)
                console.warn(`   → 👔 LEADER POST-PEAK para ${shift.employee_name} (${rk}, cohort ${idx}/${size}): target=${new Date(best).toLocaleTimeString()}`)
                return { target: midMs(best, durMs), bypassHeat: false }
            }
            if (shouldGoPostPeak && !postFits && startHour < 12 && (wEndMs - durMs) >= peakStartMs + ms(60)) {
                const lateWindowBest = Math.max(peakStartMs + ms(70), wEndMs - durMs - ms(5))
                console.warn(`   → 👔 LEADER LATE-WINDOW (Post-12PM Rush) para ${shift.employee_name} (${rk}): target=${new Date(lateWindowBest).toLocaleTimeString()}`)
                return { target: midMs(lateWindowBest, durMs), bypassHeat: true }
            }
            if (preFits) {
                const preRank = idx === 0 ? 0 : (idx - 1)
                const basePre = (startHour < 12 && idx === 0 && safeBeforeStart + ms(60) <= safeBeforeEnd - durMs)
                    ? safeBeforeStart + ms(60)
                    : safeBeforeStart + preRank * ms(30)
                const best = Math.min(safeBeforeEnd - durMs, basePre)
                console.warn(`   → 👔 LEADER PRE-PEAK para ${shift.employee_name} (${rk}, cohort ${idx}/${size}): target=${new Date(best).toLocaleTimeString()}`)
                return { target: midMs(best, durMs), bypassHeat: true }
            }
        }

        if (startHour < 12) {
            const rawTarget = Math.min(wEndMs - durMs, wStartMs + idx * ms(30))
            const best = preFits ? Math.min(safeBeforeEnd - durMs, rawTarget) : rawTarget
            console.warn(`   → 🌅 AM CREW PRE-PEAK para ${shift.employee_name} (${rk}, cohort ${idx}/${size}): target=${new Date(best).toLocaleTimeString()}`)
            return { target: midMs(best, durMs), bypassHeat: true }
        }

        if (startHour >= 12 && startHour < 15) {
            if (postFits) {
                const best = Math.min(safeAfterEnd - durMs, safeAfterStart + idx * ms(20))
                console.warn(`   → ☀️ MIDDAY CREW POST-PEAK para ${shift.employee_name} (${rk}): target=${new Date(best).toLocaleTimeString()}`)
                return { target: midMs(best, durMs), bypassHeat: false }
            }
            const best = Math.min(wEndMs - durMs, shiftStartMs + ms(120) + idx * ms(20))
            return { target: midMs(best, durMs), bypassHeat: true }
        }

        const isLateNightRush = peak.start >= 20
        if (startHour <= 17) {
            const step = ms(30)
            const rawBest = Math.min(wEndMs - durMs, wStartMs + idx * step)
            const best = isLateNightRush ? Math.min(peakStartMs - durMs, rawBest) : rawBest
            console.warn(`   → 🌙 PM 5PM CREW WAVE para ${shift.employee_name} (${rk}, cohort ${idx}/${size}): target=${new Date(best).toLocaleTimeString()}`)
            return { target: midMs(best, durMs), bypassHeat: !isLateNightRush }
        }

        if (startHour === 18) {
            const offsetBase = ms(90)
            const step = ms(30)
            const rawBest = Math.min(wEndMs - durMs, shiftStartMs + offsetBase + idx * step)
            const best = isLateNightRush ? Math.min(peakStartMs - durMs, rawBest) : rawBest
            console.warn(`   → 🌙 PM 6PM CREW WAVE para ${shift.employee_name} (${rk}, cohort ${idx}/${size}): target=${new Date(best).toLocaleTimeString()}`)
            return { target: midMs(best, durMs), bypassHeat: !isLateNightRush }
        }

        if (postFits) {
            const best = Math.min(safeAfterEnd - durMs, safeAfterStart + idx * ms(20))
            return { target: midMs(best, durMs), bypassHeat: false }
        }
        const fallbackBest = Math.min(wEndMs - durMs, shiftStartMs + ms(90) + idx * ms(20))
        return { target: midMs(fallbackBest, durMs), bypassHeat: true }
    }

    function findSlot(wStartMs: number, wEndMs: number, durationMins: number, personalBreaks: BreakBlock[], shift: any, isMeal: boolean, targetMs: number, shiftStartMs: number, shiftEndMs: number, bypassHeatBlocks: boolean = false): Date {
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

        const countSameRoleOnDuty = (tStart: number, tEnd: number): number => {
            let cnt = 0
            for (const other of augmented) {
                const oS = new Date(other.start_time).getTime()
                const oE = other._effEndMs ?? new Date(other.end_time).getTime()
                if (getRoleKey(other) === rk && tStart < oE && tEnd > oS) cnt++
            }
            return cnt
        }

        const filterPool = (candList: number[], ignorePeak: boolean, ignoreRoleOverlap: boolean): number[] => {
            return candList.filter(t => {
                if (!ignorePeak && heatBlocks(t, t + durMs, shiftStartMs, shiftEndMs)) return false
                if (personalViolation(t, t + durMs, type, personalBreaks)) return false
                for (const slot of globalSlots) {
                    if (slot.shiftId !== undefined && slot.shiftId === shift._uid) continue
                    if (slot.isGm || thisIsGm) continue
                    if (empId !== null && slot.empId === empId) {
                        if (t < slot.endMs + ms(30) && (t + durMs) > slot.startMs - ms(30)) return false
                    }
                    if (!ignoreRoleOverlap) {
                        const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                        const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                        if (overlapMs > 0 && (slot.roleKey === rk || isLeaderConflict)) {
                            // Dos breaks del mismo tipo (meal_30+meal_30 o rest_10+rest_10) o dos líderes NUNCA se solapan.
                            // Si es un rest_10 coexistiendo con un meal_30 del mismo rol (ej. cajera en break de 10m mientras otra cajera come),
                            // se permite únicamente si hay >= 3 empleados de ese rol activos en ese momento.
                            if (isLeaderConflict || slot.type === type) {
                                return false
                            }
                            if (countSameRoleOnDuty(t, t + durMs) < 3) {
                                return false
                            }
                        }
                    }
                }
                return true
            })
        }

        const hardValid = filterPool(candidates, bypassHeatBlocks, false)

        let pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'normal'))
        if (pool.length === 0) {
            pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'relaxed'))
        }
        if (pool.length === 0) {
            pool = hardValid
        }

        const isSecondMealWindow = isMeal && safeWStart >= shiftStartMs + ms(60 * (H_SECOND_MEAL_START - 0.5))
        const fallbackStart = isSecondMealWindow ? safeWStart : shiftStartMs + ms(45)
        const fallbackEnd = isMeal
            ? (isSecondMealWindow ? shiftEndMs - ms(45) : Math.min(shiftStartMs + ms(60 * H_FIRST_MEAL_MAX), shiftEndMs - ms(45)))
            : shiftEndMs - ms(30)
        const fullShiftCandidates = buildCandidates(fallbackStart, fallbackEnd)

        if (pool.length === 0) {
            pool = filterPool(candidates, true, false)
        }
        if (pool.length === 0) {
            pool = filterPool(fullShiftCandidates, true, false)
        }

        const buildRelaxedFilter = (candList: number[], ignoreRole: boolean) => candList.filter(t => {
            for (const pb of personalBreaks) {
                const ps = new Date(pb.start_time).getTime()
                const pe = new Date(pb.end_time).getTime()
                const minGap = (isMeal && pb.type === 'meal_30') ? GAP_MM_MS : ms(40)
                if (t < pe + minGap && (t + durMs) > ps - minGap) return false
            }
            for (const slot of globalSlots) {
                if (slot.shiftId !== undefined && slot.shiftId === shift._uid) continue
                if (slot.isGm || thisIsGm) continue
                if (empId !== null && slot.empId === empId) {
                    if (t < slot.endMs + ms(30) && (t + durMs) > slot.startMs - ms(30)) return false
                }
                if (!ignoreRole) {
                    const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                    const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                    if ((slot.roleKey === rk || isLeaderConflict) && overlapMs > 0) return false
                }
            }
            return true
        })

        if (pool.length === 0) {
            pool = buildRelaxedFilter(candidates, false)
        }
        if (pool.length === 0) {
            pool = buildRelaxedFilter(fullShiftCandidates, false)
        }

        if (pool.length === 0) {
            pool = filterPool(fullShiftCandidates, true, true)
        }
        if (pool.length === 0) {
            pool = buildRelaxedFilter(candidates, true)
        }

        if (pool.length === 0) {
            const emergencyCandidates = buildCandidates(shiftStartMs + ms(30), shiftEndMs - ms(20)).filter(t => {
                for (const pb of personalBreaks) {
                    const ps = new Date(pb.start_time).getTime()
                    const pe = new Date(pb.end_time).getTime()
                    if (t < pe + ms(30) && (t + durMs) > ps - ms(30)) return false
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
                        if (t < pe && t + durMs > ps) { minDist = -1; break }
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
            const cost = scoreSlot(t, durMs, isMeal, targetMs, shift, shiftStartMs, bypassHeatBlocks)
            if (cost < bestCost) { bestCost = cost; bestSlot = t }
        }
        return new Date(bestSlot)
    }

    function countCoolMealSlots(shift: any, shiftStartMs: number): number {
        const sMs = shiftStartMs
        const eMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
        const durationHrs = (eMs - sMs) / 3_600_000
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
        const durA = eMsA - sMsA
        const durB = eMsB - sMsB

        // PRIORIDAD 1 (REGLA MANAGER JESÚS): Empleados que salen más temprano (end_time menor) van a lunch primero
        if (eMsA !== eMsB) return eMsA - eMsB

        // PRIORIDAD 2: A igual hora de salida, los que entraron antes (start_time más temprano)
        if (sMsA !== sMsB) return sMsA - sMsB

        // PRIORIDAD 3: Turnos más cortos
        if (durA !== durB) return durA - durB

        const aCool = countCoolMealSlots(a, sMsA)
        const bCool = countCoolMealSlots(b, sMsB)
        if (aCool !== bCool) return aCool - bCool
        const aCat = getRoleCategory(rkA), bCat = getRoleCategory(rkB)
        if (aCat === 'leader' && bCat !== 'leader') return -1
        if (bCat === 'leader' && aCat !== 'leader') return 1
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
        const totalMealsForShift = meals.length

        meals.forEach((_, loopIdx) => {
            const globalMealIndex = manualMealsCount + loopIdx
            let wStartMs: number, wEndMs: number
            const shiftDurationMs = eMs - sMs
            const durationHrs = shiftDurationMs / (1000 * 60 * 60)

            if (globalMealIndex === 0) {
                wStartMs = sMs + ms(60 * hMinStart(durationHrs))
                wEndMs = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), endBuf)
            } else {
                wStartMs = sMs + ms(60 * H_SECOND_MEAL_START)
                wEndMs = Math.min(sMs + ms(60 * H_SECOND_MEAL_END), endBuf)
            }
            if (wEndMs - wStartMs < ms(60)) wEndMs = Math.min(endBuf, wStartMs + ms(90))

            const { target: targetMs, bypassHeat } = getMealTargetOutsidePeak(
                wStartMs,
                wEndMs,
                ms(30),
                loopIdx,
                totalMealsForShift,
                sMs,
                totalMealsForShift,
                globalMealIndex,
                durationHrs,
                shift
            )

            const best = findSlot(wStartMs, wEndMs, 30, shift.breaks_schedule, shift, true, targetMs, sMs, eMs, bypassHeat)
            const bestEnd = new Date(best.getTime() + ms(30))
            shift.breaks_schedule.push({ type: 'meal_30', start_time: toIso(best), end_time: toIso(bestEnd), status: 'scheduled' })
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
            console.warn(`🍽️ ${shift.employee_name} meal#${globalMealIndex + 1} → ${best.toLocaleTimeString()} (heat=${spanHeat(best.getTime(), bestEnd.getTime(), getHeat).toFixed(2)})`)
        })
        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 2 — RESTS (Descansos de 10 min relativos al Lunch y acotados al turno)
    // ══════════════════════════════════════════════════════════════════════════
    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = shift._effEndMs ?? new Date(shift.end_time).getTime()
        getHeat = buildHeatFn(operatingHours, sMs, eMs)
        const req = getRequiredBreaks(sMs, eMs)
        const allRests = req.filter(b => b.type === 'rest_10')
        const manualRestsCount = shift.breaks_schedule.filter((b: BreakBlock) => b.type === 'rest_10' && b.is_manual).length
        const rests = allRests.slice(manualRestsCount)
        if (rests.length === 0) continue

        const shiftDurationHrs = (eMs - sMs) / 3_600_000
        const minStart = sMs + ms(60 * hMinStartRest(shiftDurationHrs))
        const endBufferHrs = shiftDurationHrs > 10 ? 1.25 : shiftDurationHrs > 8 ? 0.9 : 0.67
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

        // Consultar si existe preferencia aprendida para el 1er descanso (rest_10#0)
        // para respetar si el mánager lo entrenó ANTES o DESPUÉS del Lunch:
        const firstRestPref = findBestLearnedPref(
            learnedPrefs,
            rk,
            dayOfWeek,
            'rest_10',
            0,
            sMs,
            eMs,
            cohortIdx
        )

        let isEarlyMeal = false
        if (firstMealStartMs !== null && firstMealEndMs !== null) {
            if (firstRestPref) {
                const prefRest0Ms = sMs + ms(firstRestPref.offsetMin)
                if (prefRest0Ms >= firstMealEndMs + ms(15)) {
                    isEarlyMeal = true
                } else if (prefRest0Ms <= firstMealStartMs - ms(25) && (firstMealStartMs - sMs) >= ms(140)) {
                    isEarlyMeal = false
                } else {
                    isEarlyMeal = (firstMealStartMs - sMs) <= (cat === 'leader' ? ms(160) : ms(185))
                }
            } else {
                isEarlyMeal = (firstMealStartMs - sMs) <= (cat === 'leader' ? ms(160) : ms(185))
            }
        }

        for (let i = 0; i < rests.length; i++) {
            const globalRestIndex = manualRestsCount + i
            let segStart = minStart
            let segEnd = endBuf
            let naturalTargetMs = sMs + (eMs - sMs) * 0.50 + cohortStaggerMs

            if (!firstMeal || firstMealStartMs === null || firstMealEndMs === null) {
                // Turno corto (<= 6h, sin lunch): único break justo a mitad de turno (50%)
                segStart = minStart
                segEnd = endBuf
                const frac = allRests.length === 1 ? 0.50 : (globalRestIndex + 1) / (allRests.length + 1)
                naturalTargetMs = sMs + (eMs - sMs) * frac + cohortStaggerMs
            } else if (isEarlyMeal) {
                // Lunch temprano (Pre-Peak): todos los rests van después del lunch,
                // reservando espacio al final del turno para los rests faltantes (impidiendo que rest#0 se vaya al final)
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
                const remainingRestsAfterThis = Math.max(0, rests.length - 1 - i)
                const reservedTailMs = remainingRestsAfterThis * (GAP_RR_MS + ms(10))
                segEnd = Math.max(segStart + ms(30), endBuf - reservedTailMs)
                const remShiftMs = eMs - firstMealEndMs
                const idealPoint = firstMealEndMs + remShiftMs * ((globalRestIndex + 1) / (allRests.length + 1)) + cohortStaggerMs
                naturalTargetMs = Math.max(segStart, Math.min(segEnd - ms(10), idealPoint))
            } else {
                // Lunch tardío / Post-Peak: rest #0 va ANTES del lunch, rests siguientes van DESPUÉS del lunch
                const hasPreMealRest = (shift.breaks_schedule as BreakBlock[]).some(
                    b => b.type === 'rest_10' && new Date(b.start_time).getTime() < firstMealStartMs
                )
                if (!hasPreMealRest && (firstMealStartMs - GAP_MR_MS) >= (minStart + ms(10))) {
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
                    const remainingRestsAfterThis = Math.max(0, rests.length - 1 - i)
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

            // ── PREFERENCES CHECK FOR REST ──
            const matchedRestPref = findBestLearnedPref(
                learnedPrefs,
                rk,
                dayOfWeek,
                'rest_10',
                globalRestIndex,
                sMs,
                eMs,
                cohortIdx
            )

            if (matchedRestPref) {
                const candidateTargetMs = sMs + ms(matchedRestPref.offsetMin)
                if (candidateTargetMs >= segStart - ms(30) && candidateTargetMs <= segEnd + ms(30)) {
                    targetMs = Math.max(segStart, Math.min(segEnd - ms(10), candidateTargetMs))
                    bypassHeatSnap = true
                    console.warn(`   → 🧠 LEARNED PREFERENCE applied for ${rk} rest#${globalRestIndex}: offset ${matchedRestPref.offsetMin}m -> target ${new Date(targetMs).toLocaleTimeString()}`)
                }
            }

            // ── HEAT-SNAP moderado para rests (solo si no hay preferencia aprendida) ──
            const existingPersonalBreaks = (shift.breaks_schedule as BreakBlock[]).map((b: BreakBlock) => ({
                ms: new Date(b.start_time).getTime(),
                endMs: new Date(b.end_time).getTime(),
                gap: b.type === 'rest_10' ? GAP_RR_MS : GAP_MR_MS
            }))
            const scanRadius = shiftDurationHrs <= 6 ? ms(20) : ms(35)
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
                if (h < heatBestScore) { heatBestScore = h; heatBest = t }
            }

            const originalHeat = spanHeat(targetMs, targetMs + ms(10), getHeat)
            if (!bypassHeatSnap && heatBestScore < Infinity && heatBestScore < originalHeat * 0.85) {
                targetMs = heatBest
            }

            const best = findSlot(segStart, segEnd, 10, shift.breaks_schedule, shift, false, midMs(targetMs, ms(10)), sMs, eMs, true)
            const bestEnd = new Date(best.getTime() + ms(10))
            shift.breaks_schedule.push({ type: 'rest_10', start_time: toIso(best), end_time: toIso(bestEnd), status: 'scheduled' })
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
            console.warn(`☕ ${shift.employee_name} rest#${globalRestIndex + 1} → ${best.toLocaleTimeString()} seg=[${new Date(segStart).toLocaleTimeString()}-${new Date(segEnd).toLocaleTimeString()}] (target=${new Date(targetMs).toLocaleTimeString()})`)
        }
        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    getHeat = buildHeatFn(operatingHours)
    console.warn('─'.repeat(60))
    console.warn('📋 RESUMEN FINAL DE BREAKS ENGINE V28:')
    let violations = 0
    for (const shift of augmented) {
        const sched = sortChron(shift.breaks_schedule) as BreakBlock[]
        const log = sched.map(b => {
            const t = new Date(b.start_time).toLocaleTimeString()
            const h = spanHeat(new Date(b.start_time).getTime(), new Date(b.end_time).getTime(), getHeat)
            const hFlag = h >= HEAT_MEAL ? '🔴' : h >= HEAT_REST ? '🟠' : h >= 0.50 ? '🟡' : '🟢'
            return `${b.type === 'meal_30' ? '🍽️' : '☕'} ${t} ${hFlag}${h.toFixed(2)}`
        }).join('  |  ')
        for (let i = 0; i < sched.length; i++) {
            for (let j = i + 1; j < sched.length; j++) {
                const a = sched[i], b = sched[j]
                const ae = new Date(a.end_time).getTime(), bs = new Date(b.start_time).getTime()
                const gap = bs - ae
                const req = a.type === b.type ? (a.type === 'rest_10' ? GAP_RR_MS : GAP_MM_MS) : GAP_MR_MS
                if (gap < req) {
                    console.warn(`🚨 VIOLATION: ${shift.employee_name} gap=${Math.round(gap / 60000)}min < req=${Math.round(req / 60000)}min`)
                    violations++
                }
            }
        }
        console.warn(`👤 ${(shift.employee_name || shift.employee_id || '?').toString().padEnd(22)} | ${log}`)
    }
    if (violations === 0) console.warn('✅ Sin violaciones de spacing personal detectadas')
    else console.warn(`🚨 ${violations} violaciones de spacing detectadas`)
    console.warn('─'.repeat(60))

    return augmented as Shift[]
}
