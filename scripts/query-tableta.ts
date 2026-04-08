import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
    const { count: inventoryCount } = await supabase.from('inventory_items').select('id', { count: 'exact', head: true })
    const { count: recipeCount } = await supabase.from('recipes').select('id', { count: 'exact', head: true })
    console.log('Inventory Count:', inventoryCount)
    console.log('Recipe Count:', recipeCount)
}
main().catch(console.log).finally(() => process.exit(0))
