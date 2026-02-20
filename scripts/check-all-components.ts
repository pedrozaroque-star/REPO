
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkAllPossibleReceipts() {
    const names = [
        'Taco Plate',
        'Taco Pollo',
        'Limes',
        'Salsa Roja',
        'Pickled Jalapeños',
        'Salsa Verde',
        'Extra Carne 1.5 oz',
        'Jack Cheese'
    ];

    for (const name of names) {
        const { data: item } = await supabase
            .from('toast_menu_items')
            .select('name, guid')
            .ilike('name', `%${name}%`)
            .limit(1);

        if (item?.length) {
            const guid = item[0].guid;
            const { data: recipe } = await supabase
                .from('recipes')
                .select(`*, inv:inventory_items(*)`)
                .eq('toast_menu_item_guid', guid);

            if (recipe?.length) {
                let cost = 0;
                recipe.forEach(r => {
                    const pricePerUnit = r.inv.purchase_unit_cost / r.inv.quantity_per_unit;
                    const yieldFactor = (r.inv.yield_percent || 100) / 100;
                    let lbs = (r.unit.startsWith('oz') ? r.quantity / 16 : r.quantity);
                    const line = (lbs / yieldFactor) * pricePerUnit;
                    cost += line;
                });
                console.log(`${item[0].name}: $${cost.toFixed(4)}`);
            } else {
                console.log(`${item[0].name}: NO RECIPE`);
            }
        }
    }
}

checkAllPossibleReceipts();
