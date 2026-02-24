/**
 * DEBUG: Compare GUIDs from Toast sales vs what's in toast_menu_items and recipes tables
 * Run: npx tsx scripts/debug-recipe-guids.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
    // These are the GUIDs that came from Toast sales but had NO recipe match
    const missingGUIDs = [
        { guid: '717ae4d3-04a7-4a24-83f7-e89111102a1e', name: 'Large Horchata' },
        { guid: '0075526b-a9dc-4f4e-a734-a4e4195fe4c7', name: 'Flan' },
        { guid: '9d6a4152-5c25-47aa-ba49-2d7ae2fe90c4', name: 'Coffee' },
        { guid: '03e71aca-a566-425e-bf6a-31ae9148b7b2', name: 'Cheesecake' },
        { guid: '4ba54156-afed-412d-a443-e5f77a9b1196', name: 'Café de olla' },
        { guid: 'ada1f576-a22b-469f-9042-ed1d5ddea10f', name: 'Side Order Carne (Asada)' },
    ]

    console.log('═══════════════════════════════════════════════════')
    console.log('   DIAGNOSTIC: Recipe GUID Matching')
    console.log('═══════════════════════════════════════════════════\n')

    for (const item of missingGUIDs) {
        console.log(`\n🔍 "${item.name}" — Sales GUID: ${item.guid}`)
        console.log('─'.repeat(60))

        // 1. Check if this GUID exists in toast_menu_items
        const { data: menuItem } = await supabase
            .from('toast_menu_items')
            .select('guid, name, group_name, price')
            .eq('guid', item.guid)
            .maybeSingle()

        if (menuItem) {
            console.log(`   ✅ Found in toast_menu_items: "${menuItem.name}" | Group: ${menuItem.group_name} | Price: $${menuItem.price}`)
        } else {
            console.log(`   ❌ NOT in toast_menu_items — this GUID was never synced!`)
        }

        // 2. Check if this GUID has a recipe
        const { data: recipes } = await supabase
            .from('recipes')
            .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit')
            .eq('toast_menu_item_guid', item.guid)

        if (recipes && recipes.length > 0) {
            console.log(`   ✅ Has ${recipes.length} recipe ingredients`)
        } else {
            console.log(`   ❌ NO recipe entries for this GUID`)
        }

        // 3. Search by NAME in toast_menu_items to find possible alternative GUIDs
        const { data: alternates } = await supabase
            .from('toast_menu_items')
            .select('guid, name, group_name, price')
            .ilike('name', `%${item.name.split('(')[0].trim()}%`)

        if (alternates && alternates.length > 0) {
            console.log(`   📋 All toast_menu_items matching "${item.name.split('(')[0].trim()}":`)
            alternates.forEach(alt => {
                const match = alt.guid === item.guid ? ' ← SAME GUID' : ''
                console.log(`      GUID: ${alt.guid} | Name: "${alt.name}" | Group: ${alt.group_name} | $${alt.price}${match}`)
            })

            // 4. Check which of those alternates HAVE recipes
            const altGuids = alternates.map(a => a.guid)
            const { data: altRecipes } = await supabase
                .from('recipes')
                .select('toast_menu_item_guid, inventory_item_id')
                .in('toast_menu_item_guid', altGuids)

            if (altRecipes && altRecipes.length > 0) {
                const recipeGuids = [...new Set(altRecipes.map(r => r.toast_menu_item_guid))]
                console.log(`   🔗 GUIDs that DO have recipes: ${recipeGuids.join(', ')}`)

                // Show the mismatch
                if (!recipeGuids.includes(item.guid)) {
                    console.log(`   ⚠️  MISMATCH! Sales use GUID ${item.guid} but recipe is on ${recipeGuids[0]}`)
                }
            } else {
                console.log(`   ⚠️  None of the matching menu items have recipes at all`)
            }
        }
    }

    console.log('\n═══════════════════════════════════════════════════')
    console.log('   END DIAGNOSTIC')
    console.log('═══════════════════════════════════════════════════\n')
}

main().catch(console.error)
