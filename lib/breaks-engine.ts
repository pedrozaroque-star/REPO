import { Shift } from '@/app/planificador-v2/lib/types';
import { OperatingHour } from '@/lib/intelligence';

export type BreakBlock = {
    type: 'rest_10' | 'meal_30';
    start_time: string; // ISO String
    end_time: string;   // ISO String
    status?: 'scheduled' | 'taken' | 'waived';
};

/**
 * Calculates required breaks for a shift strictly following California Labor Laws.
 * @param start - Shift start time
 * @param end - Shift end time
 * @returns Array of required breaks without assigned times yet
 */
export function getRequiredBreaksCA(start: Date, end: Date): Omit<BreakBlock, 'start_time' | 'end_time'>[] {
    const durationMs = end.getTime() - start.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);

    const breaks: Omit<BreakBlock, 'start_time' | 'end_time'>[] = [];

    // ═══════════════════════════════════════════════════════════════════
    // California Labor Law — Tabla Oficial de Descansos
    // ═══════════════════════════════════════════════════════════════════
    //
    // REST BREAKS (10 min, PAGADOS):
    //   < 3.5h:     0 descansos
    //   3.5 – 6h:   1 descanso
    //   6.1 – 10h:  2 descansos
    //   10.1 – 14h: 3 descansos
    //   > 14h:      4 descansos
    //
    // MEAL BREAKS (30 min, NO PAGADOS):
    //   ≤ 5h:       0 comidas
    //   5.1 – 10h:  1 comida
    //   10.1 – 12h: 2 comidas (2do puede renunciarse si se tomó el 1ro)
    //   > 12h:      2 comidas (OBLIGATORIO ambos)
    // ═══════════════════════════════════════════════════════════════════

    // REST BREAKS
    if (durationHours > 14) {
        breaks.push({ type: 'rest_10' }, { type: 'rest_10' }, { type: 'rest_10' }, { type: 'rest_10' });
    } else if (durationHours > 10) {
        breaks.push({ type: 'rest_10' }, { type: 'rest_10' }, { type: 'rest_10' });
    } else if (durationHours > 6) {
        breaks.push({ type: 'rest_10' }, { type: 'rest_10' });
    } else if (durationHours >= 3.5) {
        breaks.push({ type: 'rest_10' });
    }

    // MEAL BREAKS
    if (durationHours > 5) {
        breaks.push({ type: 'meal_30' });
    }
    // 10.1+ horas: Programar 2do meal por defecto (waivable entre 10-12h, obligatorio > 12h)
    if (durationHours > 10) {
        breaks.push({ type: 'meal_30' });
    }

    return breaks;
}

/**
 * AI Engine to schedule breaks based on demand valleys.
 * @param shifts - List of scheduled shifts for a given day
 * @param operatingHours - The output of generateSmartForecast().hours containing projected_sales
 * @returns Shifts augmented with their calculated breaks
 */
