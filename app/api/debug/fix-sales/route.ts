
import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    // 1. HARDCODE TARGET DATE
    const TARGET_DATE = '2026-01-22'

    console.log(`🔧 [MANUAL FIX] Iniciando reparación para: ${TARGET_DATE}`)

    try {
        const supabase = await getSupabaseClient()

        // 2. DELETE OLD DATA
        console.log(`🗑️ Borrando datos corruptos...`)
        const { error: deleteError } = await supabase
            .from('sales_daily_cache')
            .delete()
            .eq('business_date', TARGET_DATE)

        if (deleteError) {
            throw new Error(`Error borrando: ${deleteError.message}`)
        }

        // 3. FETCH NEW DATA FROM TOAST
        console.log(`toast-api: Consultando Toast...`)
        const { rows, connectionError } = await fetchToastData({
            storeIds: 'all',
            startDate: TARGET_DATE,
            endDate: TARGET_DATE,
            groupBy: 'day'
        })

        if (connectionError) {
            throw new Error(`Error Toast: ${connectionError}`)
        }

        if (rows.length === 0) {
            return NextResponse.json({ message: '⚠️ Toast devolvió 0 filas. ¿Seguro que hay venta?' })
        }

        console.log(`✅ Toast devolvió ${rows.length} filas nuevas.`)

        // El cacheo (Guardado en DB) lo hace fetchToastData internamente? 
        // Revisemos lib/toast-api.ts. Si fetchToastData SOLO retorna filas pero no guarda (a veces es solo fetch),
        // necesitamos guardarlas.
        // PERO normalmente las funciones 'sync' hacen ambas cosas. 
        // Vamos a asumir que fetchToastData retorna las filas pero NO guarda si usamos la función base,
        // O revisamos si existe una función 'syncSales' de alto nivel.
        // Si fetchToastData es de bajo nivel, necesitamos hacer el upsert aquí.

        // 4. MAP TO DB COLUMNS (Api returns camelCase, DB needs snake_case)
        const dbRows = rows.map((r: any) => ({
            store_id: r.storeId,
            business_date: r.periodStart.split('T')[0], // Ensure YYYY-MM-DD
            net_sales: r.netSales,
            gross_sales: r.grossSales,
            discounts: r.discounts,
            tips: r.tips,
            taxes: r.taxes,
            service_charges: r.serviceCharges || 0,
            order_count: r.orderCount,
            guest_count: r.guestCount,
            labor_hours: 0, // Should be updated by sync-labor, setting 0 safe
            labor_cost: 0,
            uber_sales: r.uberSales || 0,
            doordash_sales: r.doordashSales || 0,
            grubhub_sales: r.grubhubSales || 0,
            ebt_count: r.ebtCount || 0,
            ebt_amount: r.ebtAmount || 0,
            hourly_data: r.hourlySales || {},
            updated_at: new Date().toISOString()
        }))

        // Upsert manual para asegurar
        const { error: upsertError } = await supabase
            .from('sales_daily_cache')
            .upsert(dbRows, { onConflict: 'store_id, business_date' })

        if (upsertError) throw upsertError

        return NextResponse.json({
            success: true,
            action: 'DELETE + RE-SYNC',
            date: TARGET_DATE,
            rows_recovered: rows.length,
            data: rows
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
