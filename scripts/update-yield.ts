import { getSupabaseAdminClient } from '../lib/supabase'

async function updateYield() {
    const supabase = await getSupabaseAdminClient()
    const { error } = await supabase
        .from('inventory_items')
        .update({ yield_percent: 61.5 })
        .eq('id', 'fab9d589-8ae8-4381-87da-85f836068996')

    if (error) console.error(error)
    else console.log('Successfully updated yield for Carne Asada to 61.5%')
}
updateYield()
