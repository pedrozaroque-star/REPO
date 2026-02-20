
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { calculateRecipeCost } = require('../lib/inventory/costs');

async function auditTacoPlateCosts() {
    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`);
    const invItems = recipes?.map(r => r.inv) || [];
    const guidMap = new Map();
    recipes?.forEach(r => {
        if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
        guidMap.get(r.toast_menu_item_guid).push(r);
    });

    console.log("--- AUDITANDO COMPONENTES DEL TACO PLATE ---");

    // 1. EL TACO ASADA (Debería ser ~1.5oz - 2oz de carne)
    const asadaGuid = '6141b8b8-8707-4632-a837-81cfccffc0e6';
    if (guidMap.has(asadaGuid)) {
        const cost = calculateRecipeCost({ ingredients: guidMap.get(asadaGuid) } as any, invItems as any);
        console.log(`\nCOSTO TACO ASADA: $${cost.totalCost.toFixed(4)}`);
        cost.breakdown.forEach((b: any) => console.log(` - ${b.itemName}: ${b.quantity} ${b.unit} ($${b.cost.toFixed(4)})`));
    }

    // 2. EL TACO POLLO
    const polloGuid = '4ea7ef9c-986e-4fc1-a363-7200ca558aab'; // Item ID, need to find recipe guid
    for (const [guid, ingredients] of guidMap.entries()) {
        const costResult = calculateRecipeCost({ ingredients } as any, invItems as any);
        const hasPollo = costResult.breakdown.some((b: any) => b.itemName === 'Pollo');
        const isSmall = costResult.totalCost > 0.10 && costResult.totalCost < 1.00;
        if (hasPollo && isSmall && ingredients.length < 5) {
            console.log(`\nPOSIBLE TACO POLLO (GUID: ${guid}): $${costResult.totalCost.toFixed(4)}`);
            costResult.breakdown.forEach((b: any) => console.log(` - ${b.itemName}: ${b.quantity} ${b.unit} ($${b.cost.toFixed(4)})`));
        }
    }

    // 3. EL CLÁSICO TACO PASTOR
    for (const [guid, ingredients] of guidMap.entries()) {
        const costResult = calculateRecipeCost({ ingredients } as any, invItems as any);
        const hasPastor = costResult.breakdown.some((b: any) => b.itemName.includes('Pastor'));
        if (hasPastor && costResult.totalCost < 2) {
            console.log(`\nPOSIBLE TACO PASTOR (GUID: ${guid}): $${costResult.totalCost.toFixed(4)}`);
            costResult.breakdown.forEach((b: any) => console.log(` - ${b.itemName}: ${b.quantity} ${b.unit} ($${b.cost.toFixed(4)})`));
        }
    }
}

auditTacoPlateCosts();
