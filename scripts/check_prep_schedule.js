const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- Checking prep_manual_schedule table ---');
    const { data, error } = await supabase
        .from('prep_manual_schedule')
        .select('*');

    if (error) {
        console.error('ERROR querying prep_manual_schedule:', error);
    } else {
        console.log('SUCCESS! Total rows found:', data?.length);
        console.log('Sample rows:', data);
    }

    console.log('\n--- Checking stores table ---');
    const { data: stores, error: storeErr } = await supabase
        .from('stores')
        .select('id, name')
        .order('id');
    
    console.log('Stores:', stores);
}

run();
