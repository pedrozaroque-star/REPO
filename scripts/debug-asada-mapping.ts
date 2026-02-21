
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function debugAsadaMapping() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: mapping } = await supabase.from('quickbooks_mappings').select('*').eq('qb_item_name', 'Carne Asada').single();
    console.log('Mapeo:', JSON.stringify(mapping, null, 2));

    if (mapping?.inventory_item_id) {
        const { data: item } = await supabase.from('inventory_items').select('*').eq('id', mapping.inventory_item_id).single();
        console.log('Item de Inventario:', JSON.stringify(item, null, 2));
    }
}
debugAsadaMapping();
