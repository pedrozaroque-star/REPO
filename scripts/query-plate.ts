import { getSupabaseClient } from '../lib/supabase'

async function run() {
    const supabase = await getSupabaseClient()
    const { data: t } = await supabase.from('toast_menu_items').select('*').ilike('name', 'Taco Plate').limit(1)

    if (t && t.length > 0) {
        const guid = t[0].guid
        console.log(`Taco Plate GUID: ${guid}`)
        const { data: r } = await supabase.from('recipes').select('*').eq('toast_menu_item_guid', guid)

        if (r) {
            console.log('Ingredients:')
            for (const item of r) {
                const { data: inv } = await supabase.from('inventory_items').select('name, purchase_unit_cost').eq('id', item.inventory_item_id).single()
                console.log(`- ${inv?.name}: ${item.quantity} ${item.unit} (Cost: ${inv?.purchase_unit_cost})`)
            }
        }
    }
}
run().catch(console.error)
