
import { getSupabaseAdminClient } from '../lib/supabase'

async function checkDzUnits() {
    const supabase = await getSupabaseAdminClient()

    console.log("🔍 Searching for items with 'dz' in unit_type...")

    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type')
        .ilike('unit_type', '%dz%')

    if (error) {
        console.error("Error fetching items:", error)
        return
    }

    if (items && items.length > 0) {
        console.log(`⚠️ Found ${items.length} items with 'dz' units:`)
        items.forEach(item => {
            console.log(`- [${item.id}] ${item.name}: "${item.unit_type}"`)
        })
    } else {
        console.log("✅ No items found with 'dz' units.")
    }
}

checkDzUnits()
