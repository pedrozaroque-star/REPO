import { getSupabaseClient } from '../lib/supabase'

async function run() {
    const supabase = await getSupabaseClient()
    const dates = ['2026-02-24', '2026-02-23', '2026-02-25']

    for (const d of dates) {
        const { data } = await supabase.from('sales_daily_cache').select('pmix_data').eq('business_date', d)
        if (data) {
            for (const row of data) {
                const pmix = row.pmix_data || []
                const item = pmix.find((i: any) => i.guid.startsWith('e5bb7d3e') || i.name.includes('Cabeza, Taco Lengua'))
                if (item) {
                    console.log(`FOUND in ${d}!`)
                    console.log('Name:', item.name)
                    console.log('GUID:', item.guid)
                    console.log('Modifiers:', item.modifier_guids)
                    console.log('Qty:', item.quantity)
                    console.log('Gross:', item.gross_sales)

                    // Fetch recipes for these modifiers to see their exact costs
                    const modGuids = item.modifier_guids || []
                    const { data: menuItems } = await supabase.from('toast_menu_items').select('guid, name').in('guid', modGuids)
                    console.log('Mod Names:', menuItems?.map(m => m.name))
                    return
                }
            }
        }
    }
    console.log('Not found in any cache.')
}

run().catch(console.error)
