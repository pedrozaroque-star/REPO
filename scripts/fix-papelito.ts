import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function fixPapelito() {
    // 1. Find the item
    const { data: items, error: iErr } = await supabase
        .from('inventory_items')
        .select('id, name')
        .ilike('name', '%papelito%torta%')

    if (iErr) throw iErr
    if (!items || items.length === 0) {
        console.log('Could not find item matching Papelito Para Torta')
        return
    }

    const papelito = items[0]
    console.log(`Found item: ${papelito.name} (ID: ${papelito.id})`)

    // 2. Fetch all recipes
    const { data: recipes, error: rErr } = await supabase
        .from('recipes')
        .select('id, name, ingredients')

    if (rErr) throw rErr

    let updatedCount = 0

    // 3. Fix the ones containing this item
    for (const recipe of recipes) {
        if (!recipe.ingredients || !Array.isArray(recipe.ingredients)) continue

        let modified = false
        const newIngredients = recipe.ingredients.map((ing: any) => {
            if (ing.inventory_item_id === papelito.id) {
                if (ing.quantity !== 1 || ing.unit !== 'pza') {
                    console.log(`Fixing Recipe '${recipe.name}': was ${ing.quantity} ${ing.unit} -> now 1 pza`)
                    modified = true
                    return { ...ing, quantity: 1, unit: 'pza' }
                }
            }
            return ing
        })

        if (modified) {
            const { error: updErr } = await supabase
                .from('recipes')
                .update({ ingredients: newIngredients })
                .eq('id', recipe.id)

            if (updErr) {
                console.error(`Error updating recipe ${recipe.name}:`, updErr)
            } else {
                updatedCount++
            }
        }
    }

    console.log(`Fixed ${updatedCount} recipes.`)
}

fixPapelito()
