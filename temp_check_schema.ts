import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    const { data: recipes, error } = await supabase.from('recipes').select('id, recipe_ingredients(*)')
    if (recipes && recipes.length > 0) {
        let all_ings: any[] = []
        for (const r of recipes) {
            if (r.recipe_ingredients) all_ings.push(...r.recipe_ingredients)
        }
        console.log("Found ingredients:", all_ings.length)
        if (all_ings.length > 0) {
            console.log("Keys:", Object.keys(all_ings[0]))

            const counts = all_ings.reduce((acc: any, curr: any) => {
                const t = curr.type || 'null'
                // Handle case where type column doesn't exist
                if (!('type' in curr)) {
                    acc['MISSING_COLUMN'] = (acc['MISSING_COLUMN'] || 0) + 1
                    return acc
                }
                acc[t] = (acc[t] || 0) + 1
                return acc
            }, {})
            console.log("Type count:", counts)
        }
    } else {
        console.log("No recipes found or error:", error)
    }
}
run()
