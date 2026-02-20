
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function verifyFoodOnly() {
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

    console.log('--- FOOD ONLY COST ANALYSIS ---');
    let grandTotal = 0;

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
                let itemFoodCost = 0;
                recipe.forEach(r => {
                    const isPackaging = /box|container|bag|lid|dome|plastic|cup|plate|fork|napkin/i.test(r.inv.name);
                    if (!isPackaging) {
                        const pricePerUnit = r.inv.purchase_unit_cost / r.inv.quantity_per_unit;
                        const yieldFactor = (r.inv.yield_percent || 100) / 100;
                        let lbs = (r.unit.startsWith('oz') ? r.quantity / 16 : r.quantity);
                        const line = (lbs / yieldFactor) * pricePerUnit;
                        itemFoodCost += line;
                    }
                });

                const multiplier = (name === 'Taco Pollo') ? 3 : 1;
                const lineTotal = itemFoodCost * multiplier;
                grandTotal += lineTotal;

                console.log(`${item[0].name} (x${multiplier}): $${itemFoodCost.toFixed(4)} ea -> $${lineTotal.toFixed(4)}`);
            }
        }
    }

    console.log('-----------------------------------');
    console.log(`GRAND TOTAL FOOD ONLY: $${grandTotal.toFixed(2)}`);
}

verifyFoodOnly();
