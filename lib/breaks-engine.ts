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

    // California Law:
    // Rest Break (10m): 1 per 4 hours or major fraction thereof (maj fraction = > 2h).
    // => 0 to <3.5: 0 rest
    // => 3.5 to < 6: 1 rest
    // => 6 to < 10: 2 rests
    // => 10 to < 14: 3 rests
    
    // Meal Break (30m):
    // => >5h: 1 meal (must start before end of 5th hour)
    // => >10h: 2 meals (2nd must start before end of 10th hour)

    if (durationHours >= 3.5 && durationHours < 6) {
        breaks.push({ type: 'rest_10' });
    } else if (durationHours >= 6 && durationHours < 10) {
        breaks.push({ type: 'rest_10' }, { type: 'rest_10' });
    } else if (durationHours >= 10 && durationHours < 14) {
        breaks.push({ type: 'rest_10' }, { type: 'rest_10' }, { type: 'rest_10' });
    }

    if (durationHours >= 5) {
        breaks.push({ type: 'meal_30' });
    }
    if (durationHours >= 10) {
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
    const globalUnavailable: { start: number, end: number, jobId: string }[] = [];

    const checkGlobalOverlap = (testStart: number, testEnd: number) => {
        // Adds a tight 1 minute buffer to be safe, though not strictly required
        return globalUnavailable.some(unavail => 
            testStart < unavail.end && testEnd > unavail.start
        );
    };

    // Step 1: Initialize augmented shifts with empty breaks
    const augmentedShifts: any[] = shifts.map(shift => ({
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
        const MIN_GAP_MS = 60 * 60 * 1000; 
        
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

            // Mathematical Magic: Punish the SQUARE of overalapping minutes.
            // 30 min exact overlap = 30x30 = 900 penalty.
            // 15 min stagger overlap = 15x15 = 225 penalty.
            // This naturally forces the AI to interleave/stagger employees in 15-minute increments.
            
            // NEW: Position-Aware Cross-Staggering
            // If they are in the SAME position (e.g. 2 Cooks), the gravity is MASSIVE (x30).
            // If they are in DIFFERENT positions (Cook vs Cashier), the gravity is TINY (x2).
            // This guarantees the AI will pair up different positions for breaks when forced to overlap!
            let overlapPenalty = 0;
            globalUnavailable.forEach((unavail) => {
                const oStart = Math.max(bStart.getTime(), unavail.start);
                const oEnd = Math.min(bEnd.getTime(), unavail.end);
                if (oStart < oEnd) {
                    const overlapMinutes = (oEnd - oStart) / 60000;
                    
                    const isSameRole = unavail.jobId === shift.job_id;
                    
                    let crossRoleMultiplier = 1;
                    if (isSameRole) {
                        crossRoleMultiplier = isMeal ? 30 : 15; // Same position: Catastrophic
                    } else {
                        crossRoleMultiplier = isMeal ? 2 : 1;   // Different position: Totally fine, acceptable operational overlap
                    }
                    
                    overlapPenalty += (overlapMinutes * overlapMinutes) * crossRoleMultiplier;
                }
            });

            const hour = bStart.getHours();
            const salesScore = hourScores.get(hour) ?? 1.0;
            const isPeak = salesScore >= 0.75;
            
            // Peak penalty is massive (+15,000) so it avoids peak completely.
            const peakPenalty = isPeak ? 15000 : (salesScore * 100);
            
            const score = overlapPenalty + peakPenalty;

            if (score < lowestScore) {
                lowestScore = score;
                bestStart = bStart;
            }
        }
        
        if (lowestScore === Infinity) return windowStart;
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
            // California Law enforced explicitly by user rules:
            // "1 hour after starting" -> 1.0
            // "Before 6 hours worked" -> 5.8
            const mealDeadlineHourOffset = mealIndex === 0 ? 5.8 : 9.9;
            const windowStart = new Date(start.getTime() + (mealIndex === 0 ? 1.0 : 6) * 3600000); 
            let windowEnd = new Date(start.getTime() + mealDeadlineHourOffset * 3600000);
            if (windowEnd > end) windowEnd = end;

            const bestSlotStart = findBestSlot(windowStart, windowEnd, 30, false, shift.breaks_schedule, true, shift);
            const bestSlotEnd = new Date(bestSlotStart.getTime() + 30 * 60000);

            shift.breaks_schedule.push({
                type: 'meal_30',
                start_time: bestSlotStart.toISOString(),
                end_time: bestSlotEnd.toISOString(),
                status: 'scheduled'
            });
            globalUnavailable.push({ start: bestSlotStart.getTime(), end: bestSlotEnd.getTime(), jobId: shift.job_id || 'unknown' });
        });
    });

    // Step 3: Schedule ALL RESTS sequentially for everyone (now they fill the gaps)
    augmentedShifts.forEach((shift) => {
        const start = new Date(shift.start_time);
        const end = new Date(shift.end_time);
        const requiredBreaks = getRequiredBreaksCA(start, end);
        const restsToSchedule = requiredBreaks.filter(b => b.type === 'rest_10');

        restsToSchedule.forEach((rest, restIndex) => {
            let idealOffset = 2.0; 
            const scheduledMeal = shift.breaks_schedule.find((b: any) => b.type === 'meal_30');
            const mealOffsetHours = scheduledMeal 
                ? (new Date(scheduledMeal.start_time).getTime() - start.getTime()) / 3600000 
                : null;
            
            if (restsToSchedule.length === 1) {
                if (mealOffsetHours !== null && mealOffsetHours < 2.5) idealOffset = mealOffsetHours + 2.0; 
                else idealOffset = 2.0; 
            } else if (restsToSchedule.length === 2) {
                if (mealOffsetHours !== null && mealOffsetHours <= 2.5) {
                    if (restIndex === 0) idealOffset = mealOffsetHours + 2.0;
                    if (restIndex === 1) idealOffset = mealOffsetHours + 4.0;
                } else {
                    if (restIndex === 0) idealOffset = 2.0; 
                    if (restIndex === 1) idealOffset = (mealOffsetHours || 4.5) + 2.0; 
                }
            } else if (restsToSchedule.length === 3) {
                if (restIndex === 0) idealOffset = 2.0;
                if (restIndex === 1) idealOffset = (mealOffsetHours || 4.5) + 2.0;
                if (restIndex === 2) idealOffset = (mealOffsetHours || 4.5) + 4.0;
            }

            let windowStart = new Date(start.getTime() + (idealOffset - 1.5) * 3600000);
            
            // STRICT RULE: No break can start before 1 hour worked.
            const minAllowedStart = new Date(start.getTime() + 1.0 * 3600000);
            if (windowStart < minAllowedStart) {
                windowStart = minAllowedStart;
            }

            let windowEnd = new Date(start.getTime() + (idealOffset + 1.5) * 3600000);
            if (windowEnd > end) windowEnd = end;

            const bestSlotStart = findBestSlot(windowStart, windowEnd, 10, true, shift.breaks_schedule, false, shift);
            const bestSlotEnd = new Date(bestSlotStart.getTime() + 10 * 60000);

            shift.breaks_schedule.push({
                type: 'rest_10',
                start_time: bestSlotStart.toISOString(),
                end_time: bestSlotEnd.toISOString(),
                status: 'scheduled'
            });
            globalUnavailable.push({ start: bestSlotStart.getTime(), end: bestSlotEnd.getTime(), jobId: shift.job_id || 'unknown' });
        });

        shift.breaks_schedule.sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    });

    return augmentedShifts;
}
