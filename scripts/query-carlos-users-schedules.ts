import { supabaseAdmin } from '../lib/supabase';

async function main() {
    console.log('🔍 Consultando usuarios en users table y schedules para Carlos...');

    // 1. Consultar users
    const { data: users } = await supabaseAdmin
        .from('users')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%,email.ilike.%carlos%');
    console.log('Usuarios en users:', users);

    // 2. Consultar schedules para los user_id de Carlos o de Lynwood (store_id: 14)
    const { data: schedulesLynwood } = await supabaseAdmin
        .from('schedules')
        .select('*, users(*)')
        .eq('store_id', 14)
        .gte('date', '2026-09-01')
        .lte('date', '2026-09-07')
        .order('date', { ascending: true });

    console.log('Schedules en Lynwood (store 14):', schedulesLynwood);

    // 3. Consultar todos los schedules de Carlos en cualquier tienda
    if (users && users.length > 0) {
        const userIds = users.map(u => u.id);
        const { data: schedulesCarlos } = await supabaseAdmin
            .from('schedules')
            .select('*, stores(*)')
            .in('user_id', userIds)
            .gte('date', '2026-09-01')
            .lte('date', '2026-09-07')
            .order('date', { ascending: true });
        console.log('Schedules de Carlos en todas las tiendas:', schedulesCarlos);
    }
}

main().catch(console.error);
