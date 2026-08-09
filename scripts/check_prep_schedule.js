const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- Checking prep_manual_schedule table for Friday (5) and Saturday (6) ---');
    const { data, error } = await supabase
        .from('prep_manual_schedule')
        .select('*')
        .in('day_of_week', [5, 6]);

    if (error) {
        console.error('ERROR querying prep_manual_schedule:', error);
    } else {
        console.log('Rows for Friday (5) & Saturday (6):', data?.length);
        console.log(data);
    }
}

run();
