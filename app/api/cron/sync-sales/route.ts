
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

        // Calcular AYER (Fecha de cierre) CORRECTAMENTE en LA TIME
        // 1. Obtener fecha actual en LA
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        // 2. Regla de Negocio: El día "operativo" termina a las 4 AM o 6 AM?
        // Si son las 2 AM del Miercoles, todavía estamos cerrando Martes.
        // Pero este CRON corre usualmente a las 6 AM o 7 AM UTC (que es ~11 PM LA anterior o 12 AM).
        // A las 12 PM UTC (4 AM LA), todavía es "madrugada".

        // SIMPLIFICACIÓN ROBUSTA:
        // Si el cron corre a las 14:00 UTC (6 AM LA), queremos sincronizar AYER.
        // Si son las 6 AM del Miercoles 12, queremos sync Martes 11.

        const yesterday = new Date(laNow)
        yesterday.setDate(yesterday.getDate() - 1)
        const y = yesterday.getFullYear()
        const m = String(yesterday.getMonth() + 1).padStart(2, '0')
        const d = String(yesterday.getDate()).padStart(2, '0')
        const dateStr = `${y}-${m}-${d}`

        console.log(`⏰ [CRON] Iniciando sincronización de ventas para: ${dateStr}`)

        // Ejecutar sincronización
        const { rows, connectionError } = await fetchToastData({
            storeIds: 'all',
            startDate: dateStr,
            endDate: dateStr,
            groupBy: 'day',
            skipCache: true
        })

        if (connectionError) {
            console.error(`❌ [CRON] Error conectando a Toast: ${connectionError}`)
            return NextResponse.json({ error: connectionError }, { status: 502 })
        }

        // --- SAVE TO SUPABASE ---
        if (rows.length > 0) {
            const { createClient } = require('@supabase/supabase-js')
            const supabase = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
            )

            const dbRows = rows.map(r => ({
                store_id: r.storeId,
                store_name: r.storeName,
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
                console.error(`❌ [CRON] DB Save Error:`, upsertError)
                throw new Error(`DB Save Failed: ${upsertError.message}`)
            }
            console.log(`💾 [CRON] Guardado en DB: ${dbRows.length} filas.`)
        }
        // ------------------------

        console.log(`✅ [CRON] Sincronización exitosa: ${rows.length} registros guardados/actualizados.`)

        return NextResponse.json({
            success: true,
            date: dateStr,
            records_processed: rows.length,
            message: `Ventas del ${dateStr} guardadas correctamente en caché.`
        })

    } catch (error: any) {
        console.error(`💥 [CRON] Error crítico:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
