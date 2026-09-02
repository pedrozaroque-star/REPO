import { supabaseAdmin } from '../lib/supabase';

const CARLOS_LYNWOOD_EMP_ID = '42deef34-31ed-441e-ba89-3531b78fd1d9';

async function main() {
    console.log('🔍 Consultando turnos reales de Carlos en Lynwood para Septiembre 2026...');

    // 1. Consultar por CARLOS_LYNWOOD_EMP_ID para septiembre 2026
    const { data: shiftsCarlos, error: err1 } = await supabaseAdmin
        .from('shifts')
        .select('*')
        .eq('employee_id', CARLOS_LYNWOOD_EMP_ID)
        .gte('shift_date', '2026-09-01')
        .lte('shift_date', '2026-09-30')
        .order('shift_date', { ascending: true });

    console.log('Turnos de Carlos (por ID):', shiftsCarlos);
    if (err1) console.error('Error 1:', err1);

    // 2. Buscar si hay otros IDs de Carlos en toast_employees
    const { data: toastEmps } = await supabaseAdmin
        .from('toast_employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%,first_name.ilike.%velasquez%');
    console.log('Toast Employees coincidentes con Carlos:', toastEmps);

    // 3. Consultar todos los turnos de la tienda 14 (Lynwood) del 1 al 7 de septiembre
    const { data: lynwoodShifts } = await supabaseAdmin
        .from('shifts')
        .select('*, toast_employees(*)')
        .eq('store_id', 14)
        .gte('shift_date', '2026-09-01')
        .lte('shift_date', '2026-09-07')
        .order('shift_date', { ascending: true });

    console.log('Turnos en Lynwood (1-7 Sep):', lynwoodShifts?.map(s => ({
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        emp_name: `${s.toast_employees?.first_name} ${s.toast_employees?.last_name}`,
        job: s.job_title || s.role
    })));

    // 4. Consultar también en la tabla schedules si existe
    const { data: schedules } = await supabaseAdmin
        .from('schedules')
        .select('*')
        .gte('date', '2026-09-01')
        .limit(10);
    console.log('Tabla schedules:', schedules);
}

main().catch(console.error);
