import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function debugPartyTray() {
    // Call the API directly and inspect the response
    const CENTRAL_ID = '8685e942-3f07-403a-afb6-faec697cd2cb';
    const url = `http://localhost:3000/api/inventory/food-cost?storeId=${CENTRAL_ID}&startDate=2026-05-28&endDate=2026-05-28`;
    
    console.log('Calling API...');
    const res = await fetch(url);
    const json = await res.json();
    
    const data = json.data || [];
    
    // Find the party tray items
    const trays = data.filter((d: any) => d.name?.toLowerCase().includes('people'));
    
    console.log(`\n=== PARTY TRAYS IN API RESPONSE ===`);
    trays.forEach((t: any) => {
        console.log(`\n"${t.name}"`);
        console.log(`  guid: ${t.guid}`);
        console.log(`  quantity: ${t.quantity}`);
        console.log(`  net_sales: $${t.net_sales}`);
        console.log(`  base_unit_cost: $${t.base_unit_cost}`);
        console.log(`  total_modifier_cost: $${t.total_modifier_cost}`);
        console.log(`  unit_cost: $${t.unit_cost}`);
        console.log(`  total_cost: $${t.total_cost}`);
        console.log(`  food_cost_percent: ${t.food_cost_percent}%`);
        console.log(`  has_recipe: ${t.has_recipe}`);
        console.log(`  missing_prices: ${t.missing_prices}`);
        console.log(`  total_meat_lbs: ${t.total_meat_lbs}`);
        console.log(`  group_name: ${t.group_name}`);
        console.log(`  modifier_guids: ${JSON.stringify(t.modifier_guids)}`);
    });

    // Now separately call the ProductDetailModal endpoint if there is one
    // Or simulate what the modal does: it calls the same API but adds &detail=true or something
    // Let me check by inspecting a tray's breakdown

    // Actually let me check the ProductDetailModal component to understand how it gets breakdown data
}

debugPartyTray();
