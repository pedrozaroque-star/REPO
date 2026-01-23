import { useMemo } from 'react'
import { Shift, Employee, Job } from '../lib/types'

export function useWeeklyStats(shifts: Shift[], employees: Employee[], jobs: Job[]) {
    // We calculate all stats once per render to avoid heavy computation in loops
    const weeklyStats = useMemo(() => {
        const stats: Record<string, any> = {}; // empId -> totals
        const shiftStats: Record<string, any> = {}; // shiftId -> { dailyOT, weeklyOT, duration, cost, isOvertime }

        // Helper purely for local use inside memo
        const calcDuration = (s: Shift) => {
            if (!s.start_time || !s.end_time) return 0;
            const start = new Date(s.start_time);
            const end = new Date(s.end_time);
            let rawDuration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

            // Si el fin es menor que el inicio, asumimos que cruzó la medianoche (ej: 5pm - 2am)
            if (rawDuration < 0) rawDuration += 24;

            // CA Meal Break: required after 5 hours
            return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration);
        }

        // Banker's Rounding (Round Half to Even)
        const bankersRound = (num: number) => {
            const n = num * 100;
            const i = Math.round(n);
            const remainder = Math.abs(n) % 1;
            if (Math.abs(remainder - 0.5) < 0.0000001) {
                const floor = Math.floor(n);
                return (floor % 2 === 0 ? floor : floor + 1) / 100;
            }
            return Math.round(n) / 100;
        }

        employees.forEach(emp => {
            const empShifts = shifts.filter(s => s.employee_id === emp.id);
            // Sort by start time for correct weekly accumulation
            const sorted = [...empShifts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

            let totalHours = 0;
            let totalWage = 0;
            let totalOT = 0;
            let regularHoursAccumulator = 0;

            // Para acumular horas por jornada diaria (shift_date)
            let dailyHoursAccumulator = 0;
            let lastShiftDate = "";

            sorted.forEach(s => {
                const duration = calcDuration(s);

                // Si cambiamos de fecha de turno (shift_date), reseteamos el acumulador diario
                if (s.shift_date !== lastShiftDate) {
                    dailyHoursAccumulator = 0;
                    lastShiftDate = s.shift_date;
                }

                // --- 1. DAILY OT (Acumulado por jornada) ---
                let dailyOT = 0;
                const hoursBeforeThisShift = dailyHoursAccumulator;
                dailyHoursAccumulator += duration;

                if (hoursBeforeThisShift >= 8) {
                    // Ya estábamos en OT desde el principio de este turno
                    dailyOT = duration;
                } else if (hoursBeforeThisShift + duration > 8) {
                    // Este turno cruza el límite de las 8 horas
                    dailyOT = (hoursBeforeThisShift + duration) - 8;
                }
                const dailyRegular = duration - dailyOT;

                // --- 2. WEEKLY OT (Acumulado semanal) ---
                let weeklyOT = 0;
                // Las horas que ya son Daily OT no cuentan para el acumulador semanal regular (según CA law)
                if (regularHoursAccumulator >= 40) {
                    weeklyOT = dailyRegular;
                } else if (regularHoursAccumulator + dailyRegular > 40) {
                    weeklyOT = (regularHoursAccumulator + dailyRegular) - 40;
                }

                // Actualizar acumulador semanal (solo con horas que no son de ningún tipo de OT)
                regularHoursAccumulator += (dailyRegular - weeklyOT);

                // Wage Lookup
                let rate = 16.00;
                if (emp.wage_data && Array.isArray(emp.wage_data)) {
                    const wEntry = emp.wage_data.find((w: any) => {
                        const j = jobs.find(job => job.id === s.job_id);
                        return j && (w.job_guid === j.guid || w.job_guid === j.id);
                    });
                    if (wEntry) rate = wEntry.wage;
                    else if (emp.wage_data.length > 0) rate = emp.wage_data[0].wage;
                }

                const totalShiftOT = dailyOT + weeklyOT;
                const regularPaid = duration - totalShiftOT;
                const cost = (regularPaid * rate) + (totalShiftOT * rate * 1.5);
                const roundedCost = bankersRound(cost);

                shiftStats[s.id] = {
                    duration,
                    dailyOT,
                    weeklyOT,
                    totalOT: totalShiftOT,
                    cost: roundedCost,
                    isOvertime: totalShiftOT > 0
                };

                totalHours += duration;
                totalWage += roundedCost;
                totalOT += totalShiftOT;
            });

            stats[emp.id] = { totalHours, totalWage, totalOT };
        });

        return { stats, shiftStats };
    }, [shifts, employees, jobs]);

    return weeklyStats;
}
