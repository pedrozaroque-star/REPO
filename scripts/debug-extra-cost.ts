
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function getDetailedBreakdown() {
    const guid = 'ae79ea50-d835-44b3-92a2-4e746e03fb10';
    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`).eq('toast_menu_item_guid', guid);

    if (!recipes) return;

    // Simplified cost calculation logic similar to lib/inventory/costs.ts
    let total = 0;
    console.log(`BREAKDOWN FOR RECIPE ${guid}:`);
    recipes.forEach(r => {
        const inv = r.inv;
        const costPerUnit = inv.purchase_unit_cost / inv.quantity_per_unit;
        // Assume unit conversion for basic units (lb, oz, pza)
        let qty = r.quantity;
        if (r.unit === 'oz' && inv.unit === 'lb') qty = qty / 16;

        const itemCost = qty * costPerUnit;
        total += itemCost;
        console.log(` - ${inv.name}: ${r.quantity} ${r.unit} = $${itemCost.toFixed(4)}`);
    });
    console.log(`SUBTOTAL RECIPE: $${total.toFixed(4)}`);
}

getDetailedBreakdown();
