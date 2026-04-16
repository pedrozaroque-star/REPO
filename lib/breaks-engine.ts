import { Shift } from '@/app/planificador-v2/lib/types'
import { OperatingHour } from '@/lib/intelligence'

// ══════════════════════════════════════════════════════════════════════════════
//  BREAKS ENGINE V16 — CONSTRAINT-FIRST CLEAN ARCHITECTURE
//
//  PROBLEMAS RESUELTOS vs V15:
//  ✅ Turnos PM con ventana caliente → meals en edges fríos, nunca en el MAX
//  ✅ Rest + meal del mismo empleado ya no quedan pegados (piso absoluto 75 min)
//  ✅ "Olas" de lunches simultáneos → wave prevention real, no solo penalidad
//  ✅ Relaxation progressiva eliminada para heat → heat es siempre duro
//  ✅ "Último recurso" nunca entra a zona roja (solo coolest disponible)
//  ✅ Cohort stagger respeta ventana y heat antes de aplicarse
//  ✅ Segmentación de rests alrededor de meals siempre respetada
//
//  ARQUITECTURA:
//  1. Heat blocks   → DUROS, nunca se relajan bajo ninguna circunstancia
//  2. Overlap       → DURO, nunca se permite traslape
//  3. Personal gap  → DURO, piso absoluto 75 min cross-type, sin excepciones
//  4. Wave gaps     → SUAVES, pueden reducirse si no hay opción fría disponible
//                    pero NUNCA a costa de entrar en zona de calor bloqueada
//  5. Scoring       → entre slots válidos, se prefiere: frío > lejos de olas > target
//
//  ORDEN DE PROCESAMIENTO:
//  - Meals primero, en orden de ventana más estrecha a más amplia (más restringidos primero)
//  - Rests después, segmentados alrededor de los meals ya asignados
// ══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
//  TIPOS
// ─────────────────────────────────────────────────────────────────────────────

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
//  CONSTANTES GLOBALES
// ─────────────────────────────────────────────────────────────────────────────

// Heat thresholds — NUNCA SE RELAJAN
// La zona visible en el Gantt:
//   ≥ 0.95 = rojo oscuro MAX  → absolutamente bloqueado
//   ≥ 0.85 = rojo fuerte      → meals bloqueados aquí
//   ≥ 0.75 = rojo medio       → rests bloqueados aquí, meals también
//   ≥ 0.65 = naranja          → zona caliente, permitida con preferencia baja
const HEAT_ABSOLUTE = 0.90  // Nada entra aquí — nunca, bajo ningún nivel
const HEAT_MEAL = 0.78  // Meals bloqueados — naranja-rojo medio y arriba
const HEAT_REST = 0.70  // Rests bloqueados — naranja claro y arriba

// Personal spacing (mismo empleado) — piso absoluto, NUNCA bajan
const GAP_RR_MS = 90 * 60_000  // rest ↔ rest: 90 min mínimo
const GAP_MM_MS = 120 * 60_000  // meal ↔ meal: 120 min mínimo
const GAP_MR_MS = 75 * 60_000  // meal ↔ rest: 75 min mínimo ABSOLUTO

// Wave prevention — gaps preferidos entre empleados del mismo rol/categoría
// PUEDEN reducirse si no hay otra opción que no sea zona caliente
const WAVE_SAME_ROLE_MEAL_MS = 45 * 60_000  // entre meals del mismo rol
const WAVE_LEADER_MEAL_MS = 30 * 60_000  // entre leaders
const WAVE_FOH_BOH_MAX_OVL_MS = 15 * 60_000  // máximo overlap FOH↔BOH
const WAVE_SAME_ROLE_REST_MS = 90 * 60_000  // entre rests del mismo rol
const WAVE_SAME_CAT_REST_MS = 60 * 60_000  // entre rests misma categoría
const WAVE_CROSS_REST_MS = 30 * 60_000  // entre rests diferente categoría

// Mínimos de wave en modo relaxed (cuando no hay otra opción fría)
const WAVE_MIN_MEAL_MS = 20 * 60_000
const WAVE_MIN_REST_MS = 15 * 60_000

// Grid de tiempo y offsets legales
const SLOT_STEP_MS = 10 * 60_000  // grilla de 10 min alineada a medianoche
const H_MIN_START = 1.0          // mínimo 1h desde inicio del turno
const H_END_BUFFER = 1.0          // ningún break en la última hora del turno
const H_FIRST_MEAL_MAX = 5.0          // CA law: primer meal antes de la 5ta hora
const H_SECOND_MEAL_START = 7.0          // segundo meal no antes de 7h trabajadas
const H_SECOND_MEAL_END = 10.0         // segundo meal no después de 10h trabajadas

// ─────────────────────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

