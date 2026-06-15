import { supabaseAdmin } from '../lib/supabase';

async function checkPositionActivities() {
    console.log('Querying position_activities...');
    try {
        const { data, error } = await supabaseAdmin
            .from('position_activities')
            .select(`
                *,
                operating_procedures (
                    id,
                    activity,
                    shift_type,
                    start_time
                )
            `)
            .limit(50);

        if (error) {
            console.error('❌ Error:', error.message);
        } else {
            console.log('✅ Retreived', data?.length, 'mappings');
            console.log('Sample mappings:');
            console.log(JSON.stringify(data?.slice(0, 10), null, 2));
        }
    } catch (e) {
        console.error('Unexpected error:', e);
    }
}

checkPositionActivities();
