
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    console.log("🔍 DEBUGGING TACO ASADA RECIPES")

    // 1. Find the Item(s)
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('guid, name, group_name')
        .ilike('name', '%Taco Asada%')

    console.log(`Found ${items?.length} matching menu items:`)
    items?.forEach(i => console.log(`- ${i.name} [${i.group_name}] (${i.guid})`))

    if (!items || items.length === 0) return

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
                const status = inv ? `✅ Found Inv: ${inv.name}` : `❌ NULL Inventory Item (ID: ${r.inventory_item_id})`
                console.log(`  [${idx + 1}] Qty: ${r.quantity} ${r.unit} -> ${status}`)
                if (inv) {
                    const costPerUnit = (inv.purchase_unit_cost || 0) / (inv.quantity_per_unit || 1)
                    const yieldFactor = (inv.yield_percent || 100) / 100
                    const cost = (costPerUnit * (r.quantity || 0)) / yieldFactor
                    console.log(`      💰 Calc Cost: $${cost.toFixed(4)}`)
                }
            })
        }
    }
}

run()
