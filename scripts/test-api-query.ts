import { supabase } from '../lib/supabase'

    ; (async () => {
        console.log("🔍 Inspecting Schema...")

        // 1. Check one recipe structure
        const { data: recipes } = await supabase.from('recipes').select('*').limit(1)
        if (recipes && recipes.length > 0) {
            console.log("📝 Recipe Sample:", recipes[0])
        } else {
            console.log("⚠️ No recipes found or error")
        }

        // 2. List all tables (hacky way via brute force select)
        const candidates = ['recipe_ingredients', 'recipe_items', 'ingredients', 'recipe_details', 'inventory_recipes']

        for (const table of candidates) {
            const { error } = await supabase.from(table).select('*').limit(1)
            if (!error) {
                console.log(`✅ Table FOUND: ${table}`)
            } else {
                console.log(`❌ Table NOT FOUND or ACCESS DENIED: ${table} -> ${error.message}`)
            }
        }

    })()