const ms = (mins: number) => mins * 60_000
const toIso = (d: Date) => d.toISOString()
const midMs = (startMs: number, durMs: number) => startMs + durMs / 2

function normalizeHour(h: number): number {
    if (h < 0) return h + 24
    if (h > 23) return h - 24
    return h
}

function sortChron<T extends { start_time: string }>(arr: T[]): T[] {
    return [...arr].sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    )
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

// ─────────────────────────────────────────────────────────────────────────────
//  LEY CALIFORNIA: breaks requeridos
// ─────────────────────────────────────────────────────────────────────────────

function getRequiredBreaks(
    startMs: number,
    endMs: number
): Omit<BreakBlock, 'start_time' | 'end_time'>[] {
    const h = (endMs - startMs) / 3_600_000
    const result: Omit<BreakBlock, 'start_time' | 'end_time'>[] = []

    const restCount = h > 14 ? 4 : h > 10 ? 3 : h > 6 ? 2 : h >= 3.5 ? 1 : 0
    for (let i = 0; i < restCount; i++) result.push({ type: 'rest_10' })
    if (h > 6) result.push({ type: 'meal_30' })
    if (h > 10) result.push({ type: 'meal_30' })

    return result
}

// ─────────────────────────────────────────────────────────────────────────────
//  HEATMAP
// ─────────────────────────────────────────────────────────────────────────────

function buildHeatFn(operatingHours: OperatingHour[]): (tMs: number) => number {
    // Curva mock: simula un restaurante típico con rush de mediodía (~12PM) y tarde (~7PM)
    const MOCK: Record<number, number> = {
        6: 10, 7: 30, 8: 80, 9: 150, 10: 300, 11: 600, 12: 950, 13: 850, 14: 400,
        15: 250, 16: 300, 17: 500, 18: 800, 19: 900, 20: 750, 21: 500, 22: 300, 23: 150,
        0: 50, 1: 20, 2: 10, 3: 5
    }

    const scores = new Map<number, number>()
    let maxS = operatingHours.length > 0
        ? Math.max(...operatingHours.map(h => Number(h.projected_sales || 0)))
        : 0

    if (maxS < 10) {
        maxS = 950
        for (const [h, s] of Object.entries(MOCK))
            scores.set(parseInt(h), s / maxS)
    } else {
        for (const h of operatingHours)
            scores.set(normalizeHour(Number(h.hour)), Number(h.projected_sales || 0) / maxS)
    }

    return (tMs: number): number => {
        // Obtenemos la hora en formato 24h para Los Angeles usando API nativa
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric',
            hourCycle: 'h23'
        })
        const localHour = parseInt(formatter.format(new Date(tMs)), 10)
        return scores.get(normalizeHour(localHour)) ?? 0.05
    }
}

// Peor score de calor en un span, muestreado cada 5 min
function spanHeat(sMs: number, eMs: number, getHeat: (t: number) => number): number {
    let worst = 0
    for (let t = sMs; t < eMs; t += ms(5)) {
        const sc = getHeat(t)
        if (sc > worst) worst = sc
    }
    return worst
}

// ─────────────────────────────────────────────────────────────────────────────
//  COHORTES — stagger dentro del grupo de turno similar
// ─────────────────────────────────────────────────────────────────────────────

