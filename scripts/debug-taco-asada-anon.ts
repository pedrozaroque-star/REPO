
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Using ANON Key to simulate Browser Client
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function run() {
    console.log("🔍 DEBUGGING TACO ASADA RECIPES (ANON CLIENT)")

    // 1. Find the Item(s)
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('guid, name, group_name')
        .ilike('name', '%Taco Asada%')

    if (!items || items.length === 0) {
        console.log("No items found or Access Denied.")
        return
    }

    // 2. Check Recipes for each
    for (const item of items) {
        console.log(`\n📦 Checking Recipes for: ${item.name} (${item.guid})`)
        const { data: recipes, error } = await supabase
            .from('recipes')
            .select('*, inventory_items(id, name, purchase_unit_cost, quantity_per_unit, yield_percent)')
            .eq('toast_menu_item_guid', item.guid)

        if (error) {
            console.error("  ❌ Recipe Fetch Error:", error)
        } else {
            console.log(`  Found ${recipes?.length} recipe ingredients.`)
            recipes?.forEach((r, idx) => {
                const inv = r.inventory_items as any
                const status = inv ? `✅ Found Inv: ${inv.name} (Cost: ${inv.purchase_unit_cost})` : `❌ NULL Inventory Item`
                console.log(`  [${idx + 1}] Qty: ${r.quantity} -> ${status}`)
            })
        }
    }
}

run()
