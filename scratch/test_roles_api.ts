import { supabaseAdmin } from '../lib/supabase';

async function testRolesAPI() {
    console.log('Testing GET query from /api/roles...');
    const store_id = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'; // Slauson
    const start_date = '2026-06-01';
    const end_date = '2026-06-07';

    try {
        const { data, error } = await supabaseAdmin
            .from('station_assignments')
            .select(`
                *,
                toast_employees (
                    id,
                    first_name,
                    last_name
                )
            `)
            .eq('store_id', store_id)
            .gte('assignment_date', start_date)
            .lte('assignment_date', end_date);

        if (error) {
            console.error('❌ Query failed:', error.message);
            console.error(error);
        } else {
            console.log('✅ Query successful! Retrieved', data?.length, 'assignments');
            console.log('First assignment sample:', JSON.stringify(data?.[0], null, 2));
        }
    } catch (err) {
        console.error('❌ Unexpected error:', err);
    }
}

testRolesAPI();
