
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function deepCheckTacoPlate() {
    const guid = 'e5bb7d3e-2a4c-4293-86a8-6b2ccae940ad';
    console.log(`Deep check for ${guid}`);
    const { data: recipe } = await supabase
        .from('recipes')
        .select(`*, inv:inventory_items(*)`)
        .eq('toast_menu_item_guid', guid);

    if (recipe) {
        recipe.forEach(r => {
            const cost = (r.inv.purchase_unit_cost / r.inv.quantity_per_unit) * (r.unit.startsWith('oz') ? r.quantity / 16 : r.quantity);
            console.log(` - ${r.inv.name}: ${r.quantity} ${r.unit} ($${cost.toFixed(4)})`);
        });
    }
}

deepCheckTacoPlate();
