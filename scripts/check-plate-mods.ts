
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { calculateRecipeCost } = require('../lib/inventory/costs');

async function checkPlateModifiers() {
    // 1. Get all recipes and inventory
    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`);
    const invItems = recipes?.map(r => r.inv) || [];

    const guidMap = new Map();
    recipes?.forEach(r => {
        if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
        guidMap.get(r.toast_menu_item_guid).push(r);
    });

    // Modifiers identified in the screenshot name for Taco Plate:
    // "Taco Asada", "Onion & Cilantro", "Limes", "Pickled Jalapeños", "Salsa Verde", "Salsa Roja"

    console.log("CALCULATING MODIFIER COSTS...");

    // We need to find the GUIDs for these names. 
    // I will try to find recipes where the ingredients match these names.
    // Or I'll just look for the items directly.

    const targetMods = [
        { name: 'Onion & Cilantro', guid: 'e97664c3-a3d8-4f8e-bd3b-638e1b4010da' }, // Example Guids from previous research if I had them
        { name: 'Salsa Roja', guid: '6af864c3-a3d8-4f8e-bd3b-638e1b4010da' },
    ];

    // Since I don't have the GUIDs, I'll calculate cost for ALL recipes and group them by what I think they are
    for (const [guid, ingredients] of guidMap.entries()) {
        const costResult = calculateRecipeCost({ ingredients } as any, invItems as any);

        // Let's see if we find anything that hits $1.06 or $0.57
        // In the screenshot, the total extras is $3.33.
        // If it's 3 tacos + small things:
        // (3 * X) + Y = 3.33
    }

    // Let's search for "Onion & Cilantro" inventory item usage in recipes
    const { data: onionCilantro } = await supabase.from('inventory_items').select('id').ilike('name', '%Onion%Cilantro%').limit(1);
    if (onionCilantro && onionCilantro[0]) {
        const onionRecs = recipes?.filter(r => r.inventory_item_id === onionCilantro[0].id);
        const uniqueGuids = Array.from(new Set(onionRecs?.map(r => r.toast_menu_item_guid)));
        console.log(`\nRecipes using Onion & Cilantro (${uniqueGuids.length}):`);
        uniqueGuids.forEach(g => {
            const cost = calculateRecipeCost({ ingredients: guidMap.get(g) } as any, invItems as any);
            console.log(` - GUID ${g}: $${cost.totalCost.toFixed(4)}`);
        });
    }

    // Limes
    const { data: limes } = await supabase.from('inventory_items').select('id').ilike('name', '%Lima%').limit(1);
    if (limes && limes[0]) {
        const limeRecs = recipes?.filter(r => r.inventory_item_id === limes[0].id);
        const uniqueGuids = Array.from(new Set(limeRecs?.map(r => r.toast_menu_item_guid)));
        console.log(`\nRecipes using Limes (${uniqueGuids.length}):`);
        uniqueGuids.forEach(g => {
            const cost = calculateRecipeCost({ ingredients: guidMap.get(g) } as any, invItems as any);
            console.log(` - GUID ${g}: $${cost.totalCost.toFixed(4)}`);
        });
    }
}

checkPlateModifiers();
