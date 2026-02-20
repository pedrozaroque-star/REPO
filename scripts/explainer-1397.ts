
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Import the real cost calculator from the lib
const { calculateRecipeCost } = require('../lib/inventory/costs');

async function explainThe1397() {
    // 1. We know from the UI it's "Taco Asada (En Aluminio (In Store))"
    // 2. We search for recipes that match those words or are linked to the taco's MODIFIERS

    // In Toast, when you select (En Aluminio) and (In Store), it sends those as modifier_guids.
    // I will fetch all recipes to find which ones belong to these common taco modifiers.

    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`);
    const { data: stores } = await supabase.from('stores').select('*');

    // Filter to find recipes with unrealistic costs
    const guidMap = new Map();
    recipes?.forEach(r => {
        if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
        guidMap.get(r.toast_menu_item_guid).push(r);
    });

    console.log("--- BUSCANDO EL CULPABLE DEL COSTO $13.97 ---");

    for (const [guid, ingredients] of guidMap.entries()) {
        const costResult = calculateRecipeCost({ ingredients } as any, recipes.map(i => i.inv) as any);

        // Buscamos algo que se acerque a $13.97 o que sumado de ese valor
        if (costResult.totalCost > 5) {
            console.log(`\nMODIFICADOR ENCONTRADO (GUID: ${guid})`);
            console.log(`COSTO TEÓRICO: $${costResult.totalCost.toFixed(2)}`);
            console.log(`INGREDIENTES:`);
            costResult.breakdown.forEach(b => {
                console.log(` - ${b.itemName}: ${b.quantity} ${b.unit} (Costo: $${b.cost.toFixed(2)})`);
            });
        }
    }
}

explainThe1397();
