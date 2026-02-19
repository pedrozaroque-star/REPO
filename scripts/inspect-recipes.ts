
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    console.log('--- Recipes ---')
    const { data: recipes } = await supabase.from('recipes').select('*').limit(1)
    console.log(recipes?.[0])

    console.log('\n--- Recipe Ingredients ---')
    const { data: ri } = await supabase.from('recipe_ingredients').select('*').limit(1)
    console.log(ri?.[0])

    console.log('\n--- Inventory Items ---')
    const { data: inv } = await supabase.from('inventory_items').select('*').limit(1)
    console.log(inv?.[0])
}

run()
