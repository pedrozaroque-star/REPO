const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')

dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log("=== ACTUALIZANDO TAMAÑOS DE BOLSA (PRESENTACIÓN DE CARNES) ===")

    // Definición de las nuevas presentaciones
    // Lengua y Cabeza: 2.5 lbs por bolsa
    // Pollo y Pastor: 5 lbs por bolsa
    const newSpecs = {
        'Pollo': { purchase_unit_cost: 7.50, quantity_per_unit: 5 },
        'Pastor': { purchase_unit_cost: 10.68, quantity_per_unit: 5 },
        'Lengua': { purchase_unit_cost: 21.00, quantity_per_unit: 2.5 },
        'Cabeza': { purchase_unit_cost: 19.92, quantity_per_unit: 2.5 }
    }

    const itemNames = Object.keys(newSpecs)

    // 1. Obtener los items correspondientes
    const { data: items, error: fetchErr } = await supabase
        .from('inventory_items')
        .select('id, name')
        .eq('is_bodega', false)
        .in('name', itemNames)

    if (fetchErr) {
        console.error("Error al buscar items en inventory_items:", fetchErr)
        return
    }

    // 2. Actualizar inventory_items y registrar el historial de precios para el 24 de julio
    for (const item of items) {
        const specs = newSpecs[item.name]
        
        console.log(`\nActualizando ${item.name}:`)
        console.log(`  - Poniendo costo de compra = $${specs.purchase_unit_cost}`)
        console.log(`  - Poniendo cantidad por unidad = ${specs.quantity_per_unit} lbs`)
        
        const { error: updErr } = await supabase
            .from('inventory_items')
            .update({
                purchase_unit_cost: specs.purchase_unit_cost,
                quantity_per_unit: specs.quantity_per_unit,
                updated_at: new Date().toISOString()
            })
            .eq('id', item.id)

        if (updErr) {
            console.error(`  ❌ Error al actualizar ${item.name} en inventory_items:`, updErr)
            continue
        }
        console.log(`  ✅ Item de inventario actualizado.`)

        // 3. Registrar el precio histórico para el 2026-07-24 (cuando cambió la bolsa física)
        // Eliminamos primero cualquier registro de ese mismo día/hora para evitar duplicados
        await supabase
            .from('inventory_price_history')
            .delete()
            .eq('inventory_item_id', item.id)
            .eq('effective_date', '2026-07-24T02:00:00.000Z')

        const { error: histErr } = await supabase
            .from('inventory_price_history')
            .insert({
                inventory_item_id: item.id,
                purchase_unit_cost: specs.purchase_unit_cost,
                effective_date: '2026-07-24T02:00:00.000Z' // Fecha histórica exacta de la transición
            })

        if (histErr) {
            console.error(`  ❌ Error al registrar precio histórico de $${specs.purchase_unit_cost} para ${item.name}:`, histErr)
        } else {
            console.log(`  ✅ Registro histórico guardado con fecha 2026-07-24.`)
        }
    }

    // 4. Borrar la caché de food_cost_daily_cache para el 24, 25 y 26 de julio
    console.log("\nBorrando el caché de food_cost_daily_cache para el 24, 25 y 26 de julio...")
    const datesToClear = ['2026-07-24', '2026-07-25', '2026-07-26']
    await supabase
        .from('food_cost_daily_cache')
        .delete()
        .in('business_date', datesToClear)

    console.log("✅ Caché borrada.")

    // 5. Recalcular el Food Cost llamando a la API
    console.log("\nEjecutando recálculo automático de Food Cost...")
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
    for (const date of datesToClear) {
        const apiUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`
        console.log(`🔄 Recalculando ${date}...`)
        try {
            const res = await fetch(apiUrl)
            if (!res.ok) {
                console.error(`  ❌ Falló la API para ${date}: HTTP ${res.status}`)
            } else {
                const json = await res.json()
                console.log(`  ✅ Completado para ${date}: ${json.data?.length || 0} registros de food cost regenerados.`)
            }
        } catch (fetchApiErr) {
            console.error(`  ❌ Error de conexión al recalcular ${date}:`, fetchApiErr.message || fetchApiErr)
        }
    }

    console.log("\n🏁 Proceso de actualización finalizado.")
}

main().then(() => process.exit(0)).catch(console.error)
