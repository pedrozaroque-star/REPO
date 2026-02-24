/**
 * Create recipes for all Half Meat modifiers (0.5 lb each)
 * Based on the same inventory items as the full meat modifier recipes
 * Run: npx tsx scripts/create-half-meat-recipes.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Half modifier GUID → Same inventory item as the full modifier, but 0.5 lb
const HALF_RECIPES = [
    {
        half_guid: 'ed889228-98e7-4c49-bc46-8e0718ec1fcf',   // Half Asada
        name: 'Half Asada',
        inventory_item_id: 'fab9d589-8ae8-4381-87da-85f836068996', // Carne Asada (10 lb)
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'  // Asada has 61.5% yield
    },
    {
        half_guid: 'b52ffce5-cc66-4930-bb96-70891c41643e',   // Half Buche
        name: 'Half Buche',
        inventory_item_id: 'baac1d41-3b80-4f80-acfc-7a19f46e03c2', // Buche 6 oz
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'
    },
    {
        half_guid: 'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3',   // Half Cabeza
        name: 'Half Cabeza',
        inventory_item_id: '511e341b-ca42-44ed-89df-a4a84b51a619', // Cabeza (5 lb)
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'
    },
    {
        half_guid: '443938bb-ec20-4a64-9fa3-91d4f89de0a5',   // Half Carnitas
        name: 'Half Carnitas',
        inventory_item_id: '14990e85-0d90-467c-ad9d-362e6ed4f1cd', // Carnitas 6 oz
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'
    },
    {
        half_guid: '6d1bfd79-8c97-4c81-8e03-729fa08ecc75',   // Half Chorizo
        name: 'Half Chorizo',
        inventory_item_id: '1e4c43b6-4e1b-4e51-8617-e127b89467f1', // Chorizo 8 oz
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'
    },
    {
        half_guid: 'fbe42d67-a0f8-481f-bb28-e1717075c290',   // Half Lengua
        name: 'Half Lengua',
        inventory_item_id: '0fb87578-1185-41a9-a318-97428db20a5d', // Lengua (5 lb)
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'
    },
    {
        half_guid: '8717b04b-62c0-4276-96e9-d86430b32b64',   // Half Pastor
        name: 'Half Pastor',
        inventory_item_id: 'ad7e3703-2701-4a05-aa97-77866c8c717e', // Pastor (10 lb)
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'  // Pastor has 61.5% yield
    },
    {
        half_guid: '37c0cb59-fa76-4b81-b327-cd96784d9f78',   // Half Pollo
        name: 'Half Pollo',
        inventory_item_id: '4ea7ef9c-986e-4fc1-a363-7200ca558aab', // Pollo (10 lb)
        quantity: 0.5,
        unit: 'lb',
        type: 'cooked'  // Pollo has 65% yield
    }
]

async function main() {
    console.log('═══════════════════════════════════════════════════')
    console.log('   Creating Half Meat Modifier Recipes (0.5 lb each)')
    console.log('═══════════════════════════════════════════════════\n')

    let created = 0
    let skipped = 0

    for (const recipe of HALF_RECIPES) {
        // Check if recipe already exists
        const { data: existing } = await supabase
            .from('recipes')
            .select('id')
            .eq('toast_menu_item_guid', recipe.half_guid)

        if (existing && existing.length > 0) {
            console.log(`⏭  ${recipe.name}: Already has recipe, skipping`)
            skipped++
            continue
        }

        // Insert new recipe
        const { error } = await supabase
            .from('recipes')
            .insert({
                toast_menu_item_guid: recipe.half_guid,
                inventory_item_id: recipe.inventory_item_id,
                quantity: recipe.quantity,
                unit: recipe.unit,
                type: recipe.type
            })

        if (error) {
            console.error(`❌ ${recipe.name}: Failed — ${error.message}`)
        } else {
            console.log(`✅ ${recipe.name}: Created (0.5 lb of ${recipe.inventory_item_id.slice(0, 8)}...)`)
            created++
        }
    }

    console.log(`\n═══════════════════════════════════════════════════`)
    console.log(`   Results: ${created} created, ${skipped} skipped`)
    console.log(`═══════════════════════════════════════════════════\n`)

    // Verify by reading back
    console.log('📋 Verification — All Half Meat recipes:')
    const allGuids = HALF_RECIPES.map(r => r.half_guid)
    const { data: verify } = await supabase
        .from('recipes')
        .select('toast_menu_item_guid, inventory_item_id, quantity, unit, type')
        .in('toast_menu_item_guid', allGuids)

    verify?.forEach(r => {
        const name = HALF_RECIPES.find(hr => hr.half_guid === r.toast_menu_item_guid)?.name
        console.log(`   ${name}: ${r.quantity} ${r.unit} (${r.type}) → ${r.inventory_item_id.slice(0, 8)}...`)
    })
}

main().catch(console.error)
