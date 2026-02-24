/**
 * FIX: Copy recipe from known GUID to the missing GUID for Large Horchata
 * Run: npx tsx scripts/fix-horchata-guid.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
    const KNOWN_GUID = '04c3493c-4f2c-4e95-b3ba-6872acaf2846'   // Has recipe
    const MISSING_GUID = '717ae4d3-04a7-4a24-83f7-e89111102a1e'  // From sales, no recipe

    console.log('🔧 Fixing Large Horchata GUID mismatch...\n')

    // 1. Get existing recipe ingredients
    const { data: existingRecipe, error: fetchErr } = await supabase
        .from('recipes')
        .select('*')
        .eq('toast_menu_item_guid', KNOWN_GUID)

    if (fetchErr || !existingRecipe || existingRecipe.length === 0) {
        console.error('❌ Could not find existing recipe for GUID:', KNOWN_GUID)
        return
    }

    console.log(`✅ Found ${existingRecipe.length} ingredients for known GUID:`)
    existingRecipe.forEach(r => console.log(`   - ${r.inventory_item_id} | Qty: ${r.quantity} ${r.unit}`))

    // 2. Check if missing GUID already has recipes (avoid duplicates)
    const { data: existing } = await supabase
        .from('recipes')
        .select('id')
        .eq('toast_menu_item_guid', MISSING_GUID)

    if (existing && existing.length > 0) {
        console.log(`\n⚠️  GUID ${MISSING_GUID} already has ${existing.length} recipe entries. Skipping.`)
        return
    }

    // 3. Also add the missing GUID to toast_menu_items if not there
    const { data: menuCheck } = await supabase
        .from('toast_menu_items')
        .select('guid')
        .eq('guid', MISSING_GUID)
        .maybeSingle()

    if (!menuCheck) {
        console.log('\n📝 Adding missing GUID to toast_menu_items...')
        const { error: insertMenuErr } = await supabase
            .from('toast_menu_items')
            .insert({
                guid: MISSING_GUID,
                name: 'Large Horchata',
                group_name: 'In Store Drinks > Lg. Fountain Drinks (Sales Alias)',
                price: 3.79,
                is_modifier: false,
                active: true
            })
        if (insertMenuErr) {
            console.error('❌ Failed to insert menu item:', insertMenuErr.message)
        } else {
            console.log('   ✅ Added to toast_menu_items')
        }
    }

    // 4. Copy recipe entries with the new GUID
    const newRecipes = existingRecipe.map(r => ({
        toast_menu_item_guid: MISSING_GUID,
        inventory_item_id: r.inventory_item_id,
        quantity: r.quantity,
        unit: r.unit,
        type: r.type || 'cooked'
    }))

    const { error: insertErr } = await supabase
        .from('recipes')
        .insert(newRecipes)

    if (insertErr) {
        console.error('❌ Failed to insert recipes:', insertErr.message)
        return
    }

    console.log(`\n✅ SUCCESS! Copied ${newRecipes.length} recipe ingredients to GUID ${MISSING_GUID}`)
    console.log('   Large Horchata will now calculate correctly across ALL dining options!')
}

main().catch(console.error)
