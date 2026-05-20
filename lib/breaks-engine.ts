import { Shift } from '@/app/planificador/lib/types'
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
    is_manual?: boolean
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
// Dinámico: se usa la función hMinStart(durationHrs) en vez de esta constante
const H_MIN_START_SHORT = 1.0   // turnos ≤ 6h → ley CA, no más de 5h sin meal
const H_MIN_START_MED   = 1.0   // turnos 7-8h: 1h buffer
const H_MIN_START_LONG  = 1.0   // turnos > 8h: 1h buffer → PM 5PM→6PM, abre espacio pre-peak [6PM-6:30PM]

function hMinStart(durationHrs: number): number {
    if (durationHrs <= 6) return 0.75  // turnos cortos: window empieza pronto para cumplir ley
    if (durationHrs <= 8) return H_MIN_START_MED
    return H_MIN_START_LONG
}

// Para RESTS: buffers más chicos. Un descanso de 10 min no necesita
// el mismo lead time que un meal de 30 min.
function hMinStartRest(durationHrs: number): number {
    if (durationHrs <= 6) return 0.75
    if (durationHrs <= 8) return 1.0   // 1h buffer (vs 1.0h para meals, mismo en este tier)
    return 1.0                         // 1h buffer (vs 1.25h para meals)
}
const H_END_BUFFER = 1.0
// Ley CA: meal debe INICIAR ANTES de la 5ta hora de trabajo.
// Usamos 4.75h (15 min margen de seguridad) para que el engine NUNCA
// coloque un meal justo en el límite legal (ej: Luisa 10AM → límite 3PM,
// con 4.75 la ventana cierra a 2:45PM → meal a las 2:30-2:45PM máximo).
// ANTES esto eliminaba espacio post-peak para PM shifts, PERO ahora con
// la estrategia heat-compare + safeBeforeEnd extendido, pre-peak es viable.
const H_FIRST_MEAL_MAX = 4.75
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
    if (h > 12) result.push({ type: 'meal_30' })
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
    if (hour === 24) hour = 0;
    return { hour, minute }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ZONA DE PICO SEGÚN TURNO (AM: 11-14h, PM: 18-20h)
// ─────────────────────────────────────────────────────────────────────────────

function getPeakHoursForShift(shiftStartMs: number, shiftEndMs: number, operatingHours: OperatingHour[]): { start: number; end: number } {
    const midMs = shiftStartMs + (shiftEndMs - shiftStartMs) / 2;
    const { hour } = getLocalHourMinute(midMs);
    // Según reglas: AM inicia 6am hasta 5pm. PM inicia 5pm hasta 5am.
    // Usamos el PUNTO MEDIO del turno para categorizar si trabajan más en el día o en la noche
    const isAm = hour >= 6 && hour < 17;
    
    if (!operatingHours || operatingHours.length === 0) {
        return isAm ? { start: 11, end: 14 } : { start: 18, end: 20 };
    }

    let maxSales = 0;
    let peakHour = isAm ? 12 : 19;
    
    // AM window: 6am to 5pm (17)
    // PM window: 5pm (17) to 5am next day (29)
    const startH = isAm ? 6 : 17;
    const endH = isAm ? 17 : 29;

    for (const oh of operatingHours) {
        const h = Number(oh.hour);
        const s = Number(oh.projected_sales || 0);
        if (h >= startH && h <= endH && s > maxSales) {
            maxSales = s;
            peakHour = h;
        }
    }

    if (maxSales === 0) {
        return isAm ? { start: 11, end: 14 } : { start: 18, end: 20 };
    }

    // Expandir el bloque de pico para abarcar TODAS las horas contiguas >= 85% del máximo.
    // Esto coincide con el criterio visual del módulo VENTAS (heatmap).
    let pStart = peakHour;
    let pEnd = peakHour + 1;

    for (let h = peakHour - 1; h >= startH; h--) {
        const hData = operatingHours.find(o => Number(o.hour) === h);
        const s = hData ? Number(hData.projected_sales || 0) : 0;
        if (s >= maxSales * 0.85) pStart = h;
        else break;
    }

    for (let h = peakHour + 1; h <= endH; h++) {
        const hData = operatingHours.find(o => Number(o.hour) === h);
        const s = hData ? Number(hData.projected_sales || 0) : 0;
        if (s >= maxSales * 0.85) pEnd = h + 1;
        else break;
    }

    // Garantizar un mínimo de 2 horas de bloque para evitar falsos positivos
    if (pEnd - pStart < 2) {
        pStart = Math.max(startH, pStart - 1);
        if (pEnd - pStart < 2) pEnd = Math.min(endH, pEnd + 1);
    }

    return { start: pStart, end: pEnd };
}

