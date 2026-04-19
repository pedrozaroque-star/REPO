import { Shift } from '@/app/planificador-v2/lib/types'
import { OperatingHour } from '@/lib/intelligence'

// ══════════════════════════════════════════════════════════════════════════════
//  BREAKS ENGINE V25 — ESPACIADO ESTRICTO PARA BREAKS Y LUNCHES FUERA DE PICO
//
//  NUEVO:
//  ✅ Los breaks también bloqueados en zona de pico (no solo lunches)
//  ✅ Espaciado mínimo de 30 min entre breaks de distintos empleados
//  ✅ Espaciado mínimo de 45 min entre lunches de distintos empleados
//  ✅ Distribución equiespaciada dentro del intervalo post-pico
//  ✅ Aumento de gap relaxed para rests (30 min) y meals (30 min)
// ══════════════════════════════════════════════════════════════════════════════

export type BreakBlock = {
    type: 'rest_10' | 'meal_30'
    start_time: string
    end_time: string
    status?: 'scheduled' | 'taken' | 'waived'
}

type RoleCategory = 'leader' | 'foh' | 'boh'

type GlobalSlot = {
    type: 'rest_10' | 'meal_30'
    startMs: number
    endMs: number
    roleKey: string
    category: RoleCategory
    empId: string | number | null
}

type WaveMode = 'normal' | 'relaxed' | 'off'

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTES (heredadas + nuevas)
// ─────────────────────────────────────────────────────────────────────────────

const HEAT_MEAL = 0.78
const HEAT_REST = 0.70

const GAP_RR_MS = 90 * 60_000
const GAP_MM_MS = 120 * 60_000
const GAP_MR_MS = 45 * 60_000

// Nuevos gaps entre empleados distintos (no importa el rol)
const MIN_GAP_BREAKS_MS = 30 * 60_000   // 30 min entre breaks de distintas personas
const MIN_GAP_LUNCHES_MS = 45 * 60_000  // 45 min entre lunches de distintas personas

// Wave gaps originales (ahora con relaxed más estricto)
const WAVE_SAME_ROLE_MEAL_MS = 30 * 60_000
const WAVE_LEADER_MEAL_MS = 30 * 60_000
const WAVE_SAME_ROLE_REST_MS = 75 * 60_000
const WAVE_SAME_CAT_REST_MS = 60 * 60_000
const WAVE_CROSS_REST_MS = 30 * 60_000

const WAVE_MIN_MEAL_MS = 30 * 60_000   // antes 20, ahora 30
const WAVE_MIN_REST_MS = 30 * 60_000   // antes 15, ahora 30

const SLOT_STEP_MS = 10 * 60_000
const H_MIN_START = 1.0
const H_END_BUFFER = 1.0
const H_FIRST_MEAL_MAX = 5.0
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
//  HORARIO LOCAL FIABLE
// ─────────────────────────────────────────────────────────────────────────────

