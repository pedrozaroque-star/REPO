
import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowedRoles: ['admin'], allowCron: false })
    if (!auth.authorized) return auth.response!

    return NextResponse.json(
        {
            error: 'Operación destructiva bloqueada en GET. Use POST con { "confirm": "FIX_SALES_2026_01_22" } autenticado como admin.'
        },
        { status: 405 }
    )
}

export async function POST(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowedRoles: ['admin'], allowCron: false })
    if (!auth.authorized) return auth.response!

    const body = await request.json().catch(() => ({}))
    if (body?.confirm !== 'FIX_SALES_2026_01_22') {
        return NextResponse.json(
            { error: 'Confirmación explícita requerida: { "confirm": "FIX_SALES_2026_01_22" }' },
            { status: 400 }
        )
    }

    // 1. HARDCODE TARGET DATE
    const TARGET_DATE = '2026-01-22'

    console.log(`🔧 [MANUAL FIX] Iniciando reparación para: ${TARGET_DATE}`)

    try {
        const supabase = await getSupabaseClient()

        // Preserve existing labor_hours & labor_cost before deleting sales_daily_cache rows
        const { data: existingLaborRows } = await supabase
            .from('sales_daily_cache')
            .select('store_id, labor_hours, labor_cost, hourly_labor')
            .eq('business_date', TARGET_DATE)
        const existingLaborMap = new Map<string, { labor_hours: number; labor_cost: number; hourly_labor: any }>()
        for (const lr of existingLaborRows || []) {
            existingLaborMap.set(lr.store_id, {
                labor_hours: Number(lr.labor_hours || 0),
                labor_cost: Number(lr.labor_cost || 0),
                hourly_labor: lr.hourly_labor || null
            })
        }

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
        const dbRows = rows.map((r: any) => {
            const prevLabor = existingLaborMap.get(r.storeId)
            return {
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
                labor_hours: prevLabor ? prevLabor.labor_hours : 0,
                labor_cost: prevLabor ? prevLabor.labor_cost : 0,
                hourly_labor: prevLabor ? prevLabor.hourly_labor : null,
                uber_sales: r.uberSales || 0,
                doordash_sales: r.doordashSales || 0,
                grubhub_sales: r.grubhubSales || 0,
                ebt_count: r.ebtCount || 0,
                ebt_amount: r.ebtAmount || 0,
                hourly_data: r.hourlySales || {},
                updated_at: new Date().toISOString()
            }
        })

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
