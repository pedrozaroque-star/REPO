require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const {data, error} = await s.from('quickbooks_mappings').insert({
        qb_item_id: '541',
        qb_item_name: '358-9673BT  13" Flour Tortilla',
        inventory_item_id: '55798c3c-a86e-469d-ab70-24e0f1af0c2b',
        last_fetch_cost: 2.7,
        updated_at: new Date().toISOString()
    }).select();
    
    if (error) console.log('Error:', error.message);
    else console.log('Mapping created:', JSON.stringify(data, null, 2));
})();
