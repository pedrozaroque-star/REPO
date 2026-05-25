import fs from 'fs';

let content = fs.readFileSync('app/descansos/page.tsx', 'utf-8');

const injection = `
    const handleBreakDragEnd = async (e: any, info: any, shift: Shift, breakIdx: number) => {
        const b = shift.breaks_schedule[breakIdx];
        const timelineEl = document.getElementById('timeline-header');
        if (!timelineEl) return;
        const totalPx = timelineEl.getBoundingClientRect().width;
        // Total minutes = TOTAL_HOURS * 60, here TOTAL_HOURS is 24
        const pxPerMinute = totalPx / (24 * 60);
        
        const offsetMins = Math.round(info.offset.x / pxPerMinute);
        if (Math.abs(offsetMins) < 5) return;
        
        const origStart = new Date(b.start_time).getTime();
        const durMs = new Date(b.end_time).getTime() - origStart;
        const newStartMs = origStart + (offsetMins * 60000);
        const newEndMs = newStartMs + durMs;
        
        const shiftStart = new Date(shift.start_time).getTime();
        const shiftEnd = new Date(shift.end_time).getTime();
        
        if (newStartMs < shiftStart || newEndMs > shiftEnd) {
            alert('El descanso no puede quedar fuera del horario del turno.');
            return;
        }

        const isMeal = b.type === 'meal_30';
        let warningMsgs = [];
        
        if (isMeal) {
            if (newStartMs > shiftStart + (5 * 3600000)) {
                warningMsgs.push('Meal Penalty Riesgo: El Lunch inicia después de la 5ta hora (Ley de CA).');
            }
        }
        
        const rk = ((shift.job_title || shift.job_id || 'unknown') as string).toLowerCase().trim();
        for (const otherShift of smartShifts) {
            if (otherShift.id === shift.id) continue;
            const otherRk = ((otherShift.job_title || otherShift.job_id || 'unknown') as string).toLowerCase().trim();
            if (rk === otherRk) {
                for (const otherB of otherShift.breaks_schedule || []) {
                    const os = new Date(otherB.start_time).getTime();
                    const oe = new Date(otherB.end_time).getTime();
                    const overlapMs = Math.max(0, Math.min(newEndMs, oe) - Math.max(newStartMs, os));
                    if (overlapMs > 0) {
                        warningMsgs.push(\`Superposición con \${otherShift.employee_name || 'otro empleado'} que tiene el mismo rol.\`);
                    }
                }
            }
        }

        if (warningMsgs.length > 0) {
            const proceed = window.confirm(\`ADVERTENCIA:\\n\\n- \${warningMsgs.join('\\n- ')}\\n\\n¿Estás seguro de que quieres moverlo aquí?\`);
            if (!proceed) return;
        }
        
        const newBreaks = [...shift.breaks_schedule];
        newBreaks[breakIdx] = {
            ...b,
            start_time: new Date(newStartMs).toISOString(),
            end_time: new Date(newEndMs).toISOString(),
            is_manual: true
        };
        
        setSmartShifts(prev => prev.map(s => s.id === shift.id ? { ...s, breaks_schedule: newBreaks } : s));
        
        try {
            const { getSupabaseClient } = await import('@/lib/supabase');
            const supabase = await getSupabaseClient();
            await supabase.from('shifts').update({ breaks_schedule: newBreaks }).eq('id', shift.id);
        } catch (err) {
            console.error('Failed to save manual break', err);
        }
    };
`;

content = content.replace('    useEffect(() => {', injection + '\n    useEffect(() => {');
fs.writeFileSync('app/descansos/page.tsx', content);
