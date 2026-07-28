import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('id, name, order_unit_description, unit_measure, quantity_per_unit')
        .ilike('name', '%papelito%');
        
    console.log('Items matching "papelito":', items);
    if (error) console.error(error);
}
check();
