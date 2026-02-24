/**
 * Find meat inventory items and Half modifier GUIDs to create recipes
 * Run: npx tsx scripts/find-half-meat-items.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
    console.log('═══════════════════════════════════════════════════')
    console.log('   Finding meat inventory items & Half modifier GUIDs')
    console.log('═══════════════════════════════════════════════════\n')

    // 1. Find all Half Meat modifiers
    const { data: halfMods } = await supabase
        .from('toast_menu_items')
        .select('guid, name, group_name')
        .ilike('group_name', '%Half Meat%')
        .order('name')

    console.log('📋 Half Meat Modifiers in toast_menu_items:')
    halfMods?.forEach(m => console.log(`   GUID: ${m.guid} | Name: "${m.name}" | Group: ${m.group_name}`))

    // 2. Check which already have recipes
    if (halfMods && halfMods.length > 0) {
        const halfGuids = halfMods.map(m => m.guid)
        const { data: existingRecipes } = await supabase
            .from('recipes')
            .select('toast_menu_item_guid')
            .in('toast_menu_item_guid', halfGuids)

        const recipesSet = new Set(existingRecipes?.map(r => r.toast_menu_item_guid))
        console.log(`\n✅ Already have recipes: ${recipesSet.size}`)
        console.log(`❌ Missing recipes: ${halfGuids.length - recipesSet.size}`)
    }

    // 3. Find meat inventory items (to map to recipes)
    const meatNames = ['asada', 'buche', 'cabeza', 'carnitas', 'chorizo', 'lengua', 'pastor', 'pollo']

    console.log('\n📦 Meat Inventory Items:')
    for (const meat of meatNames) {
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, unit_type, purchase_unit_cost, yield_percent')
            .ilike('name', `%${meat}%`)
            .order('name')

        if (items && items.length > 0) {
            items.forEach(i => {
                console.log(`   [${meat.toUpperCase()}] ID: ${i.id} | Name: "${i.name}" | Unit: ${i.unit_type} | Cost: $${i.purchase_unit_cost} | Yield: ${i.yield_percent}%`)
            })
        } else {
            console.log(`   [${meat.toUpperCase()}] ⚠️ No inventory item found!`)
        }
    }

    // 4. Also check existing full meat modifier recipes for reference
    console.log('\n📋 Existing FULL meat modifier recipes (for reference):')
    const { data: fullMeatMods } = await supabase
        .from('toast_menu_items')
        .select('guid, name')
        .or('name.ilike.%asada%,name.ilike.%pollo%,name.ilike.%pastor%,name.ilike.%carnitas%,name.ilike.%buche%,name.ilike.%cabeza%,name.ilike.%chorizo%,name.ilike.%lengua%')
        .eq('is_modifier', true)
        .not('group_name', 'ilike', '%half%')
        .order('name')

    if (fullMeatMods) {
        const fullGuids = fullMeatMods.map(m => m.guid)
        const { data: fullRecipes } = await supabase
            .from('recipes')
            .select('toast_menu_item_guid, inventory_item_id, quantity, unit')
            .in('toast_menu_item_guid', fullGuids)

        if (fullRecipes && fullRecipes.length > 0) {
            // Group by GUID
            const grouped = new Map<string, any[]>()
            fullRecipes.forEach(r => {
                if (!grouped.has(r.toast_menu_item_guid)) grouped.set(r.toast_menu_item_guid, [])
                grouped.get(r.toast_menu_item_guid)!.push(r)
            })

            for (const [guid, ings] of grouped) {
                const mod = fullMeatMods.find(m => m.guid === guid)
                console.log(`   "${mod?.name}" (${guid}):`)
                ings.forEach(ing => console.log(`      - ${ing.inventory_item_id} | ${ing.quantity} ${ing.unit}`))
            }
        }
    }

    console.log('\n═══════════════════════════════════════════════════')
}

main().catch(console.error)
