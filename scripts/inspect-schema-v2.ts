import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function inspectSchema() {
    console.log('--- INSPECTING SCHEMA ---')

    // 1. INVENTORY ITEMS
    const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .limit(1)

    if (itemsError) {
        console.error('Error fetching inventory_items:', itemsError.message)
    } else if (items && items.length > 0) {
        console.log('inventory_items columns:', Object.keys(items[0]).join(', '))
    } else {
        console.log('inventory_items table found but empty. Cannot infer columns easily via select *.')
        // Try to insert a dummy to get error? No, too risky.
    }

    // 2. RECIPES
    const { data: recipes, error: recipesError } = await supabase
        .from('recipes')
        .select('*')
        .limit(1)

    if (recipesError) {
        console.error('Error fetching recipes:', recipesError.message)
    } else if (recipes && recipes.length > 0) {
        console.log('recipes columns:', Object.keys(recipes[0]).join(', '))
    } else {
        console.log('recipes table found but empty.')
    }

    // 3. RECIPE INGREDIENTS
    const { data: recipeIng, error: recipeIngError } = await supabase
        .from('recipe_ingredients')
        .select('*')
        .limit(1)

    if (recipeIngError) {
        console.error('Error fetching recipe_ingredients:', recipeIngError.message)
    } else if (recipeIng && recipeIng.length > 0) {
        console.log('recipe_ingredients columns:', Object.keys(recipeIng[0]).join(', '))
    }

    // 4. MENU ITEMS (maybe called products?)
    const { data: products, error: productsError } = await supabase
        .from('products')
        .select('*')
        .limit(1)

    if (productsError) {
        // console.error('Error fetching products:', productsError.message)
    } else if (products && products.length > 0) {
        console.log('products columns:', Object.keys(products[0]).join(', '))
    }
}

inspectSchema()
