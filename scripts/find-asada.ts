import { getSupabaseAdminClient } from '../lib/supabase'

async function findItems() {
    const supabase = await getSupabaseAdminClient()
    const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type, yield_percent')
        .ilike('name', '%asada%')

    if (error) {
        console.error(error)
        return
    }

    console.log('--- FOUND ITEMS ---')
    console.table(data)
}

findItems()
