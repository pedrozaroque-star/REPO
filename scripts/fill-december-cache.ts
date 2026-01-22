/**
 * Script para rellenar la caché de Supabase con datos de diciembre 2025
 * 
 * Este script procesa DÍA POR DÍA mostrando el estatus en tiempo real
 * 
 * Uso:
 *   npx tsx scripts/fill-december-cache.ts
 */

import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseClient } from '@/lib/supabase'

async function fillDecemberCache() {
    console.log('🚀 Iniciando script de rellenado de caché para Diciembre 2025...\n')

    try {
        // 1. Usar 'all' para obtener todas las tiendas (igual que en el módulo VENTAS que funciona)
        const storeIds = 'all'  // Cambiado para usar TODAS las tiendas
        console.log(`🏪 Store IDs: ${storeIds} (15 tiendas)`)
        console.log(`📅 Mes: Diciembre 2025`)
        console.log(`🔄 Modo: Día por día\n`)
        console.log('━'.repeat(80))

        const supabase = await getSupabaseClient()

        // 2. Generar todos los días de diciembre
        const days: string[] = []
        for (let day = 1; day <= 31; day++) {
            const dateStr = `2025-12-${String(day).padStart(2, '0')}`
            days.push(dateStr)
        }

        console.log(`\n📊 Total de días a procesar: ${days.length}\n`)

        // Contadores globales
        let successCount = 0
        let errorCount = 0
        let totalNetSales = 0
        let totalUber = 0
        let totalDoorDash = 0
        let totalGrubHub = 0
        let totalEBT = 0

        // 3. Procesar cada día individualmente
        for (let i = 0; i < days.length; i++) {
            const dateStr = days[i]
            const dayNum = i + 1

            console.log(`\n[${'#'.repeat(Math.floor((dayNum / days.length) * 50))}${' '.repeat(50 - Math.floor((dayNum / days.length) * 50))}] ${dayNum}/31`)
            console.log(`📅 Procesando: ${dateStr}`)

            try {
                // 3a. Consultar Toast para este día específico (usando 'all' como en VENTAS)
                console.log(`   ⏳ Consultando Toast API...`)
                const { rows, connectionError } = await fetchToastData({
                    storeIds: 'all',  // USAR 'all' como en el módulo de VENTAS
                    startDate: dateStr,
                    endDate: dateStr,
                    groupBy: 'day'
                })

                if (connectionError) {
                    console.log(`   ❌ Error de conexión: ${connectionError}`)
                    errorCount++
                    continue
                }

                if (rows.length === 0) {
                    console.log(`   ⚠️  Sin datos (posible día sin ventas o fuera de rango)`)
                    errorCount++
                    continue
                }

                console.log(`   ✅ Obtenidos ${rows.length} registros (posiblemente horarios)`)

                // DEBUG: Imprimir el primer registro para ver qué demonios tiene
                if (rows.length > 0) {
                    console.log('   🔍 PRIMER REGISTRO (MUESTRA):', JSON.stringify(rows[0], null, 2))
                }

                // 3b. AGREGACIÓN MANUAL (Fix para cuando fetchToastData devuelve horas en lugar de día único)
                // Agrupar por store_id para consolidar las 24 horas en 1 solo registro diario
                const dailyAggregation = new Map<string, any>()

                for (const row of rows) {
                    const storeId = row.storeId
                    if (!dailyAggregation.has(storeId)) {
                        dailyAggregation.set(storeId, {
                            store_id: row.storeId,
                            store_name: row.storeName,
                            business_date: dateStr, // Forzamos la fecha del día procesado
                            net_sales: 0,
                            gross_sales: 0,
                            discounts: 0,
                            tips: 0,
                            taxes: 0,
                            service_charges: 0,
                            order_count: 0,
                            guest_count: 0,
                            labor_hours: 0,
                            labor_cost: 0,
                            hourly_data: {},
                            uber_sales: 0,
                            doordash_sales: 0,
                            grubhub_sales: 0,
                            ebt_count: 0,
                            ebt_amount: 0
                        })
                    }

                    const agg = dailyAggregation.get(storeId)

                    // Sumar métricas
                    agg.net_sales += row.netSales || 0
                    agg.gross_sales += row.grossSales || 0
                    agg.discounts += row.discounts || 0
                    agg.tips += row.tips || 0
                    agg.taxes += row.taxes || 0
                    agg.service_charges += row.serviceCharges || 0
                    agg.order_count += row.orderCount || 0
                    agg.guest_count += row.guestCount || 0
                    agg.labor_hours += row.totalHours || 0
                    agg.labor_cost += row.laborCost || 0
                    agg.uber_sales += row.uberSales || 0
                    agg.doordash_sales += row.doordashSales || 0
                    agg.grubhub_sales += row.grubhubSales || 0
                    agg.ebt_count += row.ebtCount || 0
                    agg.ebt_amount += row.ebtAmount || 0

                    // Combinar Hourly Data: hourlySales viene con keys 0-23
                    // Si row es horario, row.hourlySales podría tener solo esa hora o estar vacío
                    // Si row tiene hourlySales poblado, lo fusionamos
                    if (row.hourlySales) {
                        for (const [hour, amount] of Object.entries(row.hourlySales)) {
                            const h = parseInt(hour)
                            agg.hourly_data[h] = (agg.hourly_data[h] || 0) + (amount as number)
                        }
                    }
                }

                const consolidatedRows = Array.from(dailyAggregation.values())
                console.log(`   ✅ Consolidados en ${consolidatedRows.length} registros diarios (1 por tienda)`)

                // 3c. Procesar cada tienda consolidada
                for (const cacheRecord of consolidatedRows) {

                    // 3d. Guardar en Supabase
                    const { error } = await supabase
                        .from('sales_daily_cache')
                        .upsert([cacheRecord], {
                            onConflict: 'store_id,business_date'
                        })

                    // Si es Lynwood (dc5dd3b4...), sumar a totales de reporte
                    if (!error && cacheRecord.store_id === 'dc5dd3b4-71fa-4b41-9e32-0e6e83ebdbd4') {
                        totalNetSales += cacheRecord.net_sales
                        totalUber += cacheRecord.uber_sales
                        totalDoorDash += cacheRecord.doordash_sales
                        totalGrubHub += cacheRecord.grubhub_sales
                        totalEBT += cacheRecord.ebt_count

                        // Loguear solo 1 vez por día para Lynwood
                        console.log(`   📊 Lynwood - Net: $${cacheRecord.net_sales.toFixed(2)}, Órdenes: ${cacheRecord.order_count}`)
                        if (cacheRecord.uber_sales > 0) console.log(`      Uber: $${cacheRecord.uber_sales.toFixed(2)}`)
                    }
                }

                successCount++
                // Pequeña pausa
                await new Promise(resolve => setTimeout(resolve, 500))

            } catch (dayError: any) {
                console.log(`   ❌ Error procesando día: ${dayError.message}`)
                errorCount++
            }
        }

        // 4. Resumen final
        console.log('\n' + '━'.repeat(80))
        console.log('\n✅ PROCESO COMPLETADO\n')
        console.log(`📊 Resumen:`)
        console.log(`   Días procesados exitosamente: ${successCount}`)
        console.log(`   Días con errores: ${errorCount}`)
        console.log(`   Total de días: ${days.length}`)
        console.log(`\n💰 Totales del mes (Lynwood):`)
        console.log(`   Net Sales: $${totalNetSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
        console.log(`   Uber/Postmates: $${totalUber.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
        console.log(`   DoorDash: $${totalDoorDash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
        console.log(`   GrubHub: $${totalGrubHub.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
        console.log(`   EBT Transacciones: ${totalEBT}`)
        console.log(`\n🎉 Caché de Diciembre 2025 actualizada para todas las tiendas\n`)

    } catch (error: any) {
        console.error('\n❌ Error durante el proceso:', error.message)
        console.error(error.stack)
        process.exit(1)
    }
}

// Ejecutar script
fillDecemberCache()
    .then(() => {
        console.log('🏁 Script finalizado')
        process.exit(0)
    })
    .catch((error) => {
        console.error('💥 Error fatal:', error)
        process.exit(1)
    })
