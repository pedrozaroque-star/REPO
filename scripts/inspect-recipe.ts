
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function main() {
    const guid = process.argv[2] // Get GUID from command line
    if (!guid) {
        console.error("Please provide a GUID as argument.")
        return
    }

    // 1. Fetch Recipes from 'recipes' table
    // It seems 'recipes' is a join table: id, inventory_item_id, toast_menu_item_guid, quantity, unit
    // OR it could be the table for the products itself, and there's a join table like 'recipe_ingredients'.
    // Let's assume 'recipes' holds the ingredients directly based on the route.ts code:
    /*
        const { data: recipesData, error: recipeError } = await supabase
            .from('recipes')
            .select('*')
        recipesData.forEach((row: any) => { ... })
    */

    console.log(`Searching recipes for GUID: ${guid}`)

    // Use explicit filter for GUID (it's stored in toast_menu_item_guid)
    // Note: The screenshot showed 'eca5a477...' so we can use partial match if needed, but exact is better.
    // Let's assume the user will input partial or full guid.

    // First, let's list all columns just to be sure.
    const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .ilike('toast_menu_item_guid', `${guid}%`)

    if (error) {
        console.error("Error fetching recipes:", error)
        return
    }

    console.log(`Found ${data.length} rows for GUID starting with ${guid}:`)
    console.table(data)

    // Calculate total cost manually if possible (we need inventory item cost)
    // Fetch inventory items for these ingredients to check.
    if (data.length > 0) {
        const itemIds = data.map((r: any) => r.inventory_item_id)
        const { data: items, error: itemError } = await supabase
            .from('inventory_items')
            .select('id, name, unit_cost, unit')
            .in('id', itemIds)

        if (itemError) {
            console.error("Error fetching items:", itemError)
        } else {
            console.log("\nAssociated Inventory Items:")
            console.table(items)

            // Calculate Total
            let total = 0
            data.forEach((r: any) => {
                const item = items.find((i: any) => i.id === r.inventory_item_id)
                if (item) {
                    // Simple calc (ignoring complex unit conversions for now)
                    // Assuming same unit for simplicity or let's see.
                    // Report logic uses calculateRecipeCost utility, but here we just want a rough sum.
                    console.log(` - ${item.name}: Qty ${r.quantity} ${r.unit} (Cost: $${item.unit_cost}/${item.unit})`)
                }
            })
        }
    }
}

main()
