const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')

dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log("=== INSPECCIONANDO PMIX CACHE PARA 2026-07-25 ===")
    
    const { data: pmixRows, error: pmixError } = await supabase
        .from('pmix_daily_cache')
        .select('store_id, updated_at, items')
        .eq('business_date', '2026-07-25')

    if (pmixError) {
        console.error("Error al consultar pmix_daily_cache:", pmixError)
        return
    }

    const { data: stores } = await supabase.from('stores').select('external_id, name')
    const storeMap = new Map(stores?.map(s => [s.external_id, s.name]) || [])

    console.log(`Encontrados ${pmixRows?.length || 0} registros en pmix_daily_cache:`)
    for (const row of pmixRows || []) {
        const storeName = storeMap.get(row.store_id) || row.store_id
        const itemCount = Array.isArray(row.items) ? row.items.length : 0
        
        let totalNetSales = 0
        if (Array.isArray(row.items)) {
            totalNetSales = row.items.reduce((sum, item) => sum + (Number(item.net_sales) || 0), 0)
        }

        console.log(`- Tienda: ${String(storeName).padEnd(25)} | Items: ${String(itemCount).padStart(4)} | Total Ventas en PMIX: $${totalNetSales.toFixed(2).padStart(10)} | Creado/Modificado: ${row.updated_at}`)
    }

    console.log("\n=== INSPECCIONANDO FOOD COST CACHE PARA 2026-07-25 ===")
    
    const { data: fcRows, error: fcError } = await supabase
        .from('food_cost_daily_cache')
        .select('*')
        .eq('business_date', '2026-07-25')

    if (fcError) {
        console.error("Error al consultar food_cost_daily_cache:", fcError)
        return
    }

    if (fcRows && fcRows.length > 0) {
        console.log("Columnas en food_cost_daily_cache:", Object.keys(fcRows[0]))
    }


    let totalCost = 0
    let totalSales = 0
    
    fcRows?.forEach(row => {
        totalCost += Number(row.total_cost) || 0
        totalSales += Number(row.net_sales) || 0
    })

    const overallFc = totalSales > 0 ? (totalCost / totalSales) * 100 : 0
    console.log(`Food Cost Global Calculado (en caché de FC): ${overallFc.toFixed(2)}% (Costo: $${totalCost.toFixed(2)}, Ventas: $${totalSales.toFixed(2)})`)
    console.log(`Filas de costo en caché: ${fcRows?.length || 0}`)

    const storeFc = new Map()
    fcRows?.forEach(row => {
        const current = storeFc.get(row.store_id) || { cost: 0, sales: 0 }
        current.cost += Number(row.total_cost) || 0
        current.sales += Number(row.net_sales) || 0
        storeFc.set(row.store_id, current)
    })

    console.log("\nFood Cost por tienda:")
    for (const [storeId, stats] of storeFc.entries()) {
        const storeName = storeMap.get(storeId) || storeId
        const fc = stats.sales > 0 ? (stats.cost / stats.sales) * 100 : 0
        console.log(`- Tienda: ${String(storeName).padEnd(25)} | Costo: $${stats.cost.toFixed(2).padStart(9)} | Ventas: $${stats.sales.toFixed(2).padStart(10)} | FC: ${fc.toFixed(2).padStart(6)}%`)
    }
}

main().then(() => process.exit(0))
