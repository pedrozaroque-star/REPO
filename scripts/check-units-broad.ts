
import { getSupabaseAdminClient } from '../lib/supabase'

async function checkBadUnits() {
    const supabase = await getSupabaseAdminClient()

    console.log("🔍 Searching for items with 'CT', 'units', 'kg', 'g', 'dz'...")

    // We fetch all and filter in JS because strict SQL pattern matching for "g" is tricky (matches "bag")
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type')

    if (error) {
        console.error("Error fetching items:", error)
        return
    }

    const badPatterns = ['ct', 'unit', 'uni', 'dz', 'kg', ' g', 'g '] // " g" to avoid matching "bag"
    // Actually, let's look for specific unit_type strings or regex match

    const relevantItems = items?.filter(i => {
        const u = i.unit_type.toLowerCase()
        return (
            u.includes('ct') ||
            u.includes('unit') ||
            u.includes('uni') ||
            u.includes('dz') ||
            u.includes('kg') ||
            // check for grams but avoid "bag" or "age"
            /\b(g)\b/.test(u)
        )
    })

    if (relevantItems && relevantItems.length > 0) {
        console.log(`⚠️ Found ${relevantItems.length} items to fix:`)
        relevantItems.forEach(item => {
            console.log(`- [${item.id}] ${item.name}: "${item.unit_type}"`)
        })
    } else {
        console.log("✅ No items found with target units.")
    }
}

checkBadUnits()