export function scheduleBreaksWithDemand(shifts: Shift[], operatingHours: OperatingHour[]): Shift[] {
    // 1. Establish the "Sales Heatmap" (valleys = lower sales)
    let maxSales = Math.max(...operatingHours.map((h) => h.projected_sales)) || 1;
    const hourScores = new Map<number, number>(); // hour (0-23) -> intensity (0.0 to 1.0)
    
    if (maxSales < 10) {
        // Fallback dinámico para "Inteligencia Ciega" (Si no hay histórico de Toast)
        const baseMockCurve: Record<number, number> = {
            6: 10, 7: 30, 8: 80, 9: 150, 
            10: 300, 11: 600, 12: 950, 13: 850, 14: 400, 15: 250, 16: 300, 
            17: 500, 18: 800, 19: 900, 20: 750, 21: 500, 22: 300, 23: 150, 
            24: 50, 25: 20, 26: 10, 27: 5
        };
        maxSales = 950;
        for (const [h, s] of Object.entries(baseMockCurve)) {
            hourScores.set(parseInt(h), s / maxSales);
        }
    } else {
        operatingHours.forEach((h) => {
            hourScores.set(h.hour, h.projected_sales / maxSales);
        });
    }

    // To prevent two people from going on break at the same time globally
    const globalUnavailable: { start: number, end: number, roleKey: string, isLeader: boolean }[] = [];

    // (checkGlobalOverlap removido — reemplazado por lógica inline de roles en findBestSlot)

    // Step 1: Initialize augmented shifts con Orden Estratégico (Escudo Operativo V2)
    const sortedShifts = [...shifts].sort((a, b) => {
        const aStart = new Date(a.start_time).getTime();
        const bStart = new Date(b.start_time).getTime();
        
        // Agrupar rígidamente por la hora de entrada redondeada para preservar transitividad
        // Ej: 4:45 PM -> 5:00 PM (17), 5:10 PM -> 5:00 PM (17)
        const getLogicalHour = (ts: number) => {
            const d = new Date(ts);
            let h = d.getHours();
            if (d.getMinutes() >= 45) h += 1;
            return h;
        };

        const aHour = getLogicalHour(aStart);
        const bHour = getLogicalHour(bStart);
        
        // Si pertenecen al mismo bloque lógico (Ej. el bloque de las 5 PM)
        if (aHour === bHour) {
            // Priority 1: Líderes primero siempre. (Se quedan con los mejores lugares)
            const aIsLeader = (a as any).is_leader ? 1 : 0;
            const bIsLeader = (b as any).is_leader ? 1 : 0;
            if (aIsLeader !== bIsLeader) return bIsLeader - aIsLeader; 
            
            // Priority 2: Duración del turno. (Turnos cortos evacúan temparano)
            const durA = new Date(a.end_time).getTime() - aStart;
            const durB = new Date(b.end_time).getTime() - bStart;
            if (durA !== durB) return durA - durB;
        }
        
        // Priority 3: Hora de entrada normal
        return aStart - bStart;
    });

    const augmentedShifts: any[] = sortedShifts.map(shift => ({
        ...shift,
        breaks_schedule: []
    }));

    // Helper to find the best slot in a window
    const findBestSlot = (
        windowStart: Date,
        windowEnd: Date,
        durationMins: number,
        allowPersonalOverlapCheck: boolean,
        scheduledBreaks: BreakBlock[],
        isMeal: boolean,
        shift: any
    ) => {
        const STEP_MS = 15 * 60000;
        const DURATION_MS = durationMins * 60000;
        // REGLA: Separación mínima entre breaks personales del mismo empleado.
        // 45 minutos asegura trabajo productivo entre breaks, pero permite que los
        // rests escapen al valle POST-RUSH cuando el lunch está en la tarde.
        // (Antes era 90 min, lo cual bloqueaba toda la tarde si el lunch estaba a las 3 PM)
        const MIN_GAP_MS = 45 * 60 * 1000; // 45 minutos
        
        let bestStart = windowStart;
        let lowestScore = Infinity;

        for (let t = windowStart.getTime(); t <= windowEnd.getTime() - DURATION_MS; t += STEP_MS) {
            const bStart = new Date(t);
            const bEnd = new Date(t + DURATION_MS);
            
            let violatesPersonal = false;
            if (allowPersonalOverlapCheck) {
                violatesPersonal = scheduledBreaks.some(b => {
                    const sbStart = new Date(b.start_time).getTime();
                    const sbEnd = new Date(b.end_time).getTime();
                    return (bStart.getTime() < sbEnd + MIN_GAP_MS && bEnd.getTime() > sbStart - MIN_GAP_MS);
                });
            }
            if (violatesPersonal) continue;

            // ═══════════════════════════════════════════════════════════════════
            // SALES SCORE — Se calcula ANTES del empalme para poder usarlo en las 
            // reglas de overlap durante horas pico.
            // ═══════════════════════════════════════════════════════════════════
            const hour = bStart.getHours();
            // BUGFIX: Default missing data to 0.05 (Valley) instead of 1.0 (Max Rush).
            const salesScore = hourScores.get(hour) ?? 0.05;
            
            // HARD BLOCK: Solo PICO y MAX absolutos (>= 0.85) son completamente intocables.
            // Para horas intermedias (0.55–0.84), el sistema de scoring con POW(12) y
            // proximity penalty las hace MUY caras, pero NO imposibles — esto evita
            // Panic Mode innecesario y deja que la IA elija la "menos mala".
            if (salesScore >= 0.85) {
                continue; 
            }

            // ═══════════════════════════════════════════════════════════════════
            // OVERLAP RULES — Reglas estrictas del usuario
            // ═══════════════════════════════════════════════════════════════════
            // SIEMPRE (cualquier intensidad):
            //   • MISMO PUESTO (cashier+cashier, cook+cook): CERO empalme.
            //   • LÍDER vs CUALQUIERA: CERO empalme.
            //
            // DURANTE HORAS OCUPADAS (salesScore >= 0.55):
            //   • CUALQUIER PUESTO vs CUALQUIER PUESTO: CERO empalme.
            //   • "Uno por uno" — el restaurante necesita a todos en piso.
            //
            // DURANTE VALLE (salesScore < 0.55):
            //   • Tropa diferente (cashier+cook): SIN restricción.
            //   • Operan en estaciones aisladas (FOH vs BOH).
            // ═══════════════════════════════════════════════════════════════════
            const isRushHour = salesScore >= 0.55;
            let overlapBlocked = false;
            const shiftRole = ((shift as any).job_title || shift.job_id || 'unknown').toString().toLowerCase().trim();
            const isManagerOrLeader = (shift as any).is_leader === true || 
                shiftRole.includes('manager') || 
                shiftRole.includes('leader') || 
                shiftRole.includes('assistant') || 
                shiftRole.includes('asistente');
            
            for (const unavail of globalUnavailable) {
                const oStart = Math.max(bStart.getTime(), unavail.start);
                const oEnd = Math.min(bEnd.getTime(), unavail.end);
                if (oStart < oEnd) {
                    const isSameRole = unavail.roleKey === shiftRole;
                    
                    if (isSameRole) {
                        // MISMO PUESTO: CERO empalme. Totalmente prohibido.
                        overlapBlocked = true;
                        break;
                    } 
                    
                    if (isManagerOrLeader || unavail.isLeader) {
                        // Ningún líder puede empalmarse con la tropa, ni la tropa puede empalmarse con el líder.
                        overlapBlocked = true;
                        break;
                    }
                    
                    // REGLA RUSH: Durante horas pesadas (RUSH/PICO/MAX), NADIE se empalma con NADIE.
                    // Solo en horas valle/moderadas se permite tropa diferente al mismo tiempo.
                    if (isRushHour) {
                        overlapBlocked = true;
                        break;
                    }
                    
                    // VALLE/MODERADO: Tropa regular vs Tropa Regular diferente → sin restricción.
                }
            }
            if (overlapBlocked) continue;

            const peakPenalty = Math.pow(salesScore, 12) * 10_000_000_000;

            // ═══════════════════════════════════════════════════════════════════
            // MULTI-PEAK NEIGHBORHOOD PENALTY (V9 — Solución Lynwood)
            // ═══════════════════════════════════════════════════════════════════
            // El viejo sistema detectaba UN pico y penalizaba las 4h antes.
            // Esto FALLABA en tiendas con MÚLTIPLES rush hours (Lynwood:
            // 2-4 PM AM rush + 7-8 PM PM rush).
            //
            // NUEVO: Calculamos el PROMEDIO de intensidad en una ventana de ±2h
            // alrededor del slot. Cualquier slot CERCA de CUALQUIER pico tendrá
            // vecinos con intensidad alta → penalty automáticamente alta.
            // Un slot en un valle verdadero → vecinos bajos → penalty mínima.
            //
            // Esto detecta automáticamente TODOS los picos sin configuración.
            // ═══════════════════════════════════════════════════════════════════
            let neighborhoodPenalty = 0;
            const slotHour = bStart.getHours();
            
            // Average intensity of ±2 hours around this slot
            let neighborhoodSum = 0;
            let neighborhoodCount = 0;
            for (let h = slotHour - 2; h <= slotHour + 2; h++) {
                // Handle hours > 23 (for late-night shifts)
                const normalizedH = h < 0 ? h + 24 : (h > 23 ? h - 24 : h);
                const score = hourScores.get(normalizedH) ?? 0.05;
                neighborhoodSum += score;
                neighborhoodCount++;
            }
            const avgNeighborhood = neighborhoodSum / neighborhoodCount;
            
            // Exponential penalty: a neighborhood avg of 0.60 is 100x worse than 0.20
            neighborhoodPenalty = Math.pow(avgNeighborhood, 8) * 5_000_000_000;

            // MEALS: Solo peakPenalty (busca la hora menos intensa → naturalmente PRE-RUSH)
            // REST:  peakPenalty + neighborhoodPenalty (evita CUALQUIER zona rush, AM o PM)
            const score = peakPenalty + (isMeal ? 0 : neighborhoodPenalty);

            if (score < lowestScore) {
                lowestScore = score;
                bestStart = bStart;
            }
        }
        
        if (lowestScore === Infinity) {
            // PANIC MODE: The entire window was blocked by Red Zones (salesScore >= 0.85).
            // We MUST schedule a break anyway due to California Law.
            // We will re-scan the window ignoring the red zone penalty, but strictly respecting overlap rules.
            let panicStart = windowStart;
            let foundPanicSlot = false;
            let lowestPanicScore = Infinity;
            
            for (let t = windowStart.getTime(); t <= windowEnd.getTime() - DURATION_MS; t += STEP_MS) {
                const bStart = new Date(t);
                const bEnd = new Date(t + DURATION_MS);
                
                let overlapBlocked = false;
                
                // Panic Mode MUST still respect the 90-minute gap between personal breaks!
                if (allowPersonalOverlapCheck) {
                    const violatesPersonal = scheduledBreaks.some(b => {
                        const sbStart = new Date(b.start_time).getTime();
                        const sbEnd = new Date(b.end_time).getTime();
                        return (bStart.getTime() < sbEnd + MIN_GAP_MS && bEnd.getTime() > sbStart - MIN_GAP_MS);
                    });
                    if (violatesPersonal) {
                        continue; // Keep searching panic mode for a 60-min spaced slot
                    }
                }
                
                const shiftRole = ((shift as any).job_title || shift.job_id || 'unknown').toString().toLowerCase().trim();
                const isManagerOrLeader = (shift as any).is_leader === true || 
                    shiftRole.includes('manager') || shiftRole.includes('leader') || shiftRole.includes('assistant') || shiftRole.includes('asistente');
                
                // Calcular salesScore ANTES del overlap check
                const hour = bStart.getHours();
                const salesScore = hourScores.get(hour) ?? 0.05;
                
                for (const unavail of globalUnavailable) {
                    const oStart = Math.max(bStart.getTime(), unavail.start);
                    const oEnd = Math.min(bEnd.getTime(), unavail.end);
                    if (oStart < oEnd) {
                        const isSameRole = unavail.roleKey === shiftRole;
                        // PANIC MODE — REGLAS CALIBRADAS:
                        // 1. MISMO PUESTO: Siempre bloqueado (cashier+cashier, cook+cook).
                        if (isSameRole) {
                            overlapBlocked = true;
                            break;
                        }
                        // 2. LÍDER vs LÍDER: Siempre bloqueado (asst manager + shift leader).
                        //    Dos líderes NUNCA pueden ir al mismo tiempo, ni en crisis.
                        if (isManagerOrLeader && unavail.isLeader) {
                            overlapBlocked = true;
                            break;
                        }
                        // 3. LÍDER vs TROPA: RELAJADO en Panic Mode.
                        //    Si bloqueamos líder contra tropa aquí, el líder no encuentra
                        //    NINGÚN slot libre (toda la ventana es roja + llena de tropa)
                        //    → cae a windowStart (la hora MÁS ROJA). Preferimos un empalme
                        //    temporal con tropa que poner al líder en MAX.
                    }
                }
                
                if (overlapBlocked) continue;

                // En Panic Mode ignoramos el BAN ESTRICTO de salesScore >= 0.75, 
                // PERO AUN ASI preferimos el menor daño usando la curva exponencial de penalidad.
                // NOTA: En Panic Mode, el Magneto de Líderes está DESACTIVADO.
                // Si estamos aquí, es porque TODA la ventana es roja. La prioridad es
                // minimizar daño a ventas (menor salesScore), NO forzar al líder temprano.
                const peakPenalty = Math.pow(salesScore, 8) * 50_000_000;

                if (peakPenalty < lowestPanicScore) {
                    lowestPanicScore = peakPenalty;
                    panicStart = bStart;
                    foundPanicSlot = true;
                }
            }

            let fallbackStart = foundPanicSlot ? panicStart : windowStart;
            
            if (allowPersonalOverlapCheck) {
                // Ensure the fallback doesn't glue breaks together
                for (const b of scheduledBreaks) {
                    const sbEnd = new Date(b.end_time).getTime();
                    const requiredStart = sbEnd + MIN_GAP_MS;
                    if (fallbackStart.getTime() < requiredStart && (fallbackStart.getTime() + DURATION_MS) > new Date(b.start_time).getTime() - MIN_GAP_MS) {
                        fallbackStart = new Date(requiredStart);
                    }
                }
            }
            
            // CRITICAL FIX V8: El cap debe respetar AMBOS límites:
            // 1. windowEnd (ventana legal para meals — 5 horas para el 1er meal)
            // 2. shiftEnd (fin físico del turno)
            // Para MEALS: si el gap empuja el fallback fuera de la ventana legal,
            // lo forzamos al límite legal. Mejor un empalme que una violación de ley.
            const shiftEnd = new Date(shift.end_time).getTime();
            const legalCap = isMeal 
                ? Math.min(windowEnd.getTime(), shiftEnd) - DURATION_MS
                : shiftEnd - DURATION_MS;
            if (fallbackStart.getTime() > legalCap) {
                fallbackStart = new Date(legalCap);
            }
            
            return fallbackStart;
        }
        return bestStart;
    };

    // Step 2: Schedule ALL MEALS sequentially for everyone
    augmentedShifts.forEach((shift) => {
        const start = new Date(shift.start_time);
        const end = new Date(shift.end_time);
        
        // Legal filter: "All those who work 7 or more hours can go before 6 hours"
        const shiftDurationHours = (end.getTime() - start.getTime()) / 3600000;
        const requiredBreaks = getRequiredBreaksCA(start, end);
        const mealsToSchedule = requiredBreaks.filter(b => b.type === 'meal_30');

        mealsToSchedule.forEach((meal, mealIndex) => {
            // ═══════════════════════════════════════════════════════════════════
            // MEAL WINDOW — CA §512 LEGAL COMPLIANCE (V8)
            // ═══════════════════════════════════════════════════════════════════
            // Offset 5.0h → windowEnd = shift_start + 5h.
            // Último START posible = windowEnd - 30min = shift_start + 4h30m.
            //
            // Para turno de 10 AM: último start = 2:30 PM (4.5h) → LEGAL con
            // 30 minutos de margen antes del límite de 5 horas.
            //
            // Para turno de 9 AM: último start = 1:30 PM (4.5h) → hora 13
            // está BLOQUEADA (salesScore >= 0.85), forzando el lunch a la
            // zona pre-rush 10-11:30 AM (exactamente lo que el manager pide).
            // ═══════════════════════════════════════════════════════════════════
            const mealDeadlineHourOffset = mealIndex === 0 ? 5.0 : 10.0;
            const windowStart = new Date(start.getTime() + (mealIndex === 0 ? 1.0 : 6) * 3600000); 
            let windowEnd = new Date(start.getTime() + mealDeadlineHourOffset * 3600000);
            if (windowEnd > end) windowEnd = end;
            const bestSlotStart = findBestSlot(windowStart, windowEnd, 30, true, shift.breaks_schedule, true, shift);
            const bestSlotEnd = new Date(bestSlotStart.getTime() + 30 * 60000);

            shift.breaks_schedule.push({
                type: 'meal_30',
                start_time: bestSlotStart.toISOString(),
                end_time: bestSlotEnd.toISOString(),
                status: 'scheduled'
            });
            const mealRoleKey = ((shift as any).job_title || shift.job_id || 'unknown').toString().toLowerCase().trim();
            const isLeaderValue = (shift as any).is_leader === true || mealRoleKey.includes('manager') || mealRoleKey.includes('leader') || mealRoleKey.includes('assistant') || mealRoleKey.includes('asistente');
            globalUnavailable.push({ start: bestSlotStart.getTime(), end: bestSlotEnd.getTime(), roleKey: mealRoleKey, isLeader: isLeaderValue });
        });
    });

    // Step 3: Schedule ALL RESTS sequentially for everyone (now they fill the gaps)
    augmentedShifts.forEach((shift) => {
        const start = new Date(shift.start_time);
        const end = new Date(shift.end_time);
        const requiredBreaks = getRequiredBreaksCA(start, end);
        const restsToSchedule = requiredBreaks.filter(b => b.type === 'rest_10');

        const meals = shift.breaks_schedule
            .filter((b: any) => b.type === 'meal_30')
            .sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

        // ═══════════════════════════════════════════════════════════════════
        // WORK SEGMENTS — CA DLSE Compliance
        // ═══════════════════════════════════════════════════════════════════
        // "Rest breaks should be taken as near to the middle of each
        //  four-hour work period as is practicable."
        //
        // Dividimos el turno en SEGMENTOS de trabajo (entre inicio, meals, y fin).
        // Cada rest se asigna al PUNTO MEDIO del segmento correspondiente.
        //
        // Ejemplo: Turno 10 AM-5 PM, Lunch 2:00-2:30 PM, 2 rests:
        //   Seg 1: 10:00 AM – 2:00 PM (4h) → Rest 1 @ 12:00 PM
        //   Seg 2: 2:30 PM – 5:00 PM (2.5h) → Rest 2 @ 3:45 PM
        // ═══════════════════════════════════════════════════════════════════

        // Build work segments from shift boundaries and meal breaks
        const segmentBounds: { start: number; end: number }[] = [];
        let segStart = start.getTime();
        for (const meal of meals) {
            const mealStart = new Date(meal.start_time).getTime();
            const mealEnd = new Date(meal.end_time).getTime();
            if (mealStart > segStart) {
                segmentBounds.push({ start: segStart, end: mealStart });
            }
            segStart = mealEnd;
        }
        if (segStart < end.getTime()) {
            segmentBounds.push({ start: segStart, end: end.getTime() });
        }

        // Distribute rests across segments
        // If more rests than segments, the largest segment gets extras
        restsToSchedule.forEach((rest, restIndex) => {
            let windowStart: Date;
            let windowEnd: Date;

            // Calcular si es segmento pre-meal UNA sola vez
            const firstMealStartMs = meals.length > 0 ? new Date(meals[0].start_time).getTime() : Infinity;
            let isPreMealSegment = false;

            if (restIndex < segmentBounds.length) {
                // Assign this rest to its corresponding segment
                const seg = segmentBounds[restIndex];
                const segMidpoint = seg.start + (seg.end - seg.start) / 2;
                const segDurationH = (seg.end - seg.start) / 3600000;

                // Detectar si este segmento es PRE-MEAL o POST-MEAL
                const isPreMealCandidate = seg.end <= firstMealStartMs;

                // ═══════════════════════════════════════════════════════════════
                // VIABILIDAD MÍNIMA del segmento pre-meal:
                // Necesitamos al menos 2h para que quepa:
                //   1h trabajo mínimo + 10min rest + 45min gap al lunch = ~1h55m
                // Si el segmento es más corto, el rest NO cabe ahí sin pegarse
                // al lunch → lo tratamos como post-meal (ventana abierta).
                // ═══════════════════════════════════════════════════════════════
                if (isPreMealCandidate && segDurationH >= 2.0) {
                    // PRE-MEAL VIABLE: Ventana limitada al segmento
                    // Ej: Turno 5 PM, Lunch 9 PM → seg 4h → rest va a 6-6:30 PM
                    isPreMealSegment = true;
                    windowStart = new Date(seg.start);
                    windowEnd = new Date(seg.end);
                } else {
                    // POST-MEAL o segmento pre-meal MUY CORTO:
                    // Ventana abierta → scoring encuentra valles alejados del meal
                    windowStart = new Date(segMidpoint - 1.5 * 3600000);
                    windowEnd = new Date(end.getTime());
                    if (windowStart.getTime() < seg.start) windowStart = new Date(seg.start);
                }
            } else {
                // Extra rests go to the largest segment
                const largest = segmentBounds.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a, segmentBounds[0]);
                const segMidpoint = largest.start + (largest.end - largest.start) / 2;
                windowStart = new Date(segMidpoint - 1.0 * 3600000);
                windowEnd = new Date(end.getTime());
            }

            // STRICT RULE: No break can start before 1.0 hours worked.
            const minAllowedStart = new Date(start.getTime() + 1.0 * 3600000);
            if (windowStart < minAllowedStart) {
                windowStart = minAllowedStart;
            }
            // Allow breaks up to 15 min before shift end
            const maxRestEnd = new Date(end.getTime() - 15 * 60000); 
            if (windowEnd > maxRestEnd) windowEnd = maxRestEnd;

            if (windowStart >= windowEnd) {
                 windowStart = new Date(windowEnd.getTime() - 15 * 60000);
                 if (windowStart < minAllowedStart) windowStart = minAllowedStart;
            }

            const bestSlotStart = findBestSlot(windowStart, windowEnd, 10, true, shift.breaks_schedule, isPreMealSegment, shift);
            const bestSlotEnd = new Date(bestSlotStart.getTime() + 10 * 60000);

            shift.breaks_schedule.push({
                type: 'rest_10',
                start_time: bestSlotStart.toISOString(),
                end_time: bestSlotEnd.toISOString(),
                status: 'scheduled'
            });
            const restRoleKey = ((shift as any).job_title || shift.job_id || 'unknown').toString().toLowerCase().trim();
            const isLeaderRestValue = (shift as any).is_leader === true || restRoleKey.includes('manager') || restRoleKey.includes('leader') || restRoleKey.includes('assistant') || restRoleKey.includes('asistente');
            globalUnavailable.push({ start: bestSlotStart.getTime(), end: bestSlotEnd.getTime(), roleKey: restRoleKey, isLeader: isLeaderRestValue });
        });

        shift.breaks_schedule.sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    });

    return augmentedShifts;
}
