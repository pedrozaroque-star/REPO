import { getSupabaseAdminClient } from '../lib/supabase';
import { calculateRecipeCost } from '../lib/inventory/costs';

async function main() {
    const supabase = await getSupabaseAdminClient();
    
    // Get recipe for Meat Only Super Burrito Asada
    const { data: recipes } = await supabase.from('recipes')
        .select('*, toast_menu_item_cache!inner(name, guid)')
        .eq('toast_menu_item_cache.name', 'Meat Only Super Burrito Asada');
        
    const recipe = recipes![0];
    console.log("Recipe:", recipe.toast_menu_item_cache.name);
    
    // Get current inventory items
    const { data: currentInv } = await supabase.from('inventory_items').select('*');
    if (!currentInv) return;
    
    // Get historical prices for May 24, 2026
    const { data: historyData } = await supabase
        .from('inventory_price_history')
        .select('*')
        .lte('effective_date', '2026-05-24T23:59:59.999Z')
        .order('effective_date', { ascending: false });
        
    const historyMap = new Map();
    historyData?.forEach(h => {
        if (!historyMap.has(h.inventory_item_id)) {
            historyMap.set(h.inventory_item_id, h.purchase_unit_cost);
        }
    });
    
    // Create historical inventory
    const historicalInv = currentInv.map(item => ({
        ...item,
        purchase_unit_cost: historyMap.has(item.id) ? historyMap.get(item.id) : item.purchase_unit_cost
    })) as any;
    
    // Calculate Today's Cost
    const todayForHere = calculateRecipeCost(recipe as any, currentInv as any, 'FOR HERE');
    
    console.log("--- TODAY'S PRICES ---");
    console.log("Food Cost:", todayForHere.foodCost);
    console.log("Packaging (For Here):", todayForHere.packagingCost);
    console.log("Total (For Here):", todayForHere.totalCost);
    
    // Calculate Yesterday's Cost
    const yestForHere = calculateRecipeCost(recipe as any, historicalInv as any, 'FOR HERE');
    
    console.log("--- YESTERDAY'S PRICES (May 24) ---");
    console.log("Food Cost:", yestForHere.foodCost);
    console.log("Packaging (For Here):", yestForHere.packagingCost);
    console.log("Total (For Here):", yestForHere.totalCost);
    
    // Find the difference
    console.log("--- DIFFERENCES ---");
    yestForHere.breakdown.forEach(yItem => {
        const tItem = todayForHere.breakdown.find(i => i.inventoryItemId === yItem.inventoryItemId);
        if (tItem && tItem.cost !== yItem.cost) {
            console.log(`${yItem.itemName}: Yesterday $${yItem.cost} -> Today $${tItem.cost}`);
        }
    });
}
main().catch(console.error);
