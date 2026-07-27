const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')

dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log("=== INSPECCIONANDO PRECIOS DE INGREDIENTES CLAVE ===")
    
    // Obtener ítems que contengan asada, pastor, pollo, cabeza, lengua, chorizo, carnitas, buche
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('is_bodega', false) // Restaurantes
        .or('name.ilike.%asada%,name.ilike.%pastor%,name.ilike.%pollo%,name.ilike.%cabeza%,name.ilike.%lengua%,name.ilike.%chorizo%,name.ilike.%carnitas%,name.ilike.%buche%')

    if (error) {
        console.error("Error al obtener inventory_items:", error)
        return
    }

    console.log(`Encontrados ${items.length} ítems en restaurantes:`)
    
    // Obtener mappings de QuickBooks para estos items
    const { data: mappings, error: mappingError } = await supabase
        .from('quickbooks_mappings')
        .select('*')
        .in('inventory_item_id', items.map(i => i.id))

    if (mappingError) {
        console.error("Error al obtener quickbooks_mappings:", mappingError)
        return
    }

    const mappingMap = new Map(mappings.map(m => [m.inventory_item_id, m]))

    for (const item of items) {
        const costPerUnit = item.quantity_per_unit > 0 ? (item.purchase_unit_cost / item.quantity_per_unit) : 0
        const mapInfo = mappingMap.get(item.id)
        const qbDetails = mapInfo ? `QB: ${mapInfo.qb_item_name} (ID: ${mapInfo.qb_item_id}) | Mult: ${mapInfo.multiplier} | MaxDrop: ${mapInfo.max_drop_percent}% | LastFetch: $${mapInfo.last_fetch_cost}` : 'NO MAPPED'
        console.log(`- ${item.name.padEnd(25)} | Costo/Unidad: $${costPerUnit.toFixed(4)} (${item.unit}) | ${qbDetails}`)
    }


    console.log("\n=== HISTORIAL DE PRECIOS PARA ESTOS ÍTEMS EN JULIO ===")
    const itemIds = items.map(i => i.id)
    
    const { data: history, error: historyError } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, effective_date, purchase_unit_cost')
        .in('inventory_item_id', itemIds)
        .order('effective_date', { ascending: false })
        .limit(30)


    if (historyError) {
        console.error("Error al obtener historial de precios:", historyError.message)
        return
    }

    const itemMap = new Map(items.map(i => [i.id, i.name]))
    console.log(`Encontradas ${history.length} entradas de historial en Julio:`)
    for (const row of history) {
        const itemName = itemMap.get(row.inventory_item_id) || `ID: ${row.inventory_item_id}`
        console.log(`- ${row.effective_date} | ${itemName.padEnd(35)} | Costo: $${String(row.purchase_unit_cost).padEnd(8)}`)
    }


}

main().then(() => process.exit(0))
