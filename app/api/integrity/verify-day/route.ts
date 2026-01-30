
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { date, storeIds } = body

        if (!date) return NextResponse.json({ error: 'Date required' }, { status: 400 })

        console.log(`🕵️ [INTEGRITY] Verifying integrity for ${date} (Stores: ${storeIds || 'All'})...`)

        // 1. Fetch CURRENT Toast Data (Live) ignoring cache
        const toastData = await fetchToastData({
            startDate: date,
            endDate: date,
            storeIds: storeIds || 'all',
            groupBy: 'day',
            skipCache: true, // FORCE LIVE FETCH
            fastMode: true // We only need totals for comparison (Sales/Labor)
        })

        if (!toastData.rows || toastData.rows.length === 0) {
            return NextResponse.json({ status: 'error', message: 'No data received from Toast' })
        }

        // 2. Fetch CACHED Data
        const supabase = await getSupabaseClient()
        const { data: cachedRows } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('business_date', date)

        const cacheMap = new Map()
        cachedRows?.forEach((r: any) => cacheMap.set(r.store_id, r))

        // 3. Compare & Heal
        const fixedStores: string[] = []
        let correctionsMade = 0

        for (const liveRow of toastData.rows) {
            const cached = cacheMap.get(liveRow.storeId)

            // Tolerances: Sales $5.00, Labor 0.1 hrs
            const salesDiff = Math.abs((liveRow.netSales || 0) - (cached?.net_sales || 0))
            const laborDiff = Math.abs((liveRow.laborCost || 0) - (cached?.labor_cost || 0)) // Using cost as hours can be tricky with rounding

            if (!cached || salesDiff > 5.00 || laborDiff > 5.00) {
                console.warn(`⚠️ [INTEGRITY] Discrepancy found for ${liveRow.storeName}:`)
                console.warn(`   Sales: Live $${liveRow.netSales} vs Cache $${cached?.net_sales} (Diff: $${salesDiff})`)
                console.warn(`   Labor: Live $${liveRow.laborCost} vs Cache $${cached?.labor_cost} (Diff: $${laborDiff})`)

                // HEAL IT
                // Upsert into Supabase
                const payload = {
                    business_date: date,
                    store_id: liveRow.storeId,
                    store_name: liveRow.storeName,
                    net_sales: liveRow.netSales,
                    gross_sales: liveRow.grossSales,
                    discounts: liveRow.discounts,
                    tips: liveRow.tips,
                    taxes: liveRow.taxes,
                    service_charges: liveRow.serviceCharges,
                    order_count: liveRow.orderCount,
                    guest_count: liveRow.guestCount,
                    labor_hours: liveRow.totalHours,
                    labor_cost: liveRow.laborCost,
                    uber_sales: liveRow.uberSales || 0,
                    doordash_sales: liveRow.doordashSales || 0,
                    grubhub_sales: liveRow.grubhubSales || 0
                }

                const { error } = await supabase
                    .from('sales_daily_cache')
                    .upsert(payload, { onConflict: 'business_date,store_id' })

                if (!error) {
                    fixedStores.push(liveRow.storeName)
                    correctionsMade++
                } else {
                    console.error("Failed to heal cache:", error)
                }
            }
        }

        if (correctionsMade > 0) {
            console.log(`✅ [INTEGRITY] Healed ${correctionsMade} stores: ${fixedStores.join(', ')}`)
            return NextResponse.json({
                status: 'corrected',
                fixed: fixedStores,
                message: `Corregidas discrepancias en: ${fixedStores.join(', ')}`
            })
        } else {
            console.log(`✅ [INTEGRITY] Integrity Verified. No drift detected.`)
            return NextResponse.json({ status: 'ok', message: 'Datos verificados (Sincronizados)' })
        }

    } catch (e: any) {
        console.error("Integrity Check Failed:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
