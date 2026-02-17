
import { fetchToastData } from '../lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl!, supabaseServiceKey!)

/**
 * COMPREHENSIVE BACKFILL 2025 (Jan - Feb)
 * Relfills sales_daily_cache with FRESH data from Toast API.
 * Ensures Labor, Taxes, Tips, and Hourly data are captured.
 */
async function backfill2025() {
    const START_DATE = '2025-01-01'
    const END_DATE = '2025-02-28'

    console.log(`🚀 INICIANDO BACKFILL 2025 (${START_DATE} - ${END_DATE})`)
    console.log('Modo: Sequential Day-by-Day (Anti-Rate Limit)')
    console.log('Force Refresh: YES (Ignorando caché existente)')

    let current = new Date(START_DATE)
    const end = new Date(END_DATE)
    const storeIds = 'all' // Fetch all 15 stores

    let successCount = 0
    let errorCount = 0
    let filledRows = 0

    while (current <= end) {
        const dateStr = current.toISOString().split('T')[0]
        process.stdout.write(`📅 Procesando ${dateStr}... `)

        try {
            // 1. Fetch from Toast (Force Live)
            const result = await fetchToastData({
                storeIds: storeIds,
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day',
                skipCache: true // CRITICAL: Overwrite DB
            })

            if (result.connectionError) {
                console.log(`❌ Error de Conexión: ${result.connectionError}`)
                errorCount++
            } else {
                // 2. Validate Data Quality
                const validRows = result.rows.filter(r => r.netSales > 0)
                filledRows += validRows.length

                if (validRows.length === 0) {
                    console.log('⚠️ 0 Ventas (¿Cerrado?)')
                } else {
                    // Calculate total sales for log
                    const totalSales = validRows.reduce((sum, r) => sum + r.netSales, 0)
                    const totalLabor = validRows.reduce((sum, r) => sum + r.laborCost, 0)
                    console.log(`✅ Guardado (${validRows.length} tiendas). Ventas: $${(totalSales / 1000).toFixed(1)}k Labor: $${(totalLabor / 1000).toFixed(1)}k`)
                }
                successCount++
            }

        } catch (e: any) {
            console.log(`💥 Error Crítico: ${e.message}`)
            errorCount++
            // Wait longer on error
            await new Promise(r => setTimeout(r, 5000))
        }

        // NEXT DAY
        current.setDate(current.getDate() + 1)

        // PAUSE 2 SECONDS (To be very safe with Rate Limits)
        await new Promise(r => setTimeout(r, 2000))
    }

    console.log('\n🏁 BACKFILL COMPLETADO')
    console.log(`Días Procesados: ${successCount}`)
    console.log(`Errores: ${errorCount}`)
    console.log(`Total Registros Guardados: ${filledRows}`)
}

backfill2025()