function getLocalHourMinute(tMs: number): { hour: number; minute: number } {
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
    return { hour, minute }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ZONA DE PICO SEGÚN TURNO (AM: 12-14h, PM: 19-21h)
// ─────────────────────────────────────────────────────────────────────────────

function getPeakHoursForShift(shiftStartMs: number): { start: number; end: number } {
    const { hour } = getLocalHourMinute(shiftStartMs)
    if (hour >= 4 && hour < 12) {
        return { start: 12, end: 14 }
    }
    return { start: 19, end: 21 }
}

function isInPeakZoneForShift(tMs: number, shiftStartMs: number): boolean {
    const peak = getPeakHoursForShift(shiftStartMs)
    const { hour, minute } = getLocalHourMinute(tMs)
    const hourFloat = hour + minute / 60
    if (hourFloat >= peak.start && hourFloat < peak.end) {
        const distToStart = (hourFloat - peak.start) * 60
        const distToEnd = (peak.end - hourFloat) * 60
        if (distToStart >= 15 && distToEnd >= 15) {
            return true
        }
    }
    return false
}

// ─────────────────────────────────────────────────────────────────────────────
//  HEATMAP (solo para scoring)
// ─────────────────────────────────────────────────────────────────────────────

function buildHeatFn(operatingHours: OperatingHour[]): (tMs: number) => number {
    const MOCK: Record<number, number> = {
        6: 10, 7: 30, 8: 80, 9: 150, 10: 300, 11: 600, 12: 950, 13: 850, 14: 400,
        15: 250, 16: 300, 17: 500, 18: 800, 19: 900, 20: 750, 21: 500, 22: 300, 23: 150,
        0: 50, 1: 20, 2: 10, 3: 5
    }
    const scores = new Map<number, number>()
    let maxS = operatingHours.length > 0 ? Math.max(...operatingHours.map(h => Number(h.projected_sales || 0))) : 0
    if (maxS < 10) {
        maxS = 950
        for (const [h, s] of Object.entries(MOCK)) scores.set(parseInt(h), s / maxS)
    } else {
        for (const h of operatingHours) scores.set(normalizeHour(Number(h.hour)), Number(h.projected_sales || 0) / maxS)
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
        const block = Math.floor(new Date(s.start_time).getTime() / ms(30))
        const cat = getRoleCategory(getRoleKey(s))
        const key = `${block}|${cat}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(s)
    }
    for (const group of groups.values()) {
        group.forEach((s, i) => {
            s._cohortIdx = i
            s._cohortSize = group.length
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function scheduleBreaksWithDemand(shifts: Shift[], operatingHours: OperatingHour[]): Shift[] {
    console.warn('%c🧠 BREAKS ENGINE V25 — ESPACIADO ESTRICTO (30/45 min entre distintos)', 'background:#0f2447;color:#60a5fa;font-size:14px;font-weight:bold;padding:4px 10px;border-radius:4px')

    const getHeat = buildHeatFn(operatingHours)
    const augmented: any[] = shifts.map(s => ({ ...s, breaks_schedule: [] as BreakBlock[] }))
    assignCohorts(augmented)
    const globalSlots: GlobalSlot[] = []

    // ────────────────────────────────────────────────────────────────────────
    //  HEAT BLOCKS: bloqueo de zona de pico para CUALQUIER break (meal o rest)
    // ────────────────────────────────────────────────────────────────────────
    function heatBlocks(sMs: number, eMs: number, shiftStartMs: number): boolean {
        for (let t = sMs; t < eMs; t += ms(1)) {
            if (isInPeakZoneForShift(t, shiftStartMs)) {
                console.warn(`🚫 BLOQUEADO por PICO DE TURNO: ${new Date(sMs).toLocaleTimeString()} - ${new Date(eMs).toLocaleTimeString()}`)
                return true
            }
        }
        return false
    }

    // ────────────────────────────────────────────────────────────────────────
    //  VIOLACIONES PERSONALES (mismo empleado)
    // ────────────────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────────────────
    //  VIOLACIONES DE OLA (con espaciado mínimo entre distintos empleados)
    // ────────────────────────────────────────────────────────────────────────
    function waveViolation(sMs: number, eMs: number, shift: any, isMeal: boolean, mode: WaveMode): boolean {
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        for (const slot of globalSlots) {
            if (slot.empId !== null && slot.empId === empId) continue
            const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
            const startDiff = Math.abs(sMs - slot.startMs)
            const sameRole = slot.roleKey === rk
            const sameCat = slot.category === cat
            const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
            const sameGroupMeal = sameRole || isLeaderConflict

            // BLOQUEOS DUROS
            // 1. Ningún lunch se solapa con otro lunch (cualquier empleado)
            if (isMeal && slot.type === 'meal_30' && overlapMs > 0) {
                console.warn(`🚫 BLOQUEO TOTAL: lunch de ${shift.employee_name} solapa con lunch de ${slot.roleKey}`)
                return true
            }
            // 2. Ningún rest se solapa con otro rest
            if (!isMeal && slot.type === 'rest_10' && overlapMs > 0) return true
            // 3. Ningún rest se solapa con meal de otro
            if (!isMeal && slot.type === 'meal_30' && overlapMs > 0) return true

            // NUEVO: Espaciado mínimo entre lunches de distintos empleados (aunque no se solapen)
            if (isMeal && slot.type === 'meal_30' && overlapMs === 0) {
                if (startDiff < MIN_GAP_LUNCHES_MS) {
                    console.warn(`🚫 Espaciado insuficiente entre lunches: ${shift.employee_name} y ${slot.roleKey} (${Math.round(startDiff / 60000)}min < 45min)`)
                    return true
                }
            }
            // NUEVO: Espaciado mínimo entre breaks de distintos empleados
            if (!isMeal && slot.type === 'rest_10' && overlapMs === 0) {
                if (startDiff < MIN_GAP_BREAKS_MS) {
                    console.warn(`🚫 Espaciado insuficiente entre breaks: ${shift.employee_name} y ${slot.roleKey} (${Math.round(startDiff / 60000)}min < 30min)`)
                    return true
                }
            }

            // Restricciones suaves (wave gaps por rol)
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
                    const gap = sameRole ? (mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_ROLE_REST_MS) :
                        sameCat ? (mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_CAT_REST_MS) :
                            WAVE_CROSS_REST_MS
                    if (startDiff < gap) return true
                }
            }
        }
        return false
    }

    // ────────────────────────────────────────────────────────────────────────
    //  SCORING con penalización adicional por cercanía
    // ────────────────────────────────────────────────────────────────────────
    function scoreSlot(sMs: number, durMs: number, isMeal: boolean, targetMs: number, shift: any, shiftStartMs: number): number {
        const eMs = sMs + durMs
        const h = spanHeat(sMs, eMs, getHeat)
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        const heatPenalty = Math.pow(h, 12) * 1e18

        let peakPenalty = 0
        for (let t = sMs; t < eMs; t += ms(1)) {
            if (isInPeakZoneForShift(t, shiftStartMs)) {
                peakPenalty = 1e30
                break
            }
        }

        const distPenalty = Math.abs(midMs(sMs, durMs) - targetMs) / ms(1) * 4e6
        let wavePenalty = 0

        for (const slot of globalSlots) {
            if (slot.empId !== null && slot.empId === empId) continue
            const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
            const startDiff = Math.abs(sMs - slot.startMs)
            const isGroup = slot.roleKey === rk || (cat === 'leader' && slot.category === 'leader')

            // Penalizar cercanía excesiva entre lunches (aunque no se solapen)
            if (isMeal && slot.type === 'meal_30') {
                if (startDiff < MIN_GAP_LUNCHES_MS) {
                    const ratio = startDiff === 0 ? 1 : (1 - startDiff / MIN_GAP_LUNCHES_MS)
                    wavePenalty += ratio * 1e15
                    if (startDiff === 0) wavePenalty += 1e16 // Maximo castigo a colisiones exactas cruzadas
                }
            }
            // Penalizar cercanía excesiva entre breaks
            if (!isMeal && slot.type === 'rest_10') {
                if (startDiff < MIN_GAP_BREAKS_MS) {
                    const ratio = startDiff === 0 ? 1 : (1 - startDiff / MIN_GAP_BREAKS_MS)
                    wavePenalty += ratio * 1e14
                    if (startDiff === 0) wavePenalty += 1e15
                }
            }

            if (isGroup) {
                if (overlapMs > 0) {
                    const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                    wavePenalty += ratio * 5e12
                } else if (slot.type === (isMeal ? 'meal_30' : 'rest_10')) {
                    const diff = Math.abs(sMs - slot.startMs)
                    const ref = isMeal ? WAVE_SAME_ROLE_MEAL_MS : WAVE_SAME_ROLE_REST_MS
                    if (diff < ref) {
                        const prox = 1 - diff / ref
                        wavePenalty += prox * prox * 4e9
                    }
                    if (isMeal && diff < 30 * 60_000) wavePenalty += 1e12
                    if (!isMeal && diff < 45 * 60_000) wavePenalty += 5e11
                }
            }
        }
        return heatPenalty + peakPenalty + distPenalty + wavePenalty
    }

    // ────────────────────────────────────────────────────────────────────────
    //  TARGET PARA LUNCH: distribución equiespaciada dentro del intervalo post-pico
    // ────────────────────────────────────────────────────────────────────────
    function getMealTargetOutsidePeak(wStartMs: number, wEndMs: number, durMs: number, cohortIdx: number, cohortSize: number, shiftStartMs: number, allShiftMealsCount: number, globalMealIndex: number): number {
        const peak = getPeakHoursForShift(shiftStartMs)
        const refDate = new Date(2000, 0, 1, 0, 0, 0).getTime()
        const peakStartMs = refDate + ms(60 * peak.start)
        const peakEndMs = refDate + ms(60 * peak.end)

        const safeBeforeStart = Math.max(wStartMs, refDate + ms(60 * (peak.start - 1)))
        const safeBeforeEnd = Math.min(wEndMs, peakStartMs)
        const safeAfterStart = Math.max(wStartMs, peakEndMs)
        const safeAfterEnd = wEndMs

        let targetInterval: { start: number; end: number } | null = null
        let isAfterPeak = false

        // Decidir si este lunch va antes o después del pico según el índice global de meals del turno
        // Mitad de los meals del turno van antes, mitad después
        const midPoint = Math.ceil(allShiftMealsCount / 2)
        if (globalMealIndex < midPoint && (safeBeforeEnd - safeBeforeStart) >= durMs) {
            targetInterval = { start: safeBeforeStart, end: safeBeforeEnd }
            isAfterPeak = false
        } else if ((safeAfterEnd - safeAfterStart) >= durMs) {
            targetInterval = { start: safeAfterStart, end: safeAfterEnd }
            isAfterPeak = true
        } else if ((safeBeforeEnd - safeBeforeStart) >= durMs) {
            targetInterval = { start: safeBeforeStart, end: safeBeforeEnd }
            isAfterPeak = false
        } else {
            // Fallback: toda la ventana
            const frac = cohortSize > 1 ? cohortIdx / (cohortSize - 1) : 0.5
            return wStartMs + (wEndMs - wStartMs) * frac
        }

        // Si es después del pico y hay más de un lunch en ese intervalo, distribuir equiespaciadamente
        // Para eso necesitamos saber cuántos lunches van a ese intervalo. Como no lo sabemos aún,
        // usamos una estimación: los que tienen globalMealIndex >= midPoint.
        // En la práctica, se llamará secuencialmente y podemos usar una variable global o pasar el total.
        // Simplificamos: usamos el índice dentro del subgrupo (globalMealIndex - midPoint) y el tamaño del subgrupo.
        const subGroupSize = Math.max(1, allShiftMealsCount - midPoint)
        const idxInSubGroup = isAfterPeak ? globalMealIndex - midPoint : globalMealIndex
        const subGroupIdx = Math.min(idxInSubGroup, subGroupSize - 1)

        let rawTarget: number
        if (isAfterPeak && subGroupSize > 1) {
            // Distribución equiespaciada: 0% y 100% de la ventana, con espaciado uniforme
            const step = (targetInterval.end - targetInterval.start - durMs) / (subGroupSize - 1)
            rawTarget = targetInterval.start + step * subGroupIdx
        } else {
            const frac = subGroupSize > 1 ? subGroupIdx / (subGroupSize - 1) : 0.5
            rawTarget = targetInterval.start + (targetInterval.end - targetInterval.start - durMs) * frac
        }

        const snapWindow = ms(10)
        let best = rawTarget
        let bestH = Infinity
        for (let t = rawTarget - snapWindow; t <= rawTarget + snapWindow; t += SLOT_STEP_MS) {
            if (t < targetInterval.start || t + durMs > targetInterval.end) continue
            const h = spanHeat(t, t + durMs, getHeat)
            if (h < bestH) { bestH = h; best = t }
        }
        return midMs(best, durMs)
    }

    // ────────────────────────────────────────────────────────────────────────
    //  FIND SLOT (con shiftStartMs para heatBlocks)
    // ────────────────────────────────────────────────────────────────────────
    function findSlot(wStartMs: number, wEndMs: number, durationMins: number, personalBreaks: BreakBlock[], shift: any, isMeal: boolean, targetMs: number, shiftStartMs: number): Date {
        const durMs = ms(durationMins)
        const type = isMeal ? 'meal_30' : 'rest_10'
        const gridFirst = Math.ceil(wStartMs / SLOT_STEP_MS) * SLOT_STEP_MS
        const candidates: number[] = []
        for (let t = gridFirst; t <= wEndMs - durMs; t += SLOT_STEP_MS) candidates.push(t)
        if (candidates.length === 0) return new Date(wStartMs)

        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        const hardValid = candidates.filter(t => {
            if (heatBlocks(t, t + durMs, shiftStartMs)) return false
            if (personalViolation(t, t + durMs, type, personalBreaks)) return false
            for (const slot of globalSlots) {
                if (slot.empId !== null && slot.empId === empId) continue
                const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                if (isMeal && slot.type === 'meal_30' && overlapMs > 0) return false
                if (!isMeal && slot.type === 'rest_10' && overlapMs > 0) return false
                if (!isMeal && slot.type === 'meal_30' && overlapMs > 0) return false
                // Espaciado mínimo entre distintos
                const startDiff = Math.abs(t - slot.startMs)
                if (isMeal && slot.type === 'meal_30' && startDiff < MIN_GAP_LUNCHES_MS && startDiff > 0) return false
                if (!isMeal && slot.type === 'rest_10' && startDiff < MIN_GAP_BREAKS_MS && startDiff > 0) return false
            }
            return true
        })

        let pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'normal'))
        if (pool.length === 0) {
            pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'relaxed'))
            if (pool.length) console.warn(`⚠️ Wave RELAXED para ${isMeal ? 'meal' : 'rest'} — ${shift.employee_name}`)
        }
        if (pool.length === 0) {
            pool = hardValid
            if (pool.length) console.warn(`⚠️ Wave OFF para ${isMeal ? 'meal' : 'rest'} — ${shift.employee_name}`)
        }

        // ────────────────────────────────────────────────────────────────────────
        //  FALLBACK PROGRESIVO (Evitar amontonamiento a la misma hora)
        // ────────────────────────────────────────────────────────────────────────
        if (pool.length === 0) {
            console.warn(`🔴 FALLBACK NIVEL 1: Ignorando gaps masivos (45m/30m) para ${shift.employee_name}`)
            
            // NIVEL 1: Quitar MIN_GAP_LUNCHES y MIN_GAP_BREAKS pero mantener PeakBlocks y cero solapamientos
            const fb1 = candidates.filter(t => {
                if (heatBlocks(t, t + durMs, shiftStartMs)) return false
                if (personalViolation(t, t + durMs, type, personalBreaks)) return false
                for (const slot of globalSlots) {
                    if (slot.empId !== null && slot.empId === empId) continue
                    const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                    
                    // Solo bloqueamos colisión dura:
                    if (isMeal && slot.type === 'meal_30' && overlapMs > 0) return false
                    if (!isMeal && slot.type === 'rest_10' && overlapMs > 0) return false
                    if (!isMeal && slot.type === 'meal_30' && overlapMs > 0) return false
                    
                    // Bloquear colisión EXACTA con el MISMO ROL (Esto evita que ELIAS y JONATHAN se enzimen si ambos son PREP)
                    if (slot.roleKey === rk && overlapMs > 0) return false
                }
                return true
            })
            pool = fb1
        }

        if (pool.length === 0) {
            console.warn(`🔴 FALLBACK NIVEL 2: Rompiendo Peak Zone para ${shift.employee_name}`)
            
            // NIVEL 2: Ignorar zona de pico de ventas, seguir evitando solapamiento exacto del mismo rol y leader
            const fb2 = candidates.filter(t => {
                if (personalViolation(t, t + durMs, type, personalBreaks)) return false
                for (const slot of globalSlots) {
                    if (slot.empId !== null && slot.empId === empId) continue
                    const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                    if (overlapMs > 0) {
                        const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                        const isLeaderFleeing = cat === 'leader' && slot.category !== 'leader'
                        const isSubordinateFleeing = cat !== 'leader' && slot.category === 'leader'
                        if (isLeaderConflict || isLeaderFleeing || isSubordinateFleeing) return false
                        if (slot.roleKey === rk) return false // NUNCA encimar preps con preps
                    }
                }
                return true
            }).sort((a, b) => spanHeat(a, a + durMs, getHeat) - spanHeat(b, b + durMs, getHeat))
            pool = fb2
        }

        if (pool.length === 0) {
            console.warn(`💥 FALLBACK TOTAL EXHAUSTO para ${shift.employee_name} (Colisiones permitidas)`)
            const fb3 = candidates.filter(t => {
                for (const pb of personalBreaks) {
                    const ps = new Date(pb.start_time).getTime()
                    const pe = new Date(pb.end_time).getTime()
                    if (t < pe && (t + durMs) > ps) return false
                    const dist = t >= pe ? t - pe : ps - (t + durMs)
                    const reqGap = type === 'rest_10' && pb.type === 'rest_10' ? GAP_RR_MS : GAP_MR_MS
                    if (dist < reqGap) return false
                }
                return true
            })
            if (fb3.length) pool = fb3
            else {
                let emergencyStartMs = wStartMs
                for (const pb of personalBreaks) {
                    const pe = new Date(pb.end_time).getTime()
                    const reqGap = type === 'rest_10' && pb.type === 'rest_10' ? GAP_RR_MS : GAP_MR_MS
                    if (emergencyStartMs >= pe && (emergencyStartMs - pe) < reqGap) {
                        emergencyStartMs = pe + reqGap
                    }
                }
                if (emergencyStartMs + durMs > wEndMs) emergencyStartMs = wStartMs
                return new Date(emergencyStartMs)
            }
        }

        let bestSlot = pool[0]
        let bestCost = Infinity
        for (const t of pool) {
            const cost = scoreSlot(t, durMs, isMeal, targetMs, shift, shiftStartMs)
            if (cost < bestCost) { bestCost = cost; bestSlot = t }
        }
        return new Date(bestSlot)
    }

    // ────────────────────────────────────────────────────────────────────────
    //  ORDEN DE PROCESAMIENTO
    // ────────────────────────────────────────────────────────────────────────
    function countCoolMealSlots(shift: any, shiftStartMs: number): number {
        const sMs = shiftStartMs
        const eMs = new Date(shift.end_time).getTime()
        const wEnd = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), eMs - ms(60 * H_END_BUFFER))
        const wStart = sMs + ms(60 * H_MIN_START)
        let cool = 0
        for (let t = wStart; t <= wEnd - ms(30); t += SLOT_STEP_MS) {
            if (!heatBlocks(t, t + ms(30), shiftStartMs)) cool++
        }
        return cool
    }

    const processed = [...augmented].sort((a, b) => {
        const sMsA = new Date(a.start_time).getTime()
        const sMsB = new Date(b.start_time).getTime()
        const aCool = countCoolMealSlots(a, sMsA)
        const bCool = countCoolMealSlots(b, sMsB)
        if (aCool !== bCool) return aCool - bCool
        const aCat = getRoleCategory(getRoleKey(a)), bCat = getRoleCategory(getRoleKey(b))
        if (aCat === 'leader' && bCat !== 'leader') return -1
        if (bCat === 'leader' && aCat !== 'leader') return 1
        return 0
    })

    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 1 — MEALS con distribución equiespaciada post-pico
    // ══════════════════════════════════════════════════════════════════════════
    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = new Date(shift.end_time).getTime()
        const req = getRequiredBreaks(sMs, eMs)
        const meals = req.filter(b => b.type === 'meal_30')
        const endBuf = eMs - ms(60 * H_END_BUFFER)
        const totalMealsForShift = meals.length

        meals.forEach((_, mealIdx) => {
            let wStartMs: number, wEndMs: number
            if (mealIdx === 0) {
                wStartMs = sMs + ms(60 * H_MIN_START)
                wEndMs = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), endBuf)
            } else {
                wStartMs = sMs + ms(60 * H_SECOND_MEAL_START)
                wEndMs = Math.min(sMs + ms(60 * H_SECOND_MEAL_END), endBuf)
            }
            if (wEndMs - wStartMs < ms(60)) wEndMs = Math.min(endBuf, wStartMs + ms(90))

            const targetMs = getMealTargetOutsidePeak(wStartMs, wEndMs, ms(30), mealIdx, totalMealsForShift, sMs, totalMealsForShift, mealIdx)

            const best = findSlot(wStartMs, wEndMs, 30, shift.breaks_schedule, shift, true, targetMs, sMs)
            const bestEnd = new Date(best.getTime() + ms(30))
            shift.breaks_schedule.push({ type: 'meal_30', start_time: toIso(best), end_time: toIso(bestEnd), status: 'scheduled' })
            globalSlots.push({ type: 'meal_30', startMs: best.getTime(), endMs: bestEnd.getTime(), roleKey: getRoleKey(shift), category: getRoleCategory(getRoleKey(shift)), empId: shift.employee_id ?? null })
            console.warn(`🍽️ ${shift.employee_name} meal#${mealIdx + 1} → ${best.toLocaleTimeString()} (heat=${spanHeat(best.getTime(), bestEnd.getTime(), getHeat).toFixed(2)})`)
        })
        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 2 — RESTS (con espaciado mínimo)
    // ══════════════════════════════════════════════════════════════════════════
    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = new Date(shift.end_time).getTime()
        const req = getRequiredBreaks(sMs, eMs)
        const rests = req.filter(b => b.type === 'rest_10')
        if (rests.length === 0) continue

        const minStart = sMs + ms(60 * H_MIN_START)
        const endBuf = eMs - ms(60 * H_END_BUFFER)
        const meals = sortChron(shift.breaks_schedule.filter((b: BreakBlock) => b.type === 'meal_30')).map(m => ({ sMs: new Date(m.start_time).getTime(), eMs: new Date(m.end_time).getTime() }))

        type Segment = { sMs: number; eMs: number }
        const rawSegments: Segment[] = []
        let safeStart = minStart
        for (const m of meals) {
            // Asegurar que haya suficiente espacio para terminar el break y dejar el GAP_MR_MS antes del lunch
            const requiredSegEnd = m.sMs - GAP_MR_MS
            if (requiredSegEnd >= safeStart + ms(10)) {
                rawSegments.push({ sMs: safeStart, eMs: requiredSegEnd })
            }
            safeStart = m.eMs + GAP_MR_MS
        }
        if (endBuf >= safeStart + ms(10)) {
            rawSegments.push({ sMs: safeStart, eMs: endBuf })
        }

        let validSegments = rawSegments.filter(seg => (seg.eMs - seg.sMs) >= ms(10))
        if (validSegments.length === 0) validSegments = [{ sMs: minStart, eMs: endBuf }]

        const earliestSeg = validSegments[0]
        const latestSeg = validSegments[validSegments.length - 1]
        const hasEarly = (earliestSeg.eMs - earliestSeg.sMs) >= ms(10)
        const hasLate = (latestSeg.eMs - latestSeg.sMs) >= ms(10)

        const assignedRests: { seg: Segment, forced: boolean }[] = []
        let remainingRests = rests.length

        if (hasEarly && remainingRests > 0) {
            assignedRests.push({ seg: earliestSeg, forced: true })
            remainingRests--
        }
        if (hasLate && latestSeg !== earliestSeg && remainingRests > 0) {
            assignedRests.push({ seg: latestSeg, forced: true })
            remainingRests--
        }

        const totalMs = validSegments.reduce((sum, seg) => sum + (seg.eMs - seg.sMs), 0)
        const restAssignments: Segment[] = []
        for (let i = 0; i < remainingRests; i++) {
            const idealTargetMs = totalMs * ((i + 0.5) / remainingRests)
            let accum = 0
            let targetSeg = validSegments[validSegments.length - 1]
            for (const seg of validSegments) {
                const w = seg.eMs - seg.sMs
                if (idealTargetMs <= accum + w) { targetSeg = seg; break }
                accum += w
            }
            restAssignments.push(targetSeg)
        }

        const allRestSegments = [...assignedRests.map(a => a.seg), ...restAssignments]

        for (let i = 0; i < rests.length; i++) {
            const targetSeg = allRestSegments[i] || validSegments[0]
            const rawMid = targetSeg.sMs + (targetSeg.eMs - targetSeg.sMs) / 2
            const targetMs = rawMid

            const best = findSlot(targetSeg.sMs, targetSeg.eMs, 10, shift.breaks_schedule, shift, false, targetMs, sMs)
            const bestEnd = new Date(best.getTime() + ms(10))
            shift.breaks_schedule.push({ type: 'rest_10', start_time: toIso(best), end_time: toIso(bestEnd), status: 'scheduled' })
            globalSlots.push({ type: 'rest_10', startMs: best.getTime(), endMs: bestEnd.getTime(), roleKey: getRoleKey(shift), category: getRoleCategory(getRoleKey(shift)), empId: shift.employee_id ?? null })
            console.warn(`☕ ${shift.employee_name} rest#${i + 1} → ${best.toLocaleTimeString()} (heat=${spanHeat(best.getTime(), bestEnd.getTime(), getHeat).toFixed(2)})`)
        }
        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    // DIAGNÓSTICO FINAL
    console.warn('─'.repeat(60))
    console.warn('📋 RESUMEN FINAL DE BREAKS ENGINE V25:')
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