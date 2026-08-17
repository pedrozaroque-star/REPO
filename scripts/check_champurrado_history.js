const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: minDate } = await supabase
        .from('meat_consumption_history')
        .select('business_date')
        .eq('meat_type', 'CHAMPURRADO')
        .order('business_date', { ascending: true })
        .limit(1);

    const { data: maxDate } = await supabase
        .from('meat_consumption_history')
        .select('business_date')
        .eq('meat_type', 'CHAMPURRADO')
        .order('business_date', { ascending: false })
        .limit(1);

    console.log('CHAMPURRADO in meat_consumption_history range:', minDate?.[0]?.business_date, 'to', maxDate?.[0]?.business_date);

    // Check a sample from pmix_daily_cache to see how Champurrado items are stored inside `items` JSON
    const { data: pmixRow } = await supabase
        .from('pmix_daily_cache')
        .select('business_date, store_id, items')
        .not('items', 'is', null)
        .limit(5);

    if (pmixRow && pmixRow.length > 0) {
        pmixRow.forEach(row => {
            const keys = Object.keys(row.items || {});
            const champKeys = keys.filter(k => k.toLowerCase().includes('champurrado'));
            if (champKeys.length > 0) {
                console.log('Found Champurrado in PMIX:', row.business_date, champKeys, champKeys.map(k => row.items[k]));
            }
        });
    }
}

run();
