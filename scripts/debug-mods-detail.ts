
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { calculateRecipeCost } = require('../lib/inventory/costs');

async function findPlateModifiersDetailed() {
    const { data: items } = await supabase.from('inventory_items').select('*').or('name.ilike.%Onion%,name.ilike.%Salsa%,name.ilike.%Lima%,name.ilike.%Jalape%');
    console.table(items?.map(i => ({ name: i.name, cost: i.purchase_unit_cost, qty: i.quantity_per_unit, unit: i.unit_measure })));

    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`);
    const invItems = recipes?.map(r => r.inv) || [];
    const guidMap = new Map();
    recipes?.forEach(r => {
        if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
        guidMap.get(r.toast_menu_item_guid).push(r);
    });

    console.log("\nSEARCHING FOR MODIFIER RECIPES:");
    for (const [guid, ingredients] of guidMap.entries()) {
        const costResult = calculateRecipeCost({ ingredients } as any, invItems as any);
        // I want to see if any of these match the components of the plate
        // e.g. Salsa, Limes, etc.
        const names = costResult.breakdown.map(b => b.itemName).join(', ');
        if (names.includes('Salsa') || names.includes('Onion') || names.includes('Lima') || names.includes('Jalape')) {
            if (costResult.totalCost < 5) { // Small costs
                console.log(`GUID: ${guid} - Cost: $${costResult.totalCost.toFixed(4)} - Ingredients: ${names}`);
            }
        }
    }
}

findPlateModifiersDetailed();
