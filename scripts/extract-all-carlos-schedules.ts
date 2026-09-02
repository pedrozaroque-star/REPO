import { supabaseAdmin } from '../lib/supabase';
import fs from 'fs';

async function main() {
    console.log('🔍 Extrayendo TODOS los turnos del Planificador para Carlos Velázquez (user_id: 25)...');

    // 1. Consultar en la tabla schedules (Planificador moderno) para Carlos (user_id: 25)
    const { data: schedulesCarlos, error: errSched } = await supabaseAdmin
        .from('schedules')
        .select('*, stores(*)')
        .eq('user_id', 25)
        .order('date', { ascending: true });

    console.log(`Total turnos encontrados en schedules para Carlos: ${schedulesCarlos?.length || 0}`);
    if (errSched) console.error('Error schedules:', errSched);

    // 2. Consultar también en la tabla shifts
    const { data: shiftsCarlos, error: errShifts } = await supabaseAdmin
        .from('shifts')
        .select('*, stores(*)')
        .order('shift_date', { ascending: true });

    console.log(`Total turnos encontrados en shifts: ${shiftsCarlos?.length || 0}`);

    // Map by date (YYYY-MM-DD)
    const masterShiftsMap: Record<string, { start: string; end: string; hours: number; store: string; label: string; role: string }> = {};

    // First load from schedules
    schedulesCarlos?.forEach(s => {
        // format start_time and end_time (e.g. '08:00:00' -> '8:00 AM')
        const formatT = (t: string) => {
            if (!t) return '';
            const [h, m] = t.split(':').map(Number);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
        };

        const startStr = formatT(s.start_time);
        const endStr = formatT(s.end_time);

        // calculate hours
        let [sh, sm] = s.start_time.split(':').map(Number);
        let [eh, em] = s.end_time.split(':').map(Number);
        let sDec = sh + sm / 60;
        let eDec = eh + em / 60;
        let diff = eDec - sDec;
        if (diff < 0) diff += 24;

        masterShiftsMap[s.date] = {
            start: startStr,
            end: endStr,
            hours: parseFloat(diff.toFixed(2)),
            store: s.stores?.name || 'Lynwood',
            label: s.shift_label || 'General Manager',
            role: s.role || 'manager'
        };
    });

    console.log('Turnos de Carlos para Septiembre 2026:');
    Object.keys(masterShiftsMap)
        .filter(d => d.startsWith('2026-09'))
        .forEach(d => console.log(`  ${d}: ${masterShiftsMap[d].start} - ${masterShiftsMap[d].end} (${masterShiftsMap[d].hours}h) - ${masterShiftsMap[d].label}`));

    // Also check what shifts exist for 2026-09-01 in schedules for all users
    const { data: sep1Schedules } = await supabaseAdmin
        .from('schedules')
        .select('*, users(*), stores(*)')
        .eq('date', '2026-09-01');
    console.log('Todos los schedules del 2026-09-01 en TODAS las tiendas:');
    sep1Schedules?.forEach(s => {
        console.log(`  Tienda ${s.stores?.name} (#${s.store_id}): ${s.users?.full_name} (${s.role}) - ${s.start_time} to ${s.end_time}`);
    });

    fs.writeFileSync('scripts/carlos_all_schedules_master.json', JSON.stringify(masterShiftsMap, null, 2), 'utf-8');
}

main().catch(console.error);
