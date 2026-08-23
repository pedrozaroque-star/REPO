/**
 * @module api/cron/integrity-check/route
 * @description Deep background scanner that audits the last 8 days of sales and labor in Supabase sales_daily_cache against live Toast POS API, auto-healing any drift exceeding $1.00.
 * @businessRules
 * - Audits completed historical days (yesterday backwards 8 days) in America/Los_Angeles timezone.
 * - Respects the 6:00 AM business day rollover boundary.
 * - Uses Full Precision Toast API data as the single source of truth.
 * - Heals discrepancies with complete granular payload (sales, labor, hourly curves, EBT).
 * @dataFlow
 * - Vercel Cron -> GET /api/cron/integrity-check -> Toast API (Full Precision) -> Compare sales_daily_cache -> Auto-Heal Batch Upsert -> Response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api'

export const maxDuration = 300 // 5 minutes timeout (Vercel Pro)
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization')
        if (process.env.CRON_SECRET) {
            if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        // Calcular Fechas en LA Time para evitar errores UTC
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        // Si es antes de las 6 AM, el día de ayer todavía no ha terminado contablemente
        if (laNow.getHours() < 6) {
            laNow.setDate(laNow.getDate() - 1)
        }

        // End Date = Yesterday (Last complete closed day)
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
            return NextResponse.json({ error: 'No data from Toast' }, { status: 502 })
        }

        console.log(`📊 [CRON INTEGRITY] Toast returned ${toastData.rows.length} rows. Comparing with DB...`)

        // 2. FETCH CURRENT DB STATE
        const supabase = await getSupabaseAdminClient()
        const { data: dbData, error: dbError } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .gte('business_date', startStr)
            .lte('business_date', endStr)

        if (dbError) throw dbError

        // Create Map for O(1) Lookup
        const dbMap = new Map()
        dbData?.forEach((r: any) => {
            dbMap.set(`${r.store_id}_${r.business_date}`, r)
        })

        let fixedCount = 0
        const logUpdates: string[] = []
        const healPayloads: any[] = []

        // 3. COMPARE AND HEAL
        for (const live of toastData.rows) {
            const key = `${live.storeId}_${live.periodStart}`
            const cached = dbMap.get(key)

            // STRICT TOLERANCES: Sales > $1.00 diff, Labor Cost > $1.00 diff
            const salesDiff = Math.abs((live.netSales || 0) - (cached?.net_sales || 0))
            const laborDiff = Math.abs((live.laborCost || 0) - (cached?.labor_cost || 0))

            const isMissing = !cached
            const needsFix = isMissing || salesDiff > 1.00 || laborDiff > 1.00

            if (needsFix) {
                healPayloads.push({
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
                    hourly_data: live.hourlySales || {},
                    hourly_tickets: live.hourlyTickets || {},
                    hourly_labor: live.hourlyLabor || {},
                    uber_sales: live.uberSales || 0,
                    doordash_sales: live.doordashSales || 0,
                    grubhub_sales: live.grubhubSales || 0,
                    ebt_count: live.ebtCount || 0,
                    ebt_amount: live.ebtAmount || 0,
                    updated_at: new Date().toISOString()
                })

                fixedCount++
                const issue = isMissing ? 'MISSING' : `DIFF(Sales:$${salesDiff.toFixed(2)}, Labor:$${laborDiff.toFixed(2)})`
                logUpdates.push(`[FIXED] ${live.storeName} ${live.periodStart}: ${issue}`)
            }
        }

        if (healPayloads.length > 0) {
            const { error: batchError } = await supabase
                .from('sales_daily_cache')
                .upsert(healPayloads, { onConflict: 'store_id,business_date' })

            if (batchError) {
                console.error("❌ [CRON INTEGRITY] Batch Upsert Error:", batchError)
            }
        }

        console.log(`✅ [CRON INTEGRITY] Completed. Healed ${fixedCount} records.`)

        return NextResponse.json({
            success: true,
            message: `Scanned 8 days. Healed ${fixedCount} records.`,
            scannedWindow: `${startStr} to ${endStr}`,
            recordsScanned: toastData.rows.length,
            correctionsMade: fixedCount,
            details: logUpdates.slice(0, 50)
        })

    } catch (e: any) {
        console.error("CRON Fatal Error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
