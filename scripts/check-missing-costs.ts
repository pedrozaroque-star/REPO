import { getSupabaseAdminClient } from '../lib/supabase'

async function findMissingCosts() {
    const supabase = await getSupabaseAdminClient()
    const { data, error } = await supabase
        .from('inventory_items')
        .select('name, unit_type, purchase_unit_cost')
        .or('purchase_unit_cost.is.null,purchase_unit_cost.eq.0')
        .order('name')

    if (error) {
        console.error(error)
        return
    }

    if (data.length === 0) {
        console.log('All inventory items have costs!')
    } else {
        console.log('--- Items Missing Cost ---')
        data.forEach(i => {
            console.log(`- ${i.name} (Unit: ${i.unit_type})`)
        })
    }
}

findMissingCosts()
