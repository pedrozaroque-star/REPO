import { getSupabaseAdminClient } from '../lib/supabase'

async function debugRecipeCost() {
    // GUID from screenshot: f7d9df3e...
    // Let's search for it.
    const partialGuid = 'f7d9df'

    const supabase = await getSupabaseAdminClient()

    // 1. Find the full GUID and name
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select('toast_menu_item_guid, inventory_item_id, quantity, unit')
        .ilike('toast_menu_item_guid', `${partialGuid}%`)

    if (error || !recipes || recipes.length === 0) {
        console.log('Recipe not found for GUID starting with', partialGuid)
        return
    }

    console.log(`Found ${recipes.length} ingredients for recipe ${partialGuid}...`)

    // 2. Get Inventory Details for these ingredients
    const inventoryIds = recipes.map(r => r.inventory_item_id)
    const { data: items, error: invError } = await supabase
        .from('inventory_items')
        .select('*')
        .in('id', inventoryIds)

    if (invError) {
        console.error(invError)
        return
    }

    // 3. Display Breakdown
    console.log('\n--- Recipe Breakdown ---')
    recipes.forEach(r => {
        const item = items?.find(i => i.id === r.inventory_item_id)
        if (!item) {
            console.log(`[UNKNOWN] Item ID: ${r.inventory_item_id} (Qty: ${r.quantity} ${r.unit}) - ITEM NOT FOUND IN DB`)
        } else {
            console.log(`[${item.name}]`)
            console.log(`\tRequired: ${r.quantity} ${r.unit}`)
            console.log(`\tInventory Unit: ${item.unit_type}`)
            console.log(`\tCost: $${item.purchase_unit_cost}`)
            console.log(`\tYield: ${item.yield_percent}%`)

            if (!item.purchase_unit_cost || item.purchase_unit_cost <= 0) {
                console.log(`\t⚠️  MISSING COST!`)
            }
        }
    })
}

debugRecipeCost()