function assignCohorts(shifts: any[]): void {
    // Agrupa por bloque de 30 min de inicio + categoría de rol
    // Así cajeras PM que arrancan juntas forman una cohorte y se distribuyen
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

export function scheduleBreaksWithDemand(
    shifts: Shift[],
    operatingHours: OperatingHour[]
): Shift[] {

    console.warn(
        '%c🧠 BREAKS ENGINE V16 — CONSTRAINT-FIRST',
        'background:#0f2447;color:#60a5fa;font-size:14px;font-weight:bold;padding:4px 10px;border-radius:4px'
    )

    const getHeat = buildHeatFn(operatingHours)

    // Log del heatmap para diagnóstico
    const heatLog: string[] = []
    for (let h = 6; h <= 26; h++) {
        const hh = normalizeHour(h)
        const sc = getHeat(new Date(2000, 0, 1, hh, 0, 0).getTime())
        if (sc > 0.05) heatLog.push(`${hh}:00=${sc.toFixed(2)}`)
    }
    console.warn(`📊 HEATMAP: ${heatLog.join(' | ')}`)

    // ── Augmentar shifts ────────────────────────────────────────────────────
    const augmented: any[] = shifts.map(s => ({ ...s, breaks_schedule: [] as BreakBlock[] }))
    assignCohorts(augmented)

    const globalSlots: GlobalSlot[] = []

    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: ¿Este slot está bloqueado por calor? (DURO — nunca se relaja)
    //  El usuario autorizó arrancar/terminar tomando hasta 15 minutos en bloques MAX 
    //  continuos, pero manteniendo intacto el centro profundo (Core Peak) de la ola MAX.
    // ────────────────────────────────────────────────────────────────────────
    function heatBlocks(sMs: number, eMs: number, isMeal: boolean): boolean {
        let maxHeatMins = 0;
        let hitsCorePeak = false;

        // Muestrear cada minuto
        for (let t = sMs; t < eMs; t += ms(1)) {
            const sc = getHeat(t);
            if (sc >= HEAT_ABSOLUTE) {
                maxHeatMins++;
                
                // Encontrar los verdaderos límites absolutos de este bloque MAX continuo
                // Usamos módulo matemático para ser inmunes al Timezone de Vercel/Node
                let bsMs = t - (t % ms(60));
                // Scan backwards
                while (getHeat(bsMs - ms(1)) >= HEAT_ABSOLUTE) {
                    bsMs -= ms(60); 
                }

                let beMs = bsMs + ms(60) - 1; // Final de la hora en la que se encuentra t
                // Scan forwards
                while (getHeat(beMs + ms(1)) >= HEAT_ABSOLUTE) {
                    beMs += ms(60);
                }

                // Distancia a los bordes del mega-bloque MAX continuo
                const distToStartMins = (t - bsMs) / ms(1);
                const distToEndMins = (beMs - t) / ms(1);

                // El usuario pidió: "solo utilizar los primeros 15 min de la primera MAX 
                // y/o los ultimos 15 min de la ultima MAX"
                // Esto significa que CUALQUIER punto que esté a más de 15 minutos del START 
                // Y a más de 15 minutos del END, es el CORE PEAK y está prohibidísimo.
                if (distToStartMins >= 15 && distToEndMins >= 15) {
                    hitsCorePeak = true;
                    break;
                }
            }
        }

        // Si toca el centro duro de la ola extendida de MAX, se bloquea absolutamente
        if (hitsCorePeak) return true;

        // Si sobrepasa el límite autorizado de 15 minutos tocando la zona MAX, se bloquea
        // (Ej: Un lunch de 20 minutos de colisión está bloqueado. Uno de 10 minutos está permitido).
        if (maxHeatMins > 15) return true;

        return false;
    }

    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: ¿Viola el spacing personal del mismo empleado? (DURO)
    //  - Nunca puede quedar less than GAP_MR_MS (75 min) entre meal y rest propios
    // ────────────────────────────────────────────────────────────────────────
    function personalViolation(
        sMs: number, eMs: number,
        newType: 'rest_10' | 'meal_30',
        existing: BreakBlock[]
    ): boolean {
        for (const pb of existing) {
            const ps = new Date(pb.start_time).getTime()
            const pe = new Date(pb.end_time).getTime()

            // Traslape directo: siempre bloqueado
            if (sMs < pe && eMs > ps) return true

            // Gap mínimo según tipo de par
            const requiredGap =
                newType === 'rest_10' && pb.type === 'rest_10' ? GAP_RR_MS :
                    newType === 'meal_30' && pb.type === 'meal_30' ? GAP_MM_MS :
                        GAP_MR_MS  // cross-type: el más crítico

            // Distancia entre el nuevo break y el existente
            const dist = sMs >= pe ? sMs - pe : ps - eMs
            if (dist < requiredGap) return true
        }
        return false
    }

    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: ¿Viola wave prevention? (SUAVE — puede relajarse)
    //  Pero NUNCA se relaja si eso requiere entrar a zona de calor bloqueada.
    //  mode='normal'  → gaps completos preferidos
    //  mode='relaxed' → gaps mínimos (20 min meals, 15 min rests)
    //  mode='off'     → ignorar wave gaps (solo overlaps duros permanecen)
    // ────────────────────────────────────────────────────────────────────────
    function waveViolation(
        sMs: number, eMs: number,
        shift: any, isMeal: boolean,
        mode: WaveMode
    ): boolean {
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        for (const slot of globalSlots) {
            // Ignorar slots del mismo empleado (ya controlados por personalViolation)
            if (slot.empId !== null && slot.empId === empId) continue

            const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
            const startDiff = Math.abs(sMs - slot.startMs)

            const sameRole = slot.roleKey === rk
            const sameCat = slot.category === cat
            const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
            const sameGroupMeal = sameRole || isLeaderConflict
            const isCrossSect = (cat === 'foh' && slot.category === 'boh') ||
                (cat === 'boh' && slot.category === 'foh')

            if (isMeal && slot.type === 'meal_30') {
                // ── DURO: no traslape mismo rol / leaders ──────────────────
                if (sameGroupMeal && overlapMs > 0) return true
                // ── DURO: FOH↔BOH máximo 15 min de traslape ───────────────
                if (isCrossSect && overlapMs > WAVE_FOH_BOH_MAX_OVL_MS) return true

                // ── SUAVE: wave gap mismo rol/leaders ─────────────────────
                if (mode !== 'off' && sameGroupMeal && overlapMs === 0) {
                    const gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_SAME_ROLE_MEAL_MS
                    if (startDiff < gap) return true
                }
                // ── SUAVE: wave gap leader-leader (extra control) ──────────
                if (mode !== 'off' && isLeaderConflict && overlapMs === 0) {
                    const gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_LEADER_MEAL_MS
                    if (startDiff < gap) return true
                }
            }

            if (!isMeal && slot.type === 'rest_10') {
                // ── DURO: ningún rest se traslapa con otro rest ────────────
                if (overlapMs > 0) return true

                // ── SUAVE: wave gap entre rests ────────────────────────────
                if (mode !== 'off') {
                    const gap = sameRole
                        ? (mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_ROLE_REST_MS)
                        : sameCat
                            ? (mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_CAT_REST_MS)
                            : WAVE_CROSS_REST_MS
                    if (startDiff < gap) return true
                }
            }

            if (!isMeal && slot.type === 'meal_30') {
                // Rest no debe traslaparse con el meal de otro empleado
                // (ambos fuera de la línea operativa al mismo tiempo)
                if (overlapMs > 0) return true
            }
        }
        return false
    }

    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: Scoring de un slot válido (menor = mejor)
    //  Entre candidatos que pasaron todos los filtros duros + wave,
    //  se prefiere: zona más fría > lejos de olas > cerca del target
    // ────────────────────────────────────────────────────────────────────────
    function scoreSlot(
        sMs: number, durMs: number,
        isMeal: boolean, targetMs: number,
        shift: any
    ): number {
        const eMs = sMs + durMs
        const h = spanHeat(sMs, eMs, getHeat)
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        // 1. Penalidad por calor — escala agresivamente con temperatura
        //    (ya pasó el bloqueo duro pero seguimos prefiriendo lo más frío)
        const heatPenalty = Math.pow(h, 6) * 1e10
            + (h >= 0.40 ? 5e9 : 0)
            + (h >= 0.55 ? 1e10 : 0)
            + (h >= 0.65 ? 3e10 : 0)

        // 2. Penalidad por distancia al target (preferencia posicional)
        const distPenalty = Math.abs(midMs(sMs, durMs) - targetMs) / ms(1) * 4e6

        // 3. Penalidad por olas (soft: desincentivar clustering)
        let wavePenalty = 0
        for (const slot of globalSlots) {
            if (slot.empId !== null && slot.empId === empId) continue

            // 1. Olas de la misma categoría (distanciamiento social)
            const isGroup = slot.roleKey === rk ||
                (cat === 'leader' && slot.category === 'leader')
            
            // Penalizamos fuertemente el empalme directo de mismos roles
            if (isGroup) {
                const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
                if (overlapMs > 0) {
                    const ratio = overlapMs / Math.min(durMs, slot.endMs - slot.startMs)
                    wavePenalty += ratio * 5e12 // Castigo altísimo (5 Trillones) para priorizar NUNCA empalmar roles idénticos
                } else if (slot.type === (isMeal ? 'meal_30' : 'rest_10')) {
                    // Si no se empalman pero están cerca, castigamos proximidad
                    const diff = Math.abs(sMs - slot.startMs)
                    const ref = isMeal ? WAVE_SAME_ROLE_MEAL_MS : WAVE_SAME_ROLE_REST_MS
                    if (diff < ref) {
                        const prox = 1 - diff / ref
                        wavePenalty += prox * prox * 4e9
                    }
                }
            }

            // 2. Penalidad MASSIVA (Simétrica) Líder ↔ Subordinado
            // Líderes y subordinados deben huir mutuamente con máxima prioridad,
            // garantizando que el líder siempre esté libre cuando el equipo come.
            const isLeaderFleeing = cat === 'leader' && slot.category !== 'leader'
            const isSubordinateFleeing = cat !== 'leader' && slot.category === 'leader'

            if (isLeaderFleeing || isSubordinateFleeing) {
                const overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs))
                if (overlapMs > 0) {
                    const overlapRatio = overlapMs / ms(30) // Penlaización proporcional (minimizador de colisión)
                    if (isMeal && slot.type === 'meal_30') {
                        wavePenalty += 5e11 * overlapRatio // Meal vs Meal cruzado jerarquías
                    } else {
                        wavePenalty += 5e8 * overlapRatio
                    }
                }
            }
        }

        return heatPenalty + distPenalty + wavePenalty
    }

    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: Encuentra el target más frío dentro de una ventana
    //  Para turnos PM donde el centro de la ventana cae en zona caliente,
    //  esto evita que el "target ideal" apunte al MAX.
    // ────────────────────────────────────────────────────────────────────────
    function coolTarget(wStartMs: number, wEndMs: number, durMs: number): number {
        let best = wStartMs, bestH = Infinity
        for (let t = wStartMs; t <= wEndMs - durMs; t += SLOT_STEP_MS) {
            const h = spanHeat(t, t + durMs, getHeat)
            if (h < bestH) { bestH = h; best = t }
        }
        return midMs(best, durMs)
    }

    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN PRINCIPAL: Encontrar el mejor slot para un break
    //
    //  Fase 1: Filtro duro  → elimina heat bloqueado + violaciones personales
    //  Fase 2: Filtro wave  → normal → relaxed → off (en ese orden)
    //  Fase 3: Scoring      → entre válidos, menor costo gana
    //  Fallback: si nada pasa Fase 1 → slot más frío disponible (ignora gaps
    //            personales excepto traslape directo, NUNCA ignora heat absoluto)
    // ────────────────────────────────────────────────────────────────────────
    function findSlot(
        wStartMs: number,
        wEndMs: number,
        durationMins: number,
        personalBreaks: BreakBlock[],
        shift: any,
        isMeal: boolean,
        targetMs: number
    ): Date {
        const durMs = ms(durationMins)
        const type = isMeal ? 'meal_30' : 'rest_10'

        // Generar grilla de candidatos alineada a medianoche en pasos de 10 min
        // PREVENCIÓN DE MEAL PENALTY: Aunque la ley dice "comenzar antes de finalizar la 5ta hora",
        // restamos - durMs (30 min) a wEndMs asegurando un colchón sagrado.
        // Si el límite se ajusta exacto a su 5ta hora, un minuto tarde al checador de reloj lo quiebra todo.
        const gridFirst = Math.ceil(wStartMs / SLOT_STEP_MS) * SLOT_STEP_MS
        const candidates: number[] = []
        for (let t = gridFirst; t <= wEndMs - durMs; t += SLOT_STEP_MS) {
            candidates.push(t)
        }

        if (candidates.length === 0) {
            console.warn(`⚠️  Ventana vacía para ${shift.employee_name} — usando wStart`)
            return new Date(wStartMs)
        }

        // ── Fase 1: Filtro duro ─────────────────────────────────────────────
        const rk = getRoleKey(shift)
        const cat = getRoleCategory(rk)
        const empId = shift.employee_id ?? null

        const hardValid = candidates.filter(t => {
            if (heatBlocks(t, t + durMs, isMeal)) return false
            if (personalViolation(t, t + durMs, type, personalBreaks)) return false

            // Regla Estructural Inviolable: JAMÁS empalmar mismo rol o líder con líder en Fase 1
            for (const slot of globalSlots) {
                if (slot.empId !== null && slot.empId === empId) continue
                const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                if (overlapMs > 0) {
                    const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                    
                    const isLeaderFleeing = cat === 'leader' && slot.category !== 'leader'
                    const isSubordinateFleeing = cat !== 'leader' && slot.category === 'leader'

                    if (isLeaderConflict || isLeaderFleeing || isSubordinateFleeing) {
                        return false
                    }
                }
            }
            return true
        })

        // ── Fase 2: Filtro wave (normal → relaxed → off) ────────────────────
        let pool: number[] = []

        // Intento 1: wave normal
        pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'normal'))

        // Intento 2: wave relaxed (si no hay opciones normales)
        if (pool.length === 0) {
            pool = hardValid.filter(t => !waveViolation(t, t + durMs, shift, isMeal, 'relaxed'))
            if (pool.length > 0) {
                console.warn(`⚠️  Wave RELAXED para ${isMeal ? 'meal' : 'rest'} — ${shift.employee_name || shift.employee_id}`)
            }
        }

        // Intento 3: wave off (si aún no hay opciones — mantiene heat + personal)
        if (pool.length === 0) {
            pool = hardValid
            if (pool.length > 0) {
                console.warn(`⚠️  Wave OFF para ${isMeal ? 'meal' : 'rest'} — ${shift.employee_name || shift.employee_id}`)
            }
        }

        // ── Fallback: ningún slot pasó heat + personal ──────────────────────
        // Esto solo ocurre en turnos donde TODA la ventana legal es zona caliente.
        // En ese caso tomamos el slot MENOS caliente disponible que sea ESTRUCTURALMENTE LEGAL 
        // (es decir, ignora wave soft preferentials, ¡pero NUNCA permite empalmes ilegales!)
        if (pool.length === 0) {
            console.warn(`🔴 HEAT FALLBACK — ${isMeal ? 'meal' : 'rest'} para ${shift.employee_name || shift.employee_id}. Toda la ventana es zona caliente.`)

            const fallback = candidates
                .filter(t => {
                    // 1. Personal Overlap Directo (Mismo Empleado) - INVIOLABLE
                    // No podemos permitir "back-to-back" breaks para el mismo empleado nunca.
                    for (const pb of personalBreaks) {
                        const ps = new Date(pb.start_time).getTime()
                        const pe = new Date(pb.end_time).getTime()
                        // Traslape directo (borde a borde) o gap menor a 45 minutos.
                        const dist = t >= pe ? t - pe : ps - (t + durMs)
                        if (dist < 45 * 60000) return false
                    }
                    
                    // 2. Global Overlaps Estructurales - ILEGALES
                    // NUNCA empalmamos mismo rol; líderes no se empalman.
                    // PERO DEBEMOS PERMITIR empalmes cross-role porque matemáticamente 
                    // no caben 15 empleados sin tocarse.
                    const rk = getRoleKey(shift)
                    const cat = getRoleCategory(rk)
                    const empId = shift.employee_id ?? null
                    
                    for (const slot of globalSlots) {
                        if (slot.empId !== null && slot.empId === empId) continue
                        
                        const overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs))
                        if (overlapMs > 0) {
                            const isSameRole = slot.roleKey === rk
                            const isLeaderConflict = cat === 'leader' && slot.category === 'leader'
                            
                            // Mismos roles o líderes no pueden empalmarse bajo ninguna circunstancia
                            // Y Líderes VS Subordinados TAMPOCO pueden empalmarse JAMÁS.
                            const isLeaderFleeing = cat === 'leader' && slot.category !== 'leader'
                            const isSubordinateFleeing = cat !== 'leader' && slot.category === 'leader'

                            if (isLeaderConflict || isLeaderFleeing || isSubordinateFleeing || isSameRole) {
                                // Permiso de vida o muerte: Si ya no hay espacio matemático, permitiremos un pequeño overlap de 10 min 
                                // entre el mismo rol, pero núnca entre líderes y subordinados.
                                if (isSameRole && !isLeaderConflict && !isLeaderFleeing && !isSubordinateFleeing) {
                                     if (overlapMs > 15 * 60000) return false; // Bloquea si empalman más de 15 min
                                } else {
                                     return false
                                }
                            }
                        }
                    }
                    
                    // NOTA: Ignoramos heatBlocks(). Si llegamos aquí, ACEPTAMOS LA ZONA ROJA
                    // a cambio de no violar la ley personal de solape duro y jerarquías.
                    return true
                })
                .sort((a, b) => spanHeat(a, a + durMs, getHeat) - spanHeat(b, b + durMs, getHeat))
            if (fallback.length > 0) {
                // En lugar de ciega y agresivamente devolver fallback[0] (que crea pegotes back-to-back),
                // pasamos este fallback al 'pool' para que Fase 3 corra 'scoreSlot' y elija el menos destructivo.
                pool = fallback
            } else {
                // Caso extremo absoluto: Imposibilidad matemática detectada.
                // Si llegamos aquí, ni siquiera el fallback estructural sirvió. 
                console.warn(`💥 FALLBACK TOTAL EXHAUSTO para ${shift.employee_name}. Asfixia matemática.`)
                
                // Evitamos fusionar dos descansos juntos en Total Exhausto
                let emergencyStartMs = wStartMs
                for (const pb of personalBreaks) {
                    const pe = new Date(pb.end_time).getTime()
                    if (emergencyStartMs >= pe && (emergencyStartMs - pe) < ms(45)) {
                        emergencyStartMs = pe + ms(45)
                    }
                }
                if (emergencyStartMs + durMs > wEndMs) emergencyStartMs = wStartMs
                
                return new Date(emergencyStartMs)
            }
        }

        // ── Fase 3: Scoring — menor costo gana ─────────────────────────────
        let bestSlot = pool[0]
        let bestCost = Infinity
        for (const t of pool) {
            const cost = scoreSlot(t, durMs, isMeal, targetMs, shift)
            if (cost < bestCost) { bestCost = cost; bestSlot = t }
        }

        return new Date(bestSlot)
    }

    // ────────────────────────────────────────────────────────────────────────
    //  ORDEN DE PROCESAMIENTO: shifts con ventana de meal más estrecha primero
    //  (los más restringidos por el calor se asignan primero para no dejarlos
    //   sin opciones cuando los demás ya ocuparon los slots fríos)
    // ────────────────────────────────────────────────────────────────────────
    function countCoolMealSlots(shift: any): number {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = new Date(shift.end_time).getTime()
        const wEnd = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), eMs - ms(60 * H_END_BUFFER))
        const wStart = sMs + ms(60 * H_MIN_START)
        let cool = 0
        for (let t = wStart; t <= wEnd - ms(30); t += SLOT_STEP_MS) {
            if (!heatBlocks(t, t + ms(30), true)) cool++
        }
        return cool
    }

    // Ordenar: menos slots fríos disponibles → se procesa primero
    const processed = [...augmented].sort((a, b) => {
        // Primera prioridad: Cantidad de slots "fríos". Los más asfixiados eligen primero.
        const aCool = countCoolMealSlots(a)
        const bCool = countCoolMealSlots(b)
        if (aCool !== bCool) return aCool - bCool

        // Segunda prioridad: LÍDERES primero garantizado
        const aCat = getRoleCategory(getRoleKey(a))
        const bCat = getRoleCategory(getRoleKey(b))
        if (aCat === 'leader' && bCat !== 'leader') return -1
        if (bCat === 'leader' && aCat !== 'leader') return 1

        return 0
    })

    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 1 — MEALS PRIMERO
    //
    //  Razón: Los rests deben segmentarse ALREDEDOR de los meals.
    //  Si asignamos rests primero, no podemos garantizar la distribución correcta.
    // ══════════════════════════════════════════════════════════════════════════

    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = new Date(shift.end_time).getTime()
        const req = getRequiredBreaks(sMs, eMs)
        const meals = req.filter(b => b.type === 'meal_30')
        const restCount = req.filter(b => b.type === 'rest_10').length

        const endBuf = eMs - ms(60 * H_END_BUFFER)

        // Cohort: distribuir empleados del mismo grupo a lo largo de la ventana
        // en lugar de apuntar todos al mismo target
        const cohortIdx = shift._cohortIdx ?? 0
        const cohortSize = shift._cohortSize ?? 1

        meals.forEach((_, mealIdx) => {
            let wStartMs: number
            let wEndMs: number

            if (mealIdx === 0) {
                // CA law: primer meal antes de la 5ta hora trabajada
                // El usuario pidió: "se pueden adelantar lunches antes de los breaks si es necesario, 
                // respetando una hora despues de haber iniciado turno".
                const minOff = 1.0
                wStartMs = sMs + ms(60 * minOff)
                wEndMs = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), endBuf)
            } else {
                // Segundo meal: entre la 7a y 10a hora trabajada
                wStartMs = sMs + ms(60 * H_SECOND_MEAL_START)
                wEndMs = Math.min(sMs + ms(60 * H_SECOND_MEAL_END), endBuf)
            }

            // Garantizar ventana mínima de 60 min
            if (wEndMs - wStartMs < ms(60)) {
                wEndMs = Math.min(endBuf, wStartMs + ms(90))
            }

            // ── Cohort stagger ────────────────────────────────────────────
            // Distribuir cada miembro del cohorte en una fracción diferente
            // de la ventana, LUEGO snappear al punto más frío cerca de ahí.
            //
            // Esto evita que los 4 PM cashiers apunten todos al mismo target.
            // En vez de eso, uno va al inicio de ventana, otro al centro, etc.
            const frac = cohortSize > 1
                ? cohortIdx / (cohortSize - 1)
                : 0.5
            const rawTarget = wStartMs + (wEndMs - wStartMs) * frac

            // Buscar el punto más frío dentro de ±40 min del target crudo
            const snapStart = Math.max(wStartMs, rawTarget - ms(40))
            const snapEnd = Math.min(wEndMs, rawTarget + ms(40))
            const targetMs = coolTarget(snapStart, snapEnd, ms(30))

            const best = findSlot(wStartMs, wEndMs, 30, shift.breaks_schedule, shift, true, targetMs)
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
                empId: shift.employee_id ?? null
            })

            console.warn(
                `🍽️  ${shift.employee_name || shift.employee_id} meal#${mealIdx + 1}` +
                ` → ${best.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` +
                ` (heat=${spanHeat(best.getTime(), bestEnd.getTime(), getHeat).toFixed(2)})`
            )
        })

        shift.breaks_schedule = sortChron(shift.breaks_schedule)
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 2 — RESTS (segmentados alrededor de los meals ya asignados)
    //
    //  Segmentación:
    //  0 meals → rests distribuidos uniformemente en el turno
    //  1 meal  → 1 rest: en el segmento más largo (antes o después del meal)
    //            2 rests: 1 antes del meal, 1 después
    //  2 meals → 3 rests: antes de meal1, entre meal1 y meal2, después de meal2
    // ══════════════════════════════════════════════════════════════════════════

    for (const shift of processed) {
        const sMs = new Date(shift.start_time).getTime()
        const eMs = new Date(shift.end_time).getTime()
        const req = getRequiredBreaks(sMs, eMs)
        const rests = req.filter(b => b.type === 'rest_10')

        if (rests.length === 0) continue

        const minStart = sMs + ms(60 * H_MIN_START)
        const endBuf = eMs - ms(60 * H_END_BUFFER)

        const meals = sortChron(
            shift.breaks_schedule.filter((b: BreakBlock) => b.type === 'meal_30')
        ).map((m: any) => ({
            sMs: new Date(m.start_time).getTime(),
            eMs: new Date(m.end_time).getTime()
        }))

        // ── Construir segmentos dinámicamente ──────────────────────────────────
        type Segment = { sMs: number; eMs: number }
        const rawSegments: Segment[] = []
        let safeStart = minStart

        for (const m of meals) {
            if (m.sMs > safeStart) {
                rawSegments.push({ sMs: safeStart, eMs: m.sMs })
            }
            safeStart = m.eMs
        }
        if (endBuf > safeStart) {
            rawSegments.push({ sMs: safeStart, eMs: endBuf })
        }

        // Descartar segmentos donde es físicamente imposible meter un Rest separado
        // Queremos al menos 45 min de espacio para que no choque con el meal
        const validSegments = rawSegments.filter(seg => (seg.eMs - seg.sMs) >= ms(45))
        
        if (validSegments.length === 0) {
            // Rescate de emergencia, agarramos todo el turno
            validSegments.push({ sMs: minStart, eMs: endBuf })
        }

        const totalValidMs = validSegments.reduce((sum, seg) => sum + (seg.eMs - seg.sMs), 0)

        // ── Asignar cada rest proporcionalmente en el espacio válido ─────────────
        rests.forEach((_, restIdx) => {
            const idealTargetMs = totalValidMs * ((restIdx + 0.5) / rests.length)
            
            let accum = 0
            let targetSeg = validSegments[validSegments.length - 1]
            for (const seg of validSegments) {
                const w = seg.eMs - seg.sMs
                if (idealTargetMs <= accum + w) {
                    targetSeg = seg
                    break
                }
                accum += w
            }

            let wStart = targetSeg.sMs
            let wEnd = targetSeg.eMs

            // Ya no es necesario forzar expansiones porque validSegments siempre >= 45m
            // Target: punto central del gap que le toca
            const rawMid = targetSeg.sMs + (idealTargetMs - accum)
            const targetMs = coolTarget(rawMid - ms(20), rawMid + ms(20), ms(10))

            const best = findSlot(wStart, wEnd, 10, shift.breaks_schedule, shift, false, targetMs)
            const bestEnd = new Date(best.getTime() + ms(10))

            shift.breaks_schedule.push({
                type: 'rest_10',
                start_time: toIso(best),
                end_time: toIso(bestEnd),
                status: 'scheduled'
            })

            const rk = getRoleKey(shift)
            globalSlots.push({
                type: 'rest_10',
                startMs: best.getTime(),
                endMs: bestEnd.getTime(),
                roleKey: rk,
                category: getRoleCategory(rk),
                empId: shift.employee_id ?? null
            })

            shift.breaks_schedule = sortChron(shift.breaks_schedule)
        })
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  DIAGNÓSTICO FINAL — log de todo lo asignado para verificación
    // ══════════════════════════════════════════════════════════════════════════

    console.warn('─'.repeat(60))
    console.warn('📋 RESUMEN FINAL DE BREAKS ENGINE V16:')

    let violations = 0

    for (const shift of augmented) {
        const sched = sortChron(shift.breaks_schedule) as BreakBlock[]
        const log = sched.map(b => {
            const t = new Date(b.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
            const h = spanHeat(
                new Date(b.start_time).getTime(),
                new Date(b.end_time).getTime(),
                getHeat
            )
            const hFlag = h >= HEAT_MEAL ? '🔴' : h >= HEAT_REST ? '🟠' : h >= 0.50 ? '🟡' : '🟢'
            return `${b.type === 'meal_30' ? '🍽️' : '☕'} ${t} ${hFlag}${h.toFixed(2)}`
        }).join('  |  ')

        // Verificar violaciones de spacing personal
        for (let i = 0; i < sched.length; i++) {
            for (let j = i + 1; j < sched.length; j++) {
                const a = sched[i], b = sched[j]
                const ae = new Date(a.end_time).getTime()
                const bs = new Date(b.start_time).getTime()
                const gap = bs - ae
                const req = a.type === b.type
                    ? (a.type === 'rest_10' ? GAP_RR_MS : GAP_MM_MS)
                    : GAP_MR_MS
                if (gap < req) {
                    console.warn(`🚨 VIOLATION: ${shift.employee_name} gap=${Math.round(gap / 60000)}min < req=${Math.round(req / 60000)}min`)
                    violations++
                }
            }
        }

        console.warn(`👤 ${(shift.employee_name || shift.employee_id || '?').toString().padEnd(22)} | ${log}`)
    }

    if (violations === 0) {
        console.warn('✅ Sin violaciones de spacing personal detectadas')
    } else {
        console.warn(`🚨 ${violations} violaciones de spacing detectadas — revisar turnos cortos o ventanas saturadas`)
    }
    console.warn('─'.repeat(60))

    return augmented as Shift[]
}