function isInPeakZoneForShift(tMs: number, shiftStartMs: number, shiftEndMs: number, operatingHours: OperatingHour[]): boolean {
    const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
    // FIX: Usar timestamps absolutos en vez de hourFloat.
    // hourFloat falla para turnos PM con peak.end > 24 (ej: 29 = 5am next day)
    // porque hourFloat se normaliza a 0-23.
    const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs)
    const shiftMidnightMs = shiftStartMs - ms(60 * startHour) - ms(startMin)
    const peakStartTs = shiftMidnightMs + ms(60 * peak.start)
    const peakEndTs = shiftMidnightMs + ms(60 * peak.end)
    return tMs >= peakStartTs && tMs < peakEndTs
}

// ─────────────────────────────────────────────────────────────────────────────
//  HEATMAP (solo para scoring)
// ─────────────────────────────────────────────────────────────────────────────

function buildHeatFn(operatingHours: OperatingHour[], shiftStartMs?: number, shiftEndMs?: number): (tMs: number) => number {
    const MOCK: Record<number, number> = {
        6: 10, 7: 30, 8: 80, 9: 150, 10: 300, 11: 600, 12: 950, 13: 850, 14: 400,
        15: 250, 16: 300, 17: 500, 18: 800, 19: 900, 20: 750, 21: 500, 22: 300, 23: 150,
        0: 50, 1: 20, 2: 10, 3: 5
    }

    // Determinar ventana del turno para normalización local
    // AM: 6-17, PM: 17-29 (5am next day)
    let windowStart = 6, windowEnd = 29 // default: día completo
    if (shiftStartMs && shiftEndMs) {
        const midMs = shiftStartMs + (shiftEndMs - shiftStartMs) / 2
        const { hour } = getLocalHourMinute(midMs)
        const isAm = hour >= 6 && hour < 17
        windowStart = isAm ? 6 : 17
        windowEnd = isAm ? 17 : 29
    }

    // Encontrar el MAX solo dentro de la ventana del turno (no del día completo)
    // Esto hace que AM y PM tengan escalas independientes:
    // Ej: AM max=600 a las 12pm → 12pm heat=1.00
    //     PM max=900 a las 7pm → 7pm heat=1.00
    // Antes: maxGlobal=900 → 12pm heat=0.67 (subvalorado para AM)
    let maxS = 0
    if (operatingHours.length > 0) {
        for (const oh of operatingHours) {
            const h = Number(oh.hour)
            const s = Number(oh.projected_sales || 0)
            if (h >= windowStart && h < windowEnd && s > maxS) maxS = s
        }
        // Fallback: si la ventana del turno no tiene datos, usar el max global
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
            scores.set(normalizeHour(Number(h.hour)), Math.min(val, 1.0)) // cap a 1.0 para horas fuera de ventana
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

    // getHeat se re-asigna por cada turno para normalizar AM/PM independientemente.
    // AM normaliza contra su propio max (ej: 12pm=1.00), PM contra el suyo (ej: 7pm=1.00).
    // Sin esto, si PM factura más que AM, el rush AM aparece "tibio" en el scoring.
    let getHeat = buildHeatFn(operatingHours) // default: global (para diagnóstico final)
    const augmented: any[] = shifts.map(s => {
        const manualBreaks = (s.breaks_schedule || []).filter((b: BreakBlock) => b.is_manual);
        return { ...s, breaks_schedule: manualBreaks };
    });
    assignCohorts(augmented)
    const globalSlots: GlobalSlot[] = []

    // Pre-populate global slots with manual breaks so the engine avoids them
    augmented.forEach(s => {
        const rk = getRoleKey(s);
        const cat = getRoleCategory(rk);
        const empId = s.employee_id ?? null;
        s.breaks_schedule.forEach((b: BreakBlock) => {
            globalSlots.push({
                type: b.type,
                startMs: new Date(b.start_time).getTime(),
                endMs: new Date(b.end_time).getTime(),
                roleKey: rk,
                category: cat,
                empId
            });
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    //  HEAT BLOCKS: bloqueo de zona de pico para CUALQUIER break (meal o rest)
    // ────────────────────────────────────────────────────────────────────────
    function heatBlocks(sMs: number, eMs: number, shiftStartMs: number, shiftEndMs: number): boolean {
        // Usar overlap de intervalos con timestamps absolutos.
        const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
        const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs)
        const shiftMidnightMs = shiftStartMs - ms(60 * startHour) - ms(startMin)
        const peakStartTs = shiftMidnightMs + ms(60 * peak.start)
        const peakEndTs = shiftMidnightMs + ms(60 * peak.end)
        // Overlap: [sMs, eMs) toca [peakStartTs, peakEndTs)
        return sMs < peakEndTs && eMs > peakStartTs
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

            // Ya no bloqueamos overlaps generales. Solo se evaluan las reglas por rol en las "Restricciones suaves".

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

    // ────────────────────────────────────────────────────────────────────────
    //  SCORING con penalización adicional por cercanía
    // ────────────────────────────────────────────────────────────────────────
    function scoreSlot(sMs: number, durMs: number, isMeal: boolean, targetMs: number, shift: any, shiftStartMs: number): number {
        const eMs = sMs + durMs
        const h = spanHeat(sMs, eMs, getHeat)
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        // Reducimos enormemente el heatPenalty para permitir que distPenalty (basado en targetMs) tenga peso
        const heatPenalty = Math.pow(h, 4) * 1e12

        let peakPenalty = 0
        const shiftEndMs = new Date(shift.end_time).getTime()
        for (let t = sMs; t < eMs; t += ms(1)) {
            if (isInPeakZoneForShift(t, shiftStartMs, shiftEndMs, operatingHours)) {
                peakPenalty = 1e30
                break
            }
        }

        const distPenalty = Math.abs(midMs(sMs, durMs) - targetMs) / ms(1) * 1e15 // Fuerte atracción hacia targetMs

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
                    wavePenalty += ratio * 1e20
                    if (startDiff === 0) wavePenalty += 1e21 // Maximo castigo a colisiones exactas cruzadas
                }
            }
            // Penalizar cercanía excesiva entre breaks
            if (!isMeal && slot.type === 'rest_10') {
                if (startDiff < MIN_GAP_BREAKS_MS) {
                    const ratio = startDiff === 0 ? 1 : (1 - startDiff / MIN_GAP_BREAKS_MS)
                    wavePenalty += ratio * 1e19
                    if (startDiff === 0) wavePenalty += 1e20
                }
            }

            if (isGroup) {
                if (overlapMs > 0) {
                    const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                    wavePenalty += ratio * 1e22 // EL PEOR DE LOS CASOS: MISMO ROL EMPALMADO
                } else if (slot.type === (isMeal ? 'meal_30' : 'rest_10')) {
                    const diff = Math.abs(sMs - slot.startMs)
                    const ref = isMeal ? WAVE_SAME_ROLE_MEAL_MS : WAVE_SAME_ROLE_REST_MS
                    if (diff < ref) {
                        const prox = 1 - diff / ref
                        wavePenalty += prox * prox * 1e21
                    }
                }
            }
        }
        return heatPenalty + peakPenalty + distPenalty + wavePenalty
    }

    // ────────────────────────────────────────────────────────────────────────
    //  TARGET PARA LUNCH: distribución equiespaciada dentro del intervalo post-pico
    // ────────────────────────────────────────────────────────────────────────
    function getMealTargetOutsidePeak(wStartMs: number, wEndMs: number, durMs: number, cohortIdx: number, cohortSize: number, shiftStartMs: number, allShiftMealsCount: number, globalMealIndex: number, shiftDurationHrs: number, shift: any): { target: number; bypassHeat: boolean } {
        const shiftEndMs = new Date(shift.end_time).getTime()
        const peak = getPeakHoursForShift(shiftStartMs, shiftEndMs, operatingHours)
        const { hour: startHour, minute: startMin } = getLocalHourMinute(shiftStartMs);
        const shiftStartMidnightMs = shiftStartMs - ms(60 * startHour) - ms(startMin);
        
        const peakStartMs = shiftStartMidnightMs + ms(60 * peak.start)
        const peakEndMs = shiftStartMidnightMs + ms(60 * peak.end)

        // Extender safeBeforeEnd 30 min DENTRO del inicio del peak.
        // Comer al INICIO del rush está bien: la persona termina antes
        // del pico máximo y regresa a trabajar en lo más fuerte.
        // Ej: peak=18-20, safeBeforeEnd=18:30 → meal a 6PM, regresa 6:30PM
        const safeBeforeStart = Math.max(wStartMs, shiftStartMidnightMs + ms(60 * (peak.start - 1)))
        const safeBeforeEnd = Math.min(wEndMs, peakStartMs + ms(30))
        const safeAfterStart = Math.max(wStartMs, peakEndMs)
        const safeAfterEnd = wEndMs

        // ── CAPACITY CHECK ──────────────────────────────────────────────────
        const safeBeforeMins = Math.max(0, safeBeforeEnd - safeBeforeStart) / 60000
        const safeAfterMins = Math.max(0, safeAfterEnd - safeAfterStart) / 60000
        const totalSafeMins = safeBeforeMins + safeAfterMins
        const effectiveCohortSize = (shift._cohortSize && shift._cohortSize > 1) ? shift._cohortSize : 1
        const minsNeededPerPerson = 40
        const safeCapacity = Math.floor(totalSafeMins / minsNeededPerPerson)

        console.warn(`🎯 ${shift.employee_name} getMealTarget: peak=[${peak.start}-${peak.end}] safeBefore=${safeBeforeMins.toFixed(0)}min safeAfter=${safeAfterMins.toFixed(0)}min capacity=${safeCapacity}/${effectiveCohortSize} wStart=${new Date(wStartMs).toLocaleTimeString()} wEnd=${new Date(wEndMs).toLocaleTimeString()}`)

        // ══════════════════════════════════════════════════════════════════
        // ESTRATEGIA INTELIGENTE: Comparar heat PRE vs POST peak.
        // 
        // En vez de ir ciegamente "siempre post-peak", el engine COMPARA
        // el calor promedio de ambas ventanas y elige la MÁS FRÍA.
        //
        // Esto resuelve el caso Cristian: post-peak [8-10PM] = 0.96 heat
        // pero pre-peak [6-6:30PM] = 0.57 heat → pre es claramente mejor.
        //
        // Para turnos cortos del PM: comen ANTES del rush, regresan para
        // el pico máximo y trabajan el turno fuerte disponibles.
        // Para turnos largos del PM: si post-peak es más frío, van después.
        // ══════════════════════════════════════════════════════════════════

        const idx = (shift._cohortSize && shift._cohortSize > 1) ? shift._cohortIdx : 0
        const size = Math.max(effectiveCohortSize, 1)
        const frac = size > 1 ? idx / (size - 1) : 0.0

        // Calcular heat promedio de cada ventana
        const postPeakSpace = Math.max(0, safeAfterEnd - safeAfterStart)
        const prePeakSpace = Math.max(0, safeBeforeEnd - safeBeforeStart)
        const postFits = postPeakSpace >= durMs
        const preFits = prePeakSpace >= durMs

        let preAvgHeat = Infinity
        let postAvgHeat = Infinity
        if (preFits) {
            // Muestrear heat en la ventana pre-peak (cada 15 min)
            let hSum = 0, hCount = 0
            for (let t = safeBeforeStart; t + durMs <= safeBeforeEnd; t += ms(15)) {
                hSum += spanHeat(t, t + durMs, getHeat)
                hCount++
            }
            preAvgHeat = hCount > 0 ? hSum / hCount : Infinity
        }
        if (postFits) {
            let hSum = 0, hCount = 0
            for (let t = safeAfterStart; t + durMs <= safeAfterEnd; t += ms(15)) {
                hSum += spanHeat(t, t + durMs, getHeat)
                hCount++
            }
            postAvgHeat = hCount > 0 ? hSum / hCount : Infinity
        }

        // ── Elegir la ventana con MENOR heat ──────────────────────────────
        // Si ambas caben y tienen heat similar (±20%), preferir PRE-PEAK
        // porque el empleado come temprano y está disponible para el rush.
        if (preFits && postFits) {
            const preferPre = preAvgHeat <= postAvgHeat * 1.2 // pre gana si es igual o hasta 20% peor
            const chosen = preferPre
                ? { start: safeBeforeStart, end: safeBeforeEnd, label: 'PRE-PEAK' }
                : { start: safeAfterStart, end: safeAfterEnd, label: 'POST-PEAK' }
            const chosenSpace = chosen.end - chosen.start
            const rawTarget = chosen.start + (chosenSpace - durMs) * frac

            const snapWin = ms(15)
            let best = rawTarget
            let bestH = Infinity
            for (let t = rawTarget - snapWin; t <= rawTarget + snapWin; t += SLOT_STEP_MS) {
                if (t < chosen.start || t + durMs > chosen.end) continue
                const h = spanHeat(t, t + durMs, getHeat)
                if (h < bestH) { bestH = h; best = t }
            }
            console.warn(`   → ${chosen.label} (heat-compare: pre=${preAvgHeat.toFixed(2)} post=${postAvgHeat.toFixed(2)}): frac=${frac.toFixed(2)} interval=[${new Date(chosen.start).toLocaleTimeString()}-${new Date(chosen.end).toLocaleTimeString()}] target=${new Date(best).toLocaleTimeString()} heat=${bestH.toFixed(2)}`)
            return { target: midMs(best, durMs), bypassHeat: false }
        }

        // Solo una ventana cabe
        if (preFits || postFits) {
            const chosen = preFits
                ? { start: safeBeforeStart, end: safeBeforeEnd, label: 'PRE-PEAK (única)' }
                : { start: safeAfterStart, end: safeAfterEnd, label: 'POST-PEAK (única)' }
            const chosenSpace = chosen.end - chosen.start
            const rawTarget = chosen.start + (chosenSpace - durMs) * frac

            const snapWin = ms(15)
            let best = rawTarget
            let bestH = Infinity
            for (let t = rawTarget - snapWin; t <= rawTarget + snapWin; t += SLOT_STEP_MS) {
                if (t < chosen.start || t + durMs > chosen.end) continue
                const h = spanHeat(t, t + durMs, getHeat)
                if (h < bestH) { bestH = h; best = t }
            }
            console.warn(`   → ${chosen.label}: frac=${frac.toFixed(2)} interval=[${new Date(chosen.start).toLocaleTimeString()}-${new Date(chosen.end).toLocaleTimeString()}] target=${new Date(best).toLocaleTimeString()} heat=${bestH.toFixed(2)}`)
            return { target: midMs(best, durMs), bypassHeat: false }
        }

        // ── FULL WINDOW: ninguna ventana segura alcanza ──────────────────
        // Sesgar hacia la zona con menor heat promedio
        const postPeakStart = Math.max(wStartMs, peakEndMs)
        const fullPostSpace = wEndMs - postPeakStart
        
        let rawTarget: number
        if (fullPostSpace >= durMs * 2) {
            rawTarget = postPeakStart + (fullPostSpace - durMs) * frac
            console.warn(`   → FULL WINDOW (sesgado post-peak): frac=${frac.toFixed(2)} target=${new Date(rawTarget).toLocaleTimeString()}`)
        } else {
            rawTarget = wStartMs + (wEndMs - wStartMs - durMs) * frac
            console.warn(`   → FULL WINDOW (toda la ventana): frac=${frac.toFixed(2)} target=${new Date(rawTarget).toLocaleTimeString()}`)
        }

        const snapWin = ms(45)
        let best = rawTarget
        let bestH = Infinity
        for (let t = rawTarget - snapWin; t <= rawTarget + snapWin; t += SLOT_STEP_MS) {
            if (t < wStartMs || t + durMs > wEndMs) continue
            const h = spanHeat(t, t + durMs, getHeat)
            if (h < bestH) { bestH = h; best = t }
        }
        console.warn(`   → FULL WINDOW final: target=${new Date(best).toLocaleTimeString()} heat=${bestH.toFixed(2)}`)
        return { target: midMs(best, durMs), bypassHeat: true }
    }

    // ────────────────────────────────────────────────────────────────────────
    //  FIND SLOT (con shiftStartMs para heatBlocks)
    // ────────────────────────────────────────────────────────────────────────
    function findSlot(wStartMs: number, wEndMs: number, durationMins: number, personalBreaks: BreakBlock[], shift: any, isMeal: boolean, targetMs: number, shiftStartMs: number, shiftEndMs: number, bypassHeatBlocks: boolean = false): Date {
        const durMs = ms(durationMins)
        const type = isMeal ? 'meal_30' : 'rest_10'
        console.log(`[DEBUG FINDSLOT] emp: ${shift.employee?.name}, role: ${shift.role?.name}, type: ${type}, targetMs: ${new Date(targetMs).toLocaleTimeString()}`);
        const gridFirst = Math.ceil(wStartMs / SLOT_STEP_MS) * SLOT_STEP_MS
        const candidates: number[] = []
        for (let t = gridFirst; t <= wEndMs - durMs; t += SLOT_STEP_MS) candidates.push(t)
        if (candidates.length === 0) return new Date(wStartMs)

        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        const hardValid = candidates.filter(t => {
            if (!bypassHeatBlocks && heatBlocks(t, t + durMs, shiftStartMs, shiftEndMs)) return false
            if (personalViolation(t, t + durMs, type, personalBreaks)) return false
            for (const slot of globalSlots) {
                if (slot.empId !== null && slot.empId === empId) continue
                const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                
                // NO global blocks anymore. Only block if SAME ROLE!
                if (slot.roleKey === rk && overlapMs > 0) {
                    // Excepción: si rol es 'unknown' o vacío, bloquear igual por si acaso
                    return false
                }
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
                if (!bypassHeatBlocks && heatBlocks(t, t + durMs, shiftStartMs, shiftEndMs)) return false
                if (personalViolation(t, t + durMs, type, personalBreaks)) return false
                for (const slot of globalSlots) {
                    if (slot.empId !== null && slot.empId === empId) continue
                    const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                    
                    // Bloquear colisión EXACTA con el MISMO ROL
                    if (slot.roleKey === rk && overlapMs > 0) return false
                }
                return true
            })
            pool = fb1
        }

        if (pool.length === 0) {
            console.warn(`🔴 FALLBACK NIVEL 2: Permitiendo empalme de MISMO ROL fuera de Peak Zone para ${shift.employee_name}`)
            
            // NIVEL 2: MANTENER zona de pico protegida. Permitir encimar mismo rol. Evitar empalme de líderes.
            const fb2 = candidates.filter(t => {
                if (!bypassHeatBlocks && heatBlocks(t, t + durMs, shiftStartMs, shiftEndMs)) return false // ¡ZONA DE PICO PROTEGIDA!
                if (personalViolation(t, t + durMs, type, personalBreaks)) return false
                for (const slot of globalSlots) {
                    if (slot.empId !== null && slot.empId === empId) continue
                    const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                    if (overlapMs > 0) {
                        if (slot.roleKey === rk) return false // ¡NUNCA EMPALMAR MISMO ROL!
                        const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                        const isLeaderFleeing = cat === 'leader' && slot.category !== 'leader'
                        const isSubordinateFleeing = cat !== 'leader' && slot.category === 'leader'
                        if (isLeaderConflict || isLeaderFleeing || isSubordinateFleeing) return false
                    }
                }
                return true
            })
            pool = fb2
        }

        if (pool.length === 0) {
            console.warn(`🔴 FALLBACK NIVEL 3: Permitiendo TODOS los empalmes fuera de Peak Zone para ${shift.employee_name}`)
            
            // NIVEL 3: MANTENER zona de pico protegida. Permitir cualquier empalme con tal de no tocar el pico, EXCEPTO empalme del mismo rol.
            const fb3 = candidates.filter(t => {
                if (!bypassHeatBlocks && heatBlocks(t, t + durMs, shiftStartMs, shiftEndMs)) return false // ¡ZONA DE PICO PROTEGIDA!
                if (personalViolation(t, t + durMs, type, personalBreaks)) return false
                for (const slot of globalSlots) {
                    if (slot.empId !== null && slot.empId === empId) continue
                    const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                    if (overlapMs > 0 && slot.roleKey === rk) return false // ¡NUNCA EMPALMAR MISMO ROL!
                }
                return true
            })
            pool = fb3
        }

        if (pool.length === 0) {
            console.warn(`💥 FALLBACK TOTAL EXHAUSTO para ${shift.employee_name} (Rompiendo Peak Zone por obligación matemática)`)
            const fb4 = candidates.filter(t => {
                for (const pb of personalBreaks) {
                    const ps = new Date(pb.start_time).getTime()
                    const pe = new Date(pb.end_time).getTime()
                    if (t < pe && (t + durMs) > ps) return false
                    const dist = t >= pe ? t - pe : ps - (t + durMs)
                    const reqGap = type === 'rest_10' && pb.type === 'rest_10' ? GAP_RR_MS : GAP_MR_MS
                    if (dist < reqGap) return false
                }
                for (const slot of globalSlots) {
                    if (slot.empId !== null && slot.empId === empId) continue
                    const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                    if (overlapMs > 0 && slot.roleKey === rk) return false // ¡AÚN EN EMERGENCIA, NUNCA EMPALMAR MISMO ROL!
                }
                return true
            })
            if (fb4.length) pool = fb4
            else {
                // EXTREMO CASO: Si ni siquiera fb4 tiene espacio, metemos a la fuerza rompiendo empalmes de rol.
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
        const sMsA = new Date(a.start_time).getTime()
        const sMsB = new Date(b.start_time).getTime()
        const eMsA = new Date(a.end_time).getTime()
        const eMsB = new Date(b.end_time).getTime()
        const durA = eMsA - sMsA;
        const durB = eMsB - sMsB;

        // PRIORIDAD 1: Turnos cortos primero para que tomen sus descansos temprano
        if (durA !== durB) return durA - durB;

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
    console.log("=== PROCESSED SHIFT ORDER ===");
    processed.forEach((s, i) => {
        const sMs = new Date(s.start_time).getTime();
        const eMs = new Date(s.end_time).getTime();
        console.log(`${i+1}. ${s.employee_name || s.employee_id} - Dur: ${(eMs - sMs) / 3600000}h`);
    });
    
    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = new Date(shift.end_time).getTime()
        // ── Per-shift heat: normalizar AM/PM independientemente ──
        getHeat = buildHeatFn(operatingHours, sMs, eMs)
        const req = getRequiredBreaks(sMs, eMs)
        const allMeals = req.filter(b => b.type === 'meal_30')
        const manualMealsCount = shift.breaks_schedule.filter((b: BreakBlock) => b.type === 'meal_30' && b.is_manual).length
        const meals = allMeals.slice(manualMealsCount)
        const endBuf = eMs - ms(60 * H_END_BUFFER)
        const totalMealsForShift = meals.length

        meals.forEach((_, mealIdx) => {
            let wStartMs: number, wEndMs: number
            const shiftDurationMs = eMs - sMs;
            const durationHrs = shiftDurationMs / (1000 * 60 * 60);
            
            if (mealIdx === 0) {
                // Adelantar todos los lunches para evitar que caigan en HORA PICO
                // Las personas con turnos cortos (priorizadas por sort) agarrarán los primeros lugares.
                // Las personas con turnos largos (últimas en sort) agarrarán lugares post-pico si no caben antes.
                // hMinStart() evita que el meal caiga solo 1h después de entrar en turnos de 8-10h.
                wStartMs = sMs + ms(60 * hMinStart(durationHrs))
                // LEY: El lunch DEBE iniciar antes de la 5ta hora (H_FIRST_MEAL_MAX = 5.0). Nunca exceder.
                wEndMs = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), endBuf)
            } else {
                wStartMs = sMs + ms(60 * H_SECOND_MEAL_START)
                wEndMs = Math.min(sMs + ms(60 * H_SECOND_MEAL_END), endBuf)
            }
            if (wEndMs - wStartMs < ms(60)) wEndMs = Math.min(endBuf, wStartMs + ms(90))

            const { target: targetMs, bypassHeat } = getMealTargetOutsidePeak(wStartMs, wEndMs, ms(30), mealIdx, totalMealsForShift, sMs, totalMealsForShift, mealIdx, durationHrs, shift)
            
            const best = findSlot(wStartMs, wEndMs, 30, shift.breaks_schedule, shift, true, targetMs, sMs, eMs, bypassHeat)
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
        // ── Per-shift heat: normalizar AM/PM independientemente ──
        getHeat = buildHeatFn(operatingHours, sMs, eMs)
        const req = getRequiredBreaks(sMs, eMs)
        const allRests = req.filter(b => b.type === 'rest_10')
        const manualRestsCount = shift.breaks_schedule.filter((b: BreakBlock) => b.type === 'rest_10' && b.is_manual).length
        const rests = allRests.slice(manualRestsCount)
        if (rests.length === 0) continue

        const minStart = sMs + ms(60 * hMinStartRest((eMs - sMs) / 3_600_000))
        
        const shiftDurationHrs = (eMs - sMs) / 3_600_000
        // End buffer proporcional a la duración del turno:
        // - Turnos ≤ 8h: 0.67h (40 min) → permite post-meal segment para 7h shifts
        // - Turnos > 8h:  1.0h (60 min) → más buffer, Carlos (5PM-3AM) no tiene rest a las 2AM
        // - Turnos > 10h: 1.5h (90 min) → turnos muy largos necesitan más clearance
        // Verificación 7h: meal 13:50 → barrier [13:05-15:05], endBuf=16:20 → post-meal 75min ✅
        // Verificación 10h: Carlos 5PM-3AM → endBuf=2AM → último rest ~1:30AM (1.5h antes) ✅
        const endBufferHrs = shiftDurationHrs > 10 ? 1.5
            : shiftDurationHrs > 8 ? 1.0
            : 0.67
        const endBuf = eMs - ms(60 * endBufferHrs)
        // Incluir meals Y rests ya colocados como barreras para calcular segmentos frescos
        type Segment = { sMs: number; eMs: number; len: number }
        
        for (let i = 0; i < rests.length; i++) {
            // Recalcular segmentos en cada iteración para que rest #2 vea rest #1 como barrera
            const allExisting = sortChron(shift.breaks_schedule as BreakBlock[]).map((b: BreakBlock) => {
                const bStart = new Date(b.start_time).getTime()
                const bEnd = new Date(b.end_time).getTime()
                const gap = b.type === 'rest_10' ? GAP_RR_MS : GAP_MR_MS
                return { sMs: bStart - gap, eMs: bEnd + gap }
            })

            const validSegments: Segment[] = []
            let safeStart = minStart
            for (const barrier of allExisting) {
                if (barrier.sMs >= safeStart + ms(10)) {
                    validSegments.push({ sMs: safeStart, eMs: barrier.sMs, len: barrier.sMs - safeStart })
                }
                if (barrier.eMs > safeStart) safeStart = barrier.eMs
            }
            if (endBuf >= safeStart + ms(10)) {
                validSegments.push({ sMs: safeStart, eMs: endBuf, len: endBuf - safeStart })
            }

            if (validSegments.length === 0) {
                validSegments.push({ sMs: minStart, eMs: endBuf, len: endBuf - minStart })
            }

            const totalValidMs = validSegments.reduce((sum, seg) => sum + seg.len, 0)

            // Distribuir equitativamente a lo largo del tiempo total disponible
            let idealFrac = (i + 0.5) / rests.length
            
            // Stagger basado en cohort para que empleados del mismo rol no apunten al mismo minuto
            if (shift._cohortSize && shift._cohortSize > 1) {
                const staggerRange = 1.0 / (rests.length * 2)
                const staggerOffset = (shift._cohortIdx / (shift._cohortSize - 1)) * staggerRange - (staggerRange / 2)
                idealFrac = Math.max(0, Math.min(1, idealFrac + staggerOffset))
            }
            
            const idealTargetMs = totalValidMs * idealFrac
            
            let accum = 0
            let targetMs = validSegments[validSegments.length - 1].sMs + validSegments[validSegments.length - 1].len / 2
            let activeSeg = validSegments[validSegments.length - 1]

            for (const seg of validSegments) {
                if (idealTargetMs <= accum + seg.len) {
                    const offsetInSeg = idealTargetMs - accum
                    targetMs = seg.sMs + offsetInSeg
                    activeSeg = seg
                    break
                }
                accum += seg.len
            }

            // ── HEAT-SNAP para rests: buscar el minuto menos intenso en TODO el segmento ──
            // Sin esto, los rests caen en el punto medio matemático del segmento (ciego al pico).
            // Ej: Lucía con segmento [10:45-14:00] → target=12:22 (pleno rush).
            // Con heat-snap → target se mueve a ~10:50 (pre-rush, heat mínimo).
            // IMPORTANTE: El heat-snap DEBE respetar la distancia personal a breaks existentes.
            // Sin esto, mueve el target justo al lado de un rest/meal existente (ej: Martha rest#2→12:00
            // cuando rest#1 está a las 12:50), causando TOTAL EXHAUSTO y breaks apilados.
            const existingPersonalBreaks = (shift.breaks_schedule as BreakBlock[]).map((b: BreakBlock) => ({
                ms: new Date(b.start_time).getTime(),
                endMs: new Date(b.end_time).getTime(),
                gap: b.type === 'rest_10' ? GAP_RR_MS : GAP_MR_MS
            }))
            let heatBest = targetMs
            let heatBestScore = Infinity
            // Limitar el scan a ±45 min del target para TODOS los turnos.
            // Sin este límite, turnos largos con segmentos post-meal de 3+ horas
            // (ej: Juan Perez 7PM-3AM, seg=[23:15-2:20]=3h) arrastran el rest
            // al extremo más frío del turno (heat=0.00 a las 2AM) en vez de
            // mantenerlo cerca de su posición ideal natural (~1:10AM).
            const heatScanStart = Math.max(activeSeg.sMs, targetMs - ms(45))
            const heatScanEnd = Math.min(activeSeg.eMs, targetMs + ms(45))
            for (let t = heatScanStart; t + ms(10) <= heatScanEnd; t += SLOT_STEP_MS) {
                // Saltar si está demasiado cerca de un break personal existente
                const tooClose = existingPersonalBreaks.some(pb => {
                    const distToStart = Math.abs(t - pb.ms)
                    const distToEnd = Math.abs(t - pb.endMs)
                    return Math.min(distToStart, distToEnd) < pb.gap
                })
                if (tooClose) continue
                const h = spanHeat(t, t + ms(10), getHeat)
                if (h < heatBestScore) { heatBestScore = h; heatBest = t }
            }
            // Solo mover si encontramos un slot significativamente más fresco (>15% menos heat)
            // Y si heatBestScore no quedó en Infinity (todas las posiciones estaban bloqueadas)
            const originalHeat = spanHeat(targetMs, targetMs + ms(10), getHeat)
            if (heatBestScore < Infinity && heatBestScore < originalHeat * 0.85) {
                console.warn(`   🧊 ${shift.employee_name} rest#${i+1} heat-snap: ${new Date(targetMs).toLocaleTimeString()} (heat=${originalHeat.toFixed(2)}) → ${new Date(heatBest).toLocaleTimeString()} (heat=${heatBestScore.toFixed(2)})`)
                targetMs = heatBest
            }

            // Buscar slot en el segmento activo.
            // bypassHeatBlocks=true para rests: un descanso de 10 minutos tiene impacto operacional
            // negligible comparado con meals de 30min. Sin bypass, empleados cuyo segmento cae
            // 100% dentro del peak (ej: selvin [11:00-13:15], katherine [18:00-21:15]) cascadean
            // por 4 niveles de fallback hasta TOTAL EXHAUSTO sin necesidad.
            const best = findSlot(activeSeg.sMs, activeSeg.eMs, 10, shift.breaks_schedule, shift, false, targetMs, sMs, eMs, true)
            const bestEnd = new Date(best.getTime() + ms(10))
            shift.breaks_schedule.push({ type: 'rest_10', start_time: toIso(best), end_time: toIso(bestEnd), status: 'scheduled' })
            globalSlots.push({ type: 'rest_10', startMs: best.getTime(), endMs: bestEnd.getTime(), roleKey: getRoleKey(shift), category: getRoleCategory(getRoleKey(shift)), empId: shift.employee_id ?? null })
            console.warn(`☕ ${shift.employee_name} rest#${i + 1} → ${best.toLocaleTimeString()} seg=[${new Date(activeSeg.sMs).toLocaleTimeString()}-${new Date(activeSeg.eMs).toLocaleTimeString()}] (target=${new Date(targetMs).toLocaleTimeString()})`)
        }
        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    // DIAGNÓSTICO FINAL — usar heat GLOBAL (no per-shift) para comparación uniforme
    getHeat = buildHeatFn(operatingHours)
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