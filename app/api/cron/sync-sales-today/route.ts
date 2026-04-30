import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'

// Maximum timeout for Vercel Hobby/Pro, but we'll try to process what we can
export const maxDuration = 300 

export async function GET(request: Request) {
    try {
        // Verificar firma de autorización (Opcional, recomendado para Vercel Cron)
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // Si no hay secreto configurado, permitir (modo dev/local), si safe.
            if (process.env.CRON_SECRET) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        // Obtener fecha actual en LA (Día de "Hoy" según la regla de negocio)
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
        
        const currentHour = laNow.getHours()

        // Restricción de horario: Solo correr entre las 7 AM y las 11:59 PM
        // currentHour va de 0 a 23. Así que requerimos currentHour >= 7.
        if (currentHour < 7) {
            console.log(`⏳ [CRON TODAY] Ejecución omitida. Fuera de horario operativo (7am-11:59pm). Hora actual LA: ${currentHour}:00`)
            return NextResponse.json({ success: true, message: 'Skipped: Outside operating hours' })
        }

        // Regla de las 6 AM: si es antes de las 6 AM, sigue siendo el "hoy" operativo del día anterior
        // (Aunque con la regla anterior, currentHour < 7 ya lo omite, mantenemos la lógica por robustez)
        if (currentHour < 6) {
            laNow.setDate(laNow.getDate() - 1)
        }

        const y = laNow.getFullYear()
        const m = String(laNow.getMonth() + 1).padStart(2, '0')
        const day = String(laNow.getDate()).padStart(2, '0')
        const todayStr = `${y}-${m}-${day}`

        console.log(`⏰ [CRON TODAY] Iniciando sincronización de ventas intra-día para: ${todayStr}`)

        // Ejecutar sincronización en FULL MODE para asegurar precisión
        const { rows, connectionError } = await fetchToastData({
            storeIds: 'all',
            startDate: todayStr,
            endDate: todayStr,
            groupBy: 'day',
            skipCache: true,
            fastMode: false,
            readOnly: false // Queremos que la función haga el Write-Back a la BD o nosotros lo hacemos explícito abajo
        })

        if (connectionError) {
            console.error(`❌ [CRON TODAY] Error conectando a Toast para ${todayStr}: ${connectionError}`)
            return NextResponse.json({ success: false, error: connectionError }, { status: 502 })
        }

        // --- SAVE TO SUPABASE ---
        // Forzamos el guardado explícitamente igual que el cron original, para cumplir la regla
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
                .eq('business_date', todayStr)

            if (deleteError) {
                console.error(`❌ [CRON TODAY] Error borrando caché previa para ${todayStr}:`, deleteError)
            }

            const dbRows = rows.map(r => ({
                store_id: r.storeId,
                store_name: r.storeName || 'Unknown Store',
                business_date: todayStr,
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
                console.error(`❌ [CRON TODAY] DB Save Error para ${todayStr}:`, upsertError)
                return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 })
            }
            console.log(`💾 [CRON TODAY] Guardado en DB para ${todayStr}: ${dbRows.length} filas.`)
        }

        console.log(`✅ [CRON TODAY] Sincronización de 'Hoy' completada.`)

        return NextResponse.json({
            success: true,
            date: todayStr,
            count: rows.length,
            processed_at: new Date().toISOString()
        })

    } catch (error: any) {
        console.error(`💥 [CRON TODAY] Error crítico:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
