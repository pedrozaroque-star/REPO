/**
 * @module api/cron/sync-sales
 * @description Daily Vercel cron handler that synchronizes sales metrics from Toast API to the Supabase cache.
 * 
 * @businessRules
 * - **Ventana de Sincronización (Last 3 Days)**: Sincroniza los últimos 3 días de ventas para capturar ajustes tardíos de gerentes (Manager Edits), actualizaciones de reembolsos (Refunds) o transacciones anuladas (Voids).
 * - **Patrón Delete-before-insert (Borrado previo)**: Para evitar filas duplicadas o problemas de integridad referencial, el registro de caché de ventas para una fecha específica se elimina explícitamente antes de insertar los datos frescos recién obtenidos de Toast.
 * 
 * @dataFlow
 * - Invocación del endpoint -> Llama a `fetchToastData` (con `skipCache: true`) -> Elimina registros previos en `sales_daily_cache` -> Inserta las métricas frescas diarias en Supabase.
 * 
 * @notes
 * - Valida la firma del header `Authorization` usando el secreto `CRON_SECRET` provisto por Vercel Cron para asegurar el endpoint.
 */
import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        // Verificar firma de autorización (Opcional, recomendado para Vercel Cron)
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // Si no hay secreto configurado, permitir (modo dev/local), si safe.
            // Pero mejor retornamos 401 si se configura.
            if (process.env.CRON_SECRET) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        // Calcular los últimos 3 días para capturar ajustes de gerentes (Manager Edits)
        // 1. Obtener fecha actual en LA
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        const results = []
        const datesToSync: string[] = []
        for (let i = 1; i <= 3; i++) {
            const d = new Date(laNow)
            d.setDate(d.getDate() - i)
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            datesToSync.push(`${y}-${m}-${day}`)
        }
        console.log(`⏰ [CRON] Iniciando sincronización de ventas para: ${datesToSync.join(', ')}`)

        for (const dateStr of datesToSync) {
            try {
                // Ejecutar sincronización para cada día
                const { rows, connectionError } = await fetchToastData({
                    storeIds: 'all',
                    startDate: dateStr,
                    endDate: dateStr,
                    groupBy: 'day',
                    skipCache: true
                })

                if (connectionError) {
                    console.error(`❌ [CRON] Error conectando a Toast para ${dateStr}: ${connectionError}`)
                    results.push({ date: dateStr, success: false, error: connectionError })
                    continue
                }

                // --- SAVE TO SUPABASE ---
                if (rows.length > 0) {
                    const { createClient } = require('@supabase/supabase-js')
                    const supabase = createClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.SUPABASE_SERVICE_ROLE_KEY!
                    )

                    // 🛡️ REGLA: Borrar explícitamente el día antes de insertar
                    const { error: deleteError } = await supabase
                        .from('sales_daily_cache')
                        .delete()
                        .eq('business_date', dateStr)

                    if (deleteError) {
                        console.error(`❌ [CRON] Error borrando caché previa para ${dateStr}:`, deleteError)
                    }

                    const dbRows = rows.map(r => ({
                        store_id: r.storeId,
                        store_name: r.storeName || 'Unknown Store',
                        business_date: dateStr,
                        net_sales: r.netSales,
                        gross_sales: r.grossSales,
                        discounts: r.discounts,
                        tips: r.tips,
                        taxes: r.taxes,
                        service_charges: r.serviceCharges,
                        order_count: r.orderCount,
                        guest_count: r.guestCount,
                        labor_cost: r.laborCost,
                        labor_hours: r.totalHours,
                        hourly_data: r.hourlySales,
                        hourly_tickets: r.hourlyTickets,
                        hourly_labor: r.hourlyLabor,
                        uber_sales: r.uberSales || 0,
                        doordash_sales: r.doordashSales || 0,
                        grubhub_sales: r.grubhubSales || 0,
                        ebt_count: r.ebtCount || 0,
                        ebt_amount: r.ebtAmount || 0,
                        updated_at: new Date().toISOString()
                    }))

                    const { error: upsertError } = await supabase
                        .from('sales_daily_cache')
                        .upsert(dbRows, { onConflict: 'store_id,business_date' })

                    if (upsertError) {
                        console.error(`❌ [CRON] DB Save Error para ${dateStr}:`, upsertError)
                        results.push({ date: dateStr, success: false, error: upsertError.message })
                        continue
                    }
                    console.log(`💾 [CRON] Guardado en DB para ${dateStr}: ${dbRows.length} filas.`)
                    results.push({ date: dateStr, success: true, count: dbRows.length })
                } else {
                    results.push({ date: dateStr, success: true, count: 0 })
                }
            } catch (err: any) {
                console.error(`💥 [CRON] Error en día ${dateStr}:`, err)
                results.push({ date: dateStr, success: false, error: err.message })
            }
        }

        console.log(`✅ [CRON] Sincronización masiva completada.`)

        return NextResponse.json({
            success: true,
            results,
            processed_at: new Date().toISOString()
        })

    } catch (error: any) {
        console.error(`💥 [CRON] Error crítico total:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
