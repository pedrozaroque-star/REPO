import { supabaseAdmin } from '../lib/supabase';
import fs from 'fs';

async function main() {
    console.log('🔄 Sincronizando TODOS los turnos reales de Carlos en Lynwood desde Supabase...');

    // 1. Obtener de schedules (Planificador moderno)
    const { data: schedulesCarlos } = await supabaseAdmin
        .from('schedules')
        .select('*, stores(*)')
        .eq('user_id', 25)
        .order('date', { ascending: true });

    // 2. Cargar archivo existente
    let existingShifts: Record<string, any> = {};
    try {
        existingShifts = JSON.parse(fs.readFileSync('scripts/carlos_planner_shifts_by_date.json', 'utf-8'));
    } catch (e) {
        existingShifts = {};
    }

    const formatT = (t: string) => {
        if (!t) return '';
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    };

    schedulesCarlos?.forEach(s => {
        const startStr = formatT(s.start_time);
        const endStr = formatT(s.end_time);

        let [sh, sm] = s.start_time.split(':').map(Number);
        let [eh, em] = s.end_time.split(':').map(Number);
        let sDec = sh + sm / 60;
        let eDec = eh + em / 60;
        let diff = eDec - sDec;
        if (diff < 0) diff += 24;

        existingShifts[s.date] = {
            start: startStr,
            end: endStr,
            hours: parseFloat(diff.toFixed(2)),
            label: s.shift_label || 'General Manager',
            store: s.stores?.name || 'Lynwood'
        };
    });

    fs.writeFileSync('scripts/carlos_planner_shifts_by_date.json', JSON.stringify(existingShifts, null, 2), 'utf-8');
    console.log(`✅ ${Object.keys(existingShifts).length} turnos sincronizados en scripts/carlos_planner_shifts_by_date.json`);

    // Let's print September shifts
    console.log('Turnos de Septiembre 2026:');
    Object.keys(existingShifts)
        .filter(d => d.startsWith('2026-09'))
        .forEach(d => {
            console.log(`  ${d}: ${existingShifts[d].start} - ${existingShifts[d].end} (${existingShifts[d].hours}h)`);
        });
}

main().catch(console.error);
