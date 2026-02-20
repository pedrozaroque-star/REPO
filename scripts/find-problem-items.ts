
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function findItems() {
    const { data: items } = await supabase.from('inventory_items').select('*').or('name.ilike.%Foil%,name.ilike.%Aluminio%,name.ilike.%Lima%');
    console.table(items?.map(i => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        qty_per_unit: i.quantity_per_unit,
        price: i.purchase_unit_cost
    })));
}

findItems();
