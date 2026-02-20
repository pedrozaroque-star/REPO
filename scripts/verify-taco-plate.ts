
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function verifyTacoPlate() {
    const guid = 'e5bb7d3e-2a4c-4293-86a8-6b2ccae940ad'; // Found in previous search
    console.log(`--- ANALYZING TACO PLATE: ${guid} ---`);

    // 1. Main Recipe
    const { data: mainRecipe } = await supabase
        .from('recipes')
        .select(`*, inv:inventory_items(*)`)
        .eq('toast_menu_item_guid', guid);

    console.log('\n--- MAIN PLATE INGREDIENTS ---');
    let totalMainCost = 0;
    if (mainRecipe?.length) {
        mainRecipe.forEach(r => {
            const costPerUnit = r.inv.purchase_unit_cost / r.inv.quantity_per_unit;
            const yieldFactor = (r.inv.yield_percent || 100) / 100;
            let lbs = 0;
            if (r.unit.startsWith('oz')) lbs = r.quantity / 16;
            else if (r.unit.startsWith('lb')) lbs = r.quantity;
            else lbs = r.quantity;

            let lineCost = 0;
            if (r.unit === 'pza' || r.unit === 'unit') lineCost = r.quantity * costPerUnit;
            else lineCost = (lbs / yieldFactor) * costPerUnit;
            totalMainCost += lineCost;
            console.log(` - ${r.inv.name}: ${r.quantity} ${r.unit} | Cost: $${lineCost.toFixed(4)}`);
        });
    }
    console.log(`Total Base Cost: $${totalMainCost.toFixed(4)}`);

    // 2. Modifiers Analysis
    const modifiers = [
        { name: 'Taco Pollo', count: 3 },
        { name: 'Extra Carne 1.5 oz', count: 1 },
        { name: 'Jack Cheese', count: 1 },
        { name: 'Salsa Roja', count: 1 },
        { name: 'Pickled Jalapeños', count: 1 },
        { name: 'Salsa Verde', count: 1 },
        { name: 'Limes', count: 1 }
    ];

    console.log('\n--- MODIFIERS COST ---');
    let totalModCost = 0;
    for (const modDesc of modifiers) {
        const { data: modItems } = await supabase
            .from('toast_menu_items')
            .select('guid, name')
            .ilike('name', `%${modDesc.name}%`)
            .limit(1);

        if (modItems?.length) {
            const mod = modItems[0];
            const { data: modRecipe } = await supabase
                .from('recipes')
                .select(`*, inv:inventory_items(*)`)
                .eq('toast_menu_item_guid', mod.guid);

            if (modRecipe?.length) {
                let modCost = 0;
                modRecipe.forEach(r => {
                    const costPerUnit = r.inv.purchase_unit_cost / r.inv.quantity_per_unit;
                    const yieldFactor = (r.inv.yield_percent || 100) / 100;
                    let lbs = 0;
                    if (r.unit.startsWith('oz')) lbs = r.quantity / 16;
                    else if (r.unit.startsWith('lb')) lbs = r.quantity;
                    else lbs = r.quantity;

                    let lineCost = 0;
                    if (r.unit === 'pza' || r.unit === 'unit') lineCost = r.quantity * costPerUnit;
                    else lineCost = (lbs / yieldFactor) * costPerUnit;
                    modCost += lineCost;
                });
                const subtotal = modCost * modDesc.count;
                totalModCost += subtotal;
                console.log(` - ${modDesc.name} (x${modDesc.count}): $${modCost.toFixed(4)} ea -> Subtotal: $${subtotal.toFixed(4)}`);
            } else {
                console.log(` - ${modDesc.name}: No recipe found.`);
            }
        }
    }

    const finalTotal = totalMainCost + totalModCost;
    console.log('\n-----------------------------------');
    console.log(`GRAND TOTAL ESTIMATED COST: $${finalTotal.toFixed(4)}`);
}

verifyTacoPlate();
