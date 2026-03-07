import { getSupabaseClient } from '../lib/supabase'

async function investigate() {
    const supabase = await getSupabaseClient()

    console.log("=== CHECKING 2025 ==")

    const { data: allSales, error: salesError } = await supabase
        .from('sales_daily_cache')
        .select('store_id')
        .gte('business_date', '2025-01-01')
        .lte('business_date', '2025-12-31')

    if (salesError) {
        console.error("Error fetching sales data:", salesError)
        return
    }

    const uniqueStores = new Set(allSales?.map(s => s.store_id))
    console.log(`Tiendas en 2025 en la base de datos (${uniqueStores.size} totales):`)

    const { data: stores } = await supabase.from('stores').select('external_id, name')

    uniqueStores.forEach(id => {
        const matchingStore = stores?.find(s => s.external_id === id)
        console.log(`- ID: ${id} | Nombre BD: ${matchingStore?.name || 'DESCONOCIDO'}`)
    })
}

investigate()
