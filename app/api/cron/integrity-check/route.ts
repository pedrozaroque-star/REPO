
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api'

export const maxDuration = 300 // 5 minutes timeout (Vercel Pro)
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    try {
        // Calcular Fechas en LA Time para evitar errores UTC
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        // End Date = Yesterday (Last complete day)
        const endDate = new Date(laNow)
        endDate.setDate(endDate.getDate() - 1)

        // Start Date = 8 days ago
        const startDate = new Date(laNow)
        startDate.setDate(startDate.getDate() - 8)

        const y1 = startDate.getFullYear()
        const m1 = String(startDate.getMonth() + 1).padStart(2, '0')
        const d1 = String(startDate.getDate()).padStart(2, '0')
        const startStr = `${y1}-${m1}-${d1}`

        const y2 = endDate.getFullYear()
        const m2 = String(endDate.getMonth() + 1).padStart(2, '0')
        const d2 = String(endDate.getDate()).padStart(2, '0')
        const endStr = `${y2}-${m2}-${d2}`

        console.log(`🛡️ [CRON INTEGRITY] Starting Deep Scan: ${startStr} to ${endStr}`)

        // 1. MASSIVE FETCH TO TOAST (Absolute Truth)
        // We use skipCache=true to bypass our DB totally.
        const toastData = await fetchToastData({
            startDate: startStr,
            endDate: endStr,
            storeIds: 'all',
            groupBy: 'day',
            skipCache: true,
            fastMode: false // Full precision mode
        })

        if (!toastData.rows || toastData.rows.length === 0) {
            console.warn("⚠️ [CRON INTEGRITY] No data received from Toast API")
            return NextResponse.json({ error: 'No data from Toast' }, { status: 500 })
        }

        console.log(`📊 [CRON INTEGRITY] Toast returned ${toastData.rows.length} rows. Comparing with DB...`)

        // 2. FETCH CURRENT DB STATE
        const supabase = await getSupabaseClient()
        const { data: dbData, error: dbError } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .gte('business_date', startStr)
            .lte('business_date', endStr)

        if (dbError) throw dbError

        // Create Map for O(1) Lookup
        const dbMap = new Map()
        dbData?.forEach((r: any) => {
            // Key: StoreID_Date
            dbMap.set(`${r.store_id}_${r.business_date}`, r)
        })

        let fixedCount = 0
        const logUpdates: string[] = []

        // 3. COMPARE AND HEAL
        for (const live of toastData.rows) {
            const key = `${live.storeId}_${live.periodStart}`
            const cached = dbMap.get(key)

            // STRICT TOLERANCES
            // Sales > $1.00 diff
            // Labor Cost > $1.00 diff
            // We focus on COST for labor because hours can vary slightly with different rounding, but cost is money.

            const salesDiff = Math.abs((live.netSales || 0) - (cached?.net_sales || 0))
            const laborDiff = Math.abs((live.laborCost || 0) - (cached?.labor_cost || 0))

            const isMissing = !cached
            const needsFix = isMissing || salesDiff > 1.00 || laborDiff > 1.00

            if (needsFix) {
                // UPSERT Payload
                const payload = {
                    business_date: live.periodStart,
                    store_id: live.storeId,
                    store_name: live.storeName,
                    net_sales: live.netSales,
                    gross_sales: live.grossSales,
                    discounts: live.discounts,
                    tips: live.tips,
                    taxes: live.taxes,
                    service_charges: live.serviceCharges,
                    order_count: live.orderCount,
                    guest_count: live.guestCount,
                    labor_hours: live.totalHours,
                    labor_cost: live.laborCost,
                    hourly_data: live.hourlySales,
                    hourly_tickets: live.hourlyTickets,
                    uber_sales: live.uberSales || 0,
                    doordash_sales: live.doordashSales || 0,
                    grubhub_sales: live.grubhubSales || 0,
                    ebt_count: live.ebtCount || 0,
                    ebt_amount: live.ebtAmount || 0
                }

                const { error: upsertError } = await supabase
                    .from('sales_daily_cache')
                    .upsert(payload, { onConflict: 'business_date,store_id' })

                if (!upsertError) {
                    fixedCount++
                    const issue = isMissing ? 'MISSING' : `DIFF(Sales:$${salesDiff.toFixed(2)}, Labor:$${laborDiff.toFixed(2)})`
                    logUpdates.push(`[FIXED] ${live.storeName} ${live.periodStart}: ${issue}`)
                } else {
                    console.error(`❌ Failed to fix ${live.storeName}:`, upsertError)
                }
            }
        }

        console.log(`✅ [CRON INTEGRITY] Completed. Healed ${fixedCount} records. / Completado. ${fixedCount} registros corregidos.`)

        return NextResponse.json({
            success: true,
            message: `Scanned 7 days. Healed ${fixedCount} records. / Escaneados 7 dias. Corregidos ${fixedCount} registros.`,
            scannedWindow: `${startStr} to ${endStr}`,
            recordsScanned: toastData.rows.length,
            correctionsMade: fixedCount,
            details: logUpdates.slice(0, 50) // Limit output size
        })

    } catch (e: any) {
        console.error("CRON Fatal Error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
