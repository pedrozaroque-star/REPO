
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { calculateRecipeCost } = require('../lib/inventory/costs');

async function findExtraCarneCost() {
    // Search for "Extra Carne" and "Pollo"
    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`);
    const invItems = recipes?.map(r => r.inv) || [];
    const guidMap = new Map();
    recipes?.forEach(r => {
        if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
        guidMap.get(r.toast_menu_item_guid).push(r);
    });

    console.log("--- BUSCANDO COSTO DE EXTRA CARNE DE POLLO ---");

    // We'll search for recipes that use "Pollo" or "Extra" in their context if we can guess the GUID
    // Actually, I'll just look for any recipe that looks like "Extra Carne" (1.5 oz)

    for (const [guid, ingredients] of guidMap.entries()) {
        const costResult = calculateRecipeCost({ ingredients } as any, invItems as any);

        const hasPollo = costResult.breakdown.some(b => b.itemName.toLowerCase().includes('pollo'));
        const isExtraQty = costResult.breakdown.some(b => b.quantity === 1.5 || b.quantity === 0.09375); // 1.5 oz = 0.09375 lb

        if (hasPollo && isExtraQty) {
            console.log(`\nPOSIBLE EXTRA CARNE POLLO (GUID: ${guid})`);
            console.log(`COSTO TOTAL: $${costResult.totalCost.toFixed(4)}`);
            costResult.breakdown.forEach(b => {
                console.log(` - ${b.itemName}: ${b.quantity} ${b.unit} ($${b.cost.toFixed(4)})`);
            });
        }
    }
}

findExtraCarneCost();
