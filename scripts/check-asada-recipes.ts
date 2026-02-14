import { getSupabaseAdminClient } from '../lib/supabase'

async function checkRecipes() {
    const supabase = await getSupabaseAdminClient()
    const { count, error } = await supabase
        .from('recipes')
        .select('*', { count: 'exact', head: true })
        .eq('inventory_item_id', 'fab9d589-8ae8-4381-87da-85f836068996')

    if (error) console.error(error)
    else console.log(`Found ${count} recipes using Carne Asada (fab9d589-8ae8-4381-87da-85f836068996)`)
}
checkRecipes()
