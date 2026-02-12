import { supabaseAdmin } from '../lib/supabase'
import { calculateRecipeCost } from '../lib/inventory/costs'
    // Import defaults to 'raw' in route.ts, so we mimic that structure here.

    ; (async () => {
        console.log("🔍 Investigating Cost for 'Medium Tamarindo'...")

        // 1. Find the Item
        const { data: menuItems } = await supabaseAdmin
            .from('toast_menu_items')
            .select('*')
            .ilike('name', '%Medium Tamarindo%')
            .limit(1)

        if (!menuItems || menuItems.length === 0) {
            console.error("❌ 'Medium Tamarindo' not found in toast_menu_items")
            return
        }
        const item = menuItems[0]
        console.log(`✅ Found Item: ${item.name} (${item.guid})`)

        // 2. Fetch its Recipe (Ingredients)
        const { data: ingredients } = await supabaseAdmin
            .from('recipes')
            .select('*')
            .eq('toast_menu_item_guid', item.guid)

        if (!ingredients || ingredients.length === 0) {
            console.error("❌ No recipe/ingredients found for this item.")
            return
        }
        console.log(`✅ Found ${ingredients.length} ingredients:`)
        ingredients.forEach(i => console.log(`   - ItemID: ${i.inventory_item_id}, Qty: ${i.quantity} ${i.unit}`))

        // 3. Fetch Inventory Details for these ingredients
        const ids = ingredients.map(i => i.inventory_item_id)
        const { data: invItems } = await supabaseAdmin
            .from('inventory_items')
            .select('*')
            .in('id', ids)

        console.log("📦 Inventory Items Details:")
        invItems?.forEach(inv => {
            console.log(`   - [${inv.name}] Type: ${inv.unit_type}, Price: $${inv.purchase_unit_cost}`)
        })

        // 4. Trace Calculation
        const recipeObj: any = {
            id: item.guid,
            name: item.name,
            menu_item_id: item.guid,
            ingredients: ingredients.map(i => ({ ...i, type: 'raw' }))
        }

        console.log("🚀 Running Calculation...")
        try {
            const result = calculateRecipeCost(recipeObj, invItems || [])
            console.log("📝 Result:", JSON.stringify(result, null, 2))
        } catch (e) {
            console.error("❌ Calculation Error:", e)
        }

    })()
