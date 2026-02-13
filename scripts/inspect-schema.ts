import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function inspectSchema() {
    console.log('--- TABLES ---')
    // Get list of tables (hacky way via pg request if possible, or just standard query on information_schema)
    // Supabase JS client doesn't expose listTables directly easily without rpc or high privileges on internal tables usually.
    // But we can query information_schema.

    // Attempt 1: Query information_schema.tables
    const { data: tables, error: tablesError } = await supabase
        .from('information_schema.tables') // This might fail due to permissions, let's try a direct query if possible or just infer from known tables.
    // Actually, let's try to query the known tables directly to see their structure by selecting a limit 0.
    // Better yet, let's try to invoke a raw query if we had that power, but we don't easily via standard client unless we have a function.
    // Re-reading: The user has `mcp_supabase-mcp-server_execute_sql` but it failed.
    // The script checks schema by inspecting known tables.

    // Let's assume standard names based on previous context:
    // inventory_items
    // inventory_categories
    // recipes?
    // menu_items?

    // Let's check `inventory_items` structure
    console.log('\n--- INVENTORY_ITEMS COLUMNS ---')
    const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .limit(1)

    if (items && items.length > 0) {
        console.log(Object.keys(items[0]))
    } else {
        console.log('No item found or error:', itemsError)
    }

    console.log('\n--- CHECKING FOR RECIPES TABLE ---')
    const { data: recipes, error: recipesError } = await supabase.from('recipes').select('*').limit(1)
    if (!recipesError) {
        console.log('Found recipes table. Columns:', recipes && recipes.length > 0 ? Object.keys(recipes[0]) : 'Empty table')
    } else {
        console.log('Recipes table not found or error:', recipesError.message)
    }

    console.log('\n--- CHECKING FOR RECIPE_INGREDIENTS TABLE ---')
    const { data: recipeIng, error: recipeIngError } = await supabase.from('recipe_ingredients').select('*').limit(1)
    if (!recipeIngError) {
        console.log('Found recipe_ingredients table. Columns:', recipeIng && recipeIng.length > 0 ? Object.keys(recipeIng[0]) : 'Empty table')
    } else {
        console.log('recipe_ingredients table not found or error:', recipeIngError.message)
    }

    console.log('\n--- CHECKING FOR MENU_ITEMS TABLE ---')
    const { data: menuItems, error: menuItemsError } = await supabase.from('menu_items').select('*').limit(1)
    if (!menuItemsError) {
        console.log('Found menu_items table. Columns:', menuItems && menuItems.length > 0 ? Object.keys(menuItems[0]) : 'Empty table')
    } else {
        console.log('menu_items table not found or error:', menuItemsError.message)
    }

}

inspectSchema()
