
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkPollo() {
    console.log('Searching for Taco Pollo...');
    const { data: item } = await supabase
        .from('toast_menu_items')
        .select('name, guid')
        .ilike('name', 'Taco Pollo')
        .limit(1);

    if (item?.length) {
        const guid = item[0].guid;
        console.log(`Found ${item[0].name} (${guid})`);
        const { data: recipe } = await supabase
            .from('recipes')
            .select(`*, inv:inventory_items(*)`)
            .eq('toast_menu_item_guid', guid);

        if (recipe) {
            recipe.forEach(r => {
                const costPerUnit = r.inv.purchase_unit_cost / r.inv.quantity_per_unit;
                const yieldFactor = (r.inv.yield_percent || 100) / 100;
                let lbs = (r.unit.startsWith('oz') ? r.quantity / 16 : r.quantity);
                const lineCost = (lbs / yieldFactor) * costPerUnit;
                console.log(` - ${r.inv.name}: ${r.quantity} ${r.unit} (Yield: ${r.inv.yield_percent}%) -> $${lineCost.toFixed(4)}`);
            });
        }
    }
}

checkPollo();
