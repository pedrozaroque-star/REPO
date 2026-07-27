const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')

dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log("=== INICIANDO REPARACIÓN DE PRECIOS DE JULIO ===")

    // 1. Definir los precios correctos de restaurante
    const correctPrices = {
        'Pollo': 15.00,
        'Pastor': 21.36,
        'Lengua': 42.00,
        'Cabeza': 39.84
    }

    const itemNames = Object.keys(correctPrices)

    // 2. Obtener los registros de inventory_items correspondientes
    const { data: items, error: fetchErr } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost')
        .eq('is_bodega', false)
        .in('name', itemNames)

    if (fetchErr) {
        console.error("Error al buscar items en inventory_items:", fetchErr)
        return
    }

    console.log(`Encontrados ${items.length} items a reparar:`)
    const itemIds = items.map(i => i.id)

    // 3. Borrar del historial de precios (inventory_price_history) las entradas erróneas creadas el 24 de julio de 2026
    console.log("\nBorrando entradas de precios incorrectos en inventory_price_history del 2026-07-24...")
    const { data: deletedHistory, error: delHistErr } = await supabase
        .from('inventory_price_history')
        .delete()
        .in('inventory_item_id', itemIds)
        .gte('effective_date', '2026-07-24T00:00:00Z')
        .lte('effective_date', '2026-07-24T23:59:59Z')
        .select('*')

    if (delHistErr) {
        console.error("Error al borrar historial erróneo:", delHistErr)
    } else {
        console.log(`✅ Se borraron ${deletedHistory?.length || 0} registros de historial de precios erróneos.`)
        deletedHistory?.forEach(h => {
            const item = items.find(i => i.id === h.inventory_item_id)
            console.log(`  - Borrado: ${item?.name} | Precio: $${h.purchase_unit_cost} | Fecha: ${h.effective_date}`)
        })
    }

    // 4. Actualizar precios actuales en inventory_items
    console.log("\nActualizando precios actuales en inventory_items a los valores correctos...")
    for (const item of items) {
        const correctCost = correctPrices[item.name]
        const { error: updErr } = await supabase
            .from('inventory_items')
            .update({ purchase_unit_cost: correctCost, updated_at: new Date().toISOString() })
            .eq('id', item.id)

        if (updErr) {
            console.error(`❌ Error al actualizar precio para ${item.name}:`, updErr)
        } else {
            console.log(`✅ Precio restaurado: ${item.name} ($${item.purchase_unit_cost} ➡️ $${correctCost})`)
            
            // Insertar una nueva entrada de historial con el precio correcto hoy
            const { error: instHistErr } = await supabase
                .from('inventory_price_history')
                .insert({
                    inventory_item_id: item.id,
                    purchase_unit_cost: correctCost,
                    effective_date: new Date().toISOString()
                })

            if (instHistErr) {
                console.error(`❌ Error al registrar precio correcto en el historial para ${item.name}:`, instHistErr)
            } else {
                console.log(`  - Historial registrado con precio correcto de $${correctCost}`)
            }
        }
    }

    // 5. Borrar el caché de food_cost_daily_cache para el 24, 25 y 26 de julio de 2026
    console.log("\nBorrando el caché de food_cost_daily_cache para el 24, 25 y 26 de julio...")
    const datesToClear = ['2026-07-24', '2026-07-25', '2026-07-26']
    
    const { data: clearedCache, error: cacheErr } = await supabase
        .from('food_cost_daily_cache')
        .delete()
        .in('business_date', datesToClear)
        .select('*')

    if (cacheErr) {
        console.error("Error al borrar caché de food cost:", cacheErr)
    } else {
        console.log(`✅ Se borraron ${clearedCache?.length || 0} registros de caché de food cost para las fechas: ${datesToClear.join(', ')}`)
    }

    // 6. Recalcular el Food Cost llamando internamente a la API de food cost para las 3 fechas
    console.log("\nEjecutando recálculo automático de Food Cost para las fechas afectadas...")
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
    
    for (const date of datesToClear) {
        const apiUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`
        console.log(`🔄 Recalculando y reconstruyendo caché para ${date}...`)
        try {
            const res = await fetch(apiUrl)
            if (!res.ok) {
                console.error(`❌ Falló la API para la fecha ${date}: HTTP ${res.status}`)
            } else {
                const json = await res.json()
                console.log(`✅ Completado para ${date}: ${json.data?.length || 0} registros de food cost regenerados.`)
            }
        } catch (fetchApiErr) {
            console.error(`❌ Error de conexión al recalcular ${date}:`, fetchApiErr.message || fetchApiErr)
        }
    }

    console.log("\n🏁 Proceso de reparación de precios de Julio finalizado.")
}

main().then(() => process.exit(0)).catch(console.error)
