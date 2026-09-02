import { supabaseAdmin } from '../lib/supabase';

async function main() {
    console.log('🔍 Buscando a Carlos Velázquez en la base de datos de empleados y tiendas...');

    // 1. Buscar en stores (Lynwood)
    const { data: stores } = await supabaseAdmin.from('stores').select('*').ilike('name', '%lynwood%');
    console.log('Tienda Lynwood:', stores);

    const lynwoodStoreId = stores?.[0]?.id;

    // 2. Buscar a Carlos en employees
    const { data: employees } = await supabaseAdmin
        .from('employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%,first_name.ilike.%velasquez%');
    console.log('Empleados encontrados:', employees);

    // 3. Buscar todos los shifts de septiembre 2026 en Lynwood o de Carlos
    const { data: shifts, error: shiftsErr } = await supabaseAdmin
        .from('shifts')
        .select('*, employees(*), stores(*)')
        .gte('date', '2026-09-01')
        .lte('date', '2026-09-07')
        .order('date', { ascending: true });

    console.log('Shifts de Septiembre (1-7):', shifts);
    if (shiftsErr) console.error('Error al consultar shifts:', shiftsErr);

    // 4. Buscar también en schedule_templates o shift_assignments o tablas similares
    const { data: allTables } = await supabaseAdmin
        .from('shifts')
        .select('date, start_time, end_time, employee_id, store_id')
        .eq('date', '2026-09-01');
    console.log('Todos los shifts del 2026-09-01:', allTables);
}

main().catch(console.error);
