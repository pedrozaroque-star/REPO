
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { calculateRecipeCost } = require('../lib/inventory/costs');

async function debugTacoPlate() {
    // GUID from screenshot: e5bb7d3e
    const plateGuidStarts = 'e5bb7d3e';

    // 1. Get Recipes and Inventory
    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`);

    const guidMap = new Map();
    recipes?.forEach(r => {
        if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
        guidMap.get(r.toast_menu_item_guid).push(r);
    });

    // Find the Plate's base recipe
    let plateGuid = '';
    for (const g of guidMap.keys()) {
        if (g.startsWith(plateGuidStarts)) {
            plateGuid = g;
            break;
        }
    }

    if (plateGuid) {
        const ingredients = guidMap.get(plateGuid);
        const costResult = calculateRecipeCost({ ingredients } as any, recipes?.map(i => i.inv) as any);
        console.log(`BASE PLATE COST (${plateGuid}): $${costResult.totalCost.toFixed(4)}`);
        costResult.breakdown.forEach(b => console.log(` - ${b.itemName}: $${b.cost.toFixed(4)}`));
    }

    // Now look for common modifiers in the Taco Plate
    // Taco Asada, Onion & Cilantro, Salsa Roja, Limes, Pickled Jalapeños, Salsa Verde
    const modNames = ['Taco Asada', 'Onion & Cilantro', 'Salsa Roja', 'Limes', 'Pickled Jalapeños', 'Salsa Verde'];

    console.log('\nMODIFIER COSTS:');
    for (const [guid, ingredients] of guidMap.entries()) {
        // We don't have item names in recipes table easily without external mapping or searching common names
        // But I can calculate costs for everything and see which ones match the taco mix
        const costResult = calculateRecipeCost({ ingredients } as any, recipes?.map(i => i.inv) as any);

        // I'll filter for specific costs or just list the most common ones
        // I already know Taco Asada is ~$1.06
        if (costResult.totalCost > 0) {
            // Let's check if this guid belongs to one of the modifiers
            // For now, I'll just print if it relates to a "Taco" or common names
        }
    }

    // Hardcoded check for Taco Asada GUID found before: 6141b8b8-8707-4632-a837-81cfccffc0e6
    const asadaGuid = '6141b8b8-8707-4632-a837-81cfccffc0e6';
    if (guidMap.has(asadaGuid)) {
        const cost = calculateRecipeCost({ ingredients: guidMap.get(asadaGuid) } as any, recipes?.map(i => i.inv) as any);
        console.log(`TACO ASADA COST: $${cost.totalCost.toFixed(4)}`);
    }

}

debugTacoPlate();
