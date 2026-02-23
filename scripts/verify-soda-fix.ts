
import { calculateRecipeCost } from '../lib/inventory/costs'
import { getSupabaseAdminClient } from '../lib/supabase'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function verifySodaFix() {
    const supabase = await getSupabaseAdminClient()

    // Large Diet Coke (bc4a75f9-6a1a-4abc-b595-14f7e73133b2)
    const toastGuid = 'bc4a75f9-6a1a-4abc-b595-14f7e73133b2'

    console.log(`Verifying fix for GUID: ${toastGuid}...`)

    const { data: recipe } = await supabase
        .from('recipes')
        .select('*')
        .eq('toast_menu_item_guid', toastGuid)
        .single()

    const { data: inventoryItems } = await supabase
        .from('inventory_items')
        .select('*')

    if (!recipe || !inventoryItems) {
        console.error("Missing data")
        return
    }

    // Format for calculateRecipeCost
    const formattedRecipe = {
        id: recipe.toast_menu_item_guid,
        toast_menu_item_guid: recipe.toast_menu_item_guid,
        ingredients: [{
            inventory_item_id: recipe.inventory_item_id,
            quantity: recipe.quantity,
            unit: recipe.unit,
            type: 'raw'
        }]
    }

    const result = calculateRecipeCost(formattedRecipe as any, inventoryItems as any)

    console.log('--- COST CALCULATION RESULT ---')
    console.log(`Total Cost: $${result.totalCost.toFixed(4)}`)
    result.breakdown.forEach(b => {
        console.log(` - ${b.itemName}: ${b.quantity} ${b.unit} | Cost: $${b.cost.toFixed(4)}`)
    })
    console.log('-------------------------------')
}

verifySodaFix()
