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

    // California Law — Rest Breaks (10 min PAID):
    // "10 minutes per 4 hours or MAJOR FRACTION thereof"
    // "Major fraction" = MORE THAN half of 4 hours = MORE THAN 2 hours (> 2.0, NOT >= 2.0)
    //
    // DLSE Interpretation (confirmed by multiple CA employment law sources):
    //   3.5 – 6.0 hrs:  1 rest  (first 4hrs or its major fraction ≥ 3.5)
    //   > 6.0 – 10.0 hrs: 2 rests (remaining after 4hrs is > 2.0 = major fraction)
    //   > 10.0 – 14.0 hrs: 3 rests (remaining after 8hrs is > 2.0 = major fraction)
    //
    // KEY: At EXACTLY 6.0 hrs → 4hrs + 2.0 remaining. 2.0 is NOT > 2.0 → still 1 rest.
    //      At EXACTLY 10.0 hrs → 8hrs + 2.0 remaining. 2.0 is NOT > 2.0 → still 2 rests.
    //
    // Meal Break (30m, UNPAID):
    //   > 5h: 1 meal (must START before end of 5th hour)
    //   >= 12h: 2 meals (2nd mandatory — below 12h the 2nd meal is optional/waived)

    if (durationHours > 10) {
        breaks.push({ type: 'rest_10' }, { type: 'rest_10' }, { type: 'rest_10' });
    } else if (durationHours > 6) {
        breaks.push({ type: 'rest_10' }, { type: 'rest_10' });
    } else if (durationHours >= 3.5) {
        breaks.push({ type: 'rest_10' });
    }

    if (durationHours > 5) {
        breaks.push({ type: 'meal_30' });
    }
    // REGLA OPERATIVA: El segundo lunch es OPCIONAL entre 10-12 horas (el empleado puede renunciar a él).
    // Solo es OBLIGATORIO cuando el turno excede las 12 horas.
    if (durationHours >= 12) {
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
        // REGLA: Para turnos con 2+ breaks, la separación mínima entre descansos personales es 1.5 horas.
        // Esto evita que un empleado tome un Rest a las 3:00 PM y otro a las 3:45 PM (inútil operativamente).
        const MIN_GAP_MS = 90 * 60 * 1000; // 1 hora 30 minutos
        
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
            
            // EXTREME RULE: Absolute Ban on RUSH/PICO/MAX zones.
            // If intensity is >= 0.75 (RUSH, PICO or MAX), the slot is completely unavailable.
            // Only Panic Mode (legal compliance fallback) can override this.
            if (salesScore >= 0.75) {
                continue; 
            }

            // ═══════════════════════════════════════════════════════════════════
            // OVERLAP RULES — Reglas estrictas del usuario
            // ═══════════════════════════════════════════════════════════════════
            // SIEMPRE (cualquier intensidad):
            //   • MISMO PUESTO (cashier+cashier, cook+cook): CERO empalme.
            //   • LÍDER vs CUALQUIERA: CERO empalme.
            //
            // DURANTE RUSH/PICO/MAX (salesScore >= 0.75):
            //   • CUALQUIER PUESTO vs CUALQUIER PUESTO: CERO empalme.
            //   • "Uno por uno" — el restaurante necesita a todos en piso.
            //
            // DURANTE VALLE/MODERADO (salesScore < 0.75):
            //   • Tropa diferente (cashier+cook): SIN restricción.
            //   • Operan en estaciones aisladas (FOH vs BOH).
            // ═══════════════════════════════════════════════════════════════════
            const isRushHour = salesScore >= 0.75;
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

            const peakPenalty = Math.pow(salesScore, 8) * 50_000_000;

            // ═══════════════════════════════════════════════════════════════════
            // Los líderes (asistentes/shift leaders) reciben un magneto MASIVO 
            // hacia el inicio de su ventana, para "dar el ejemplo" y evacuar
            // antes de que comience el pico. 
            let leaderEarlyPenalty = 0;
            if (isMeal && isManagerOrLeader) {
                // 1. Determinar el contexto del turno para no mezclar picos AM con PM
                const shiftStartHour = new Date(shift.start_time).getHours();
                let peakHourForShift = 12;
                let maxIntensity = 0;
                
                if (shiftStartHour < 15) { // Turno AM (entran antes de 3 PM)
                    hourScores.forEach((score, h) => {
                        if (h >= 6 && h <= 15) { 
                            if (score > maxIntensity) { maxIntensity = score; peakHourForShift = h; } 
                        }
                    });
                } else { // Turno PM (entran 3 PM o después)
                    hourScores.forEach((score, h) => {
                        if (h >= 16 || h <= 3) { 
                            const adjustedH = h <= 3 ? h + 24 : h;
                            if (score > maxIntensity) { maxIntensity = score; peakHourForShift = adjustedH; } 
                        }
                    });
                }

                // 2. Determinar si los lunches DEBEN iniciar antes del Pico
                let wStartHour = windowStart.getHours();
                if (wStartHour <= 3) wStartHour += 24; // normalizar madrugada
                
                let wEndHour = windowEnd.getHours();
                if (wEndHour <= 3) wEndHour += 24;
                if (wEndHour < wStartHour) wEndHour = wStartHour + 3.9; // Fallback caja seguridad
                
                const midPoint = wStartHour + (wEndHour - wStartHour) / 2;

                // REGLA: "en el turno de las 5pm si el maximo rush es antes de las 8pm, pueden iniciar todos desde las 8pm"
                // Esto significa: Si la hora Pico del turno cae DESPUÉS del midpoint de su ventana,
                // la única salida es irse a comer TEMPRANO (antes del pico), por tanto, Magneto ON para que el líder vaya primero.
                // Si el pico cae ANTES del midpoint, significa que "pueden aguantar" y mandarlos a todos después del pico (Magneto OFF).
                if (peakHourForShift >= midPoint) {
                    const hoursSinceStart = (bStart.getTime() - new Date(shift.start_time).getTime()) / 3600000;
                    leaderEarlyPenalty = hoursSinceStart * 100_000_000;
                }
            }

            const score = peakPenalty + leaderEarlyPenalty;

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
            
            // CRITICAL FIX: No matter what, you absolutely cannot schedule a break past the end of the shift!
            // Allow the fallback to push outside its 'preferred' window slice to maintain the 60-min gap, 
            // but NEVER allow it to exceed the physical end of the employee's shift.
            const shiftEnd = new Date(shift.end_time).getTime();
            const maxAllowedFallback = shiftEnd - DURATION_MS;
            if (fallbackStart.getTime() > maxAllowedFallback) {
                fallbackStart = new Date(maxAllowedFallback);
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
            // California Law enforced explicitly by user rules: The meal must **START** before the end of the 5th hour.
            // In findBestSlot, the loop limits the start time to `windowEnd - DURATION_MS`. 
            // So if we want the actual START time limit to be 4.95 hours, we must set windowEnd to 4.95 + 0.5 = 5.45.
            const mealDeadlineHourOffset = mealIndex === 0 ? 5.49 : 10.49;
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

        restsToSchedule.forEach((rest, restIndex) => {
            let windowStart: Date;
            let windowEnd: Date;
            
            // Lógica Especial para 10+ horas (Doble Meal, Triple Rest) -> Fix para Alexander
            // ═══════════════════════════════════════════════════════════════════
            // NUEVO SISTEMA DISTRIBUIDO: Evita el efecto Acordeón.
            // Para asegurar máxima flexibilidad ante Meals erráticos (Leader Magneto),
            // distribuimos los Rests equitativamente a lo largo de TODO el turno.
            // La IA con su MIN_GAP de 60 mins tejerá naturalmente los descansos
            // alrededor de la curva de ventas y los Meals que ya estén puestos.
            // ═══════════════════════════════════════════════════════════════════
            const shiftDurationHours = (end.getTime() - start.getTime()) / 3600000;
            const fraction = (restIndex + 1) / (restsToSchedule.length + 1);
            const idealOffset = shiftDurationHours * fraction;

            // Damos una ventana amplia (± 1.5 horas = 3 horas total) para que la IA escápela del PICO
            windowStart = new Date(start.getTime() + (idealOffset - 1.5) * 3600000);
            windowEnd = new Date(start.getTime() + (idealOffset + 1.5) * 3600000);
            // REGLA: "pueden tomar break hasta 30 minutos antes de salir si el turno está muy apretado"
            // Expandimos la ventana hasta shiftEnd - 30min para que en turnos congestionados
            // la IA pueda empujar un Rest casi al final. El clamp de seguridad del fallback
            // garantiza que nunca se pase del turno físico.
            const maxRestEnd = new Date(end.getTime() - 30 * 60000); // 30 min antes de salir
            if (windowEnd > maxRestEnd) windowEnd = maxRestEnd;
            if (windowEnd > end) windowEnd = end;
            
            // STRICT RULE: No break can start before 1.0 hours worked.
            const minAllowedStart = new Date(start.getTime() + 1.0 * 3600000);
            if (windowStart < minAllowedStart) {
                windowStart = minAllowedStart;
            }
            // Asegurarnos de no sobrepasar el límite de la ventana
            if (windowStart >= windowEnd) {
                 windowStart = new Date(windowEnd.getTime() - 15 * 60000); // Dar al menos 15 min de respiro si quedó apachurrado
                 if (windowStart < minAllowedStart) windowStart = minAllowedStart;
            }

            const bestSlotStart = findBestSlot(windowStart, windowEnd, 10, true, shift.breaks_schedule, false, shift);
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
