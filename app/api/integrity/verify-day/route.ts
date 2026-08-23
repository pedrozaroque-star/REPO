/**
 * @module api/integrity/verify-day/route
 * @description Verifies sales and labor integrity between live Toast API data and Supabase sales_daily_cache, auto-healing any data drift silently.
 * @businessRules
 * - Checks past closed dates (e.g. Yesterday) against live Toast POS API ignoring cache.
 * - Auto-heals discrepancies exceeding $5.00 in Net Sales or Labor.
 * - Preserves complete granular hourly sales, tickets, labor curves, and EBT amounts during healing.
 * - Requires authenticated user with admin, supervisor, or manager role.
 * @dataFlow
 * - Client -> POST /api/integrity/verify-day -> Toast API (skipCache) -> Compare Supabase -> Auto-Heal Upsert -> Response.
 * @notes Protected by Supabase Admin Client for safe database write operations.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api'
import { verifyAuthToken } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    try {
        // Authenticate request
        const authHeader = req.headers.get('Authorization')
        const cookieToken = req.cookies.get('teg_token')?.value
        const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : cookieToken

        if (!token) {
            return NextResponse.json({ error: 'Missing Authentication Token' }, { status: 401 })
        }

        const user = verifyAuthToken(token)
        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        if (user.user_role !== 'admin' && user.user_role !== 'supervisor' && user.user_role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

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
            fastMode: false // Using Full Precision Mode for maximum safety
        })

        if (!toastData.rows || toastData.rows.length === 0) {
            return NextResponse.json({ status: 'error', message: 'No data received from Toast' }, { status: 502 })
        }

        // 2. Fetch CACHED Data
        const supabase = await getSupabaseAdminClient()
        const { data: cachedRows } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('business_date', date)

        const cacheMap = new Map()
        cachedRows?.forEach((r: any) => cacheMap.set(r.store_id, r))

        // 3. Compare & Heal
        const fixedStores: string[] = []
        const toHealPayloads: any[] = []

        for (const liveRow of toastData.rows) {
            const cached = cacheMap.get(liveRow.storeId)

            // Tolerances: Sales $5.00, Labor $5.00
            const salesDiff = Math.abs((liveRow.netSales || 0) - (cached?.net_sales || 0))
            const laborDiff = Math.abs((liveRow.laborCost || 0) - (cached?.labor_cost || 0))

            if (!cached || salesDiff > 5.00 || laborDiff > 5.00) {
                console.warn(`⚠️ [INTEGRITY] Discrepancy found for ${liveRow.storeName}:`)
                console.warn(`   Sales: Live $${liveRow.netSales} vs Cache $${cached?.net_sales} (Diff: $${salesDiff})`)
                console.warn(`   Labor: Live $${liveRow.laborCost} vs Cache $${cached?.labor_cost} (Diff: $${laborDiff})`)

                // HEAL IT: Complete payload with all columns preserved
                toHealPayloads.push({
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
                    grubhub_sales: liveRow.grubhubSales || 0,
                    ebt_count: liveRow.ebtCount || 0,
                    ebt_amount: liveRow.ebtAmount || 0,
                    hourly_data: liveRow.hourlySales || {},
                    hourly_tickets: liveRow.hourlyTickets || {},
                    hourly_labor: liveRow.hourlyLabor || {},
                    updated_at: new Date().toISOString()
                })
                fixedStores.push(liveRow.storeName)
            }
        }

        if (toHealPayloads.length > 0) {
            const { error: healError } = await supabase
                .from('sales_daily_cache')
                .upsert(toHealPayloads, { onConflict: 'store_id,business_date' })

            if (healError) {
                console.error("Failed to heal cache batch:", healError)
            }
        }

        // 4. Construct Fresh Data Payload (to update UI silently)
        const summary = {
            netSales: 0,
            grossSales: 0,
            discounts: 0,
            tips: 0,
            laborCost: 0,
            laborHours: 0,
            orders: 0,
            guests: 0
        }

        // Use the FRESH live data (toastData.rows) which is now the source of truth
        toastData.rows.forEach((r: any) => {
            summary.netSales += r.netSales || 0
            summary.grossSales += r.grossSales || 0
            summary.discounts += r.discounts || 0
            summary.tips += r.tips || 0
            summary.laborCost += r.laborCost || 0
            summary.laborHours += r.totalHours || 0
            summary.orders += r.orderCount || 0
            summary.guests += r.guestCount || 0
        })

        // Hourly aggregation
        const hourlyData: Record<number, number> = {}
        const hourlyTickets: Record<number, number> = {}

        toastData.rows.forEach((r: any) => {
            if (r.hourlySales) {
                Object.entries(r.hourlySales).forEach(([h, val]) => {
                    const hour = Number(h)
                    hourlyData[hour] = (hourlyData[hour] || 0) + Number(val)
                })
            }
            if (r.hourlyTickets) {
                Object.entries(r.hourlyTickets).forEach(([h, val]) => {
                    const hour = Number(h)
                    hourlyTickets[hour] = (hourlyTickets[hour] || 0) + Number(val)
                })
            }
        })

        const freshDataPayload = {
            summary,
            data: toastData.rows.map((r: any) => ({
                ...r,
                labor_cost: r.laborCost,
                labor_hours: r.totalHours,
                net_sales: r.netSales
            })),
            hourlyData,
            hourlyTickets
        }

        if (toHealPayloads.length > 0) {
            console.log(`✅ [INTEGRITY] Healed ${toHealPayloads.length} stores: ${fixedStores.join(', ')}`)
            return NextResponse.json({
                status: 'corrected',
                fixed: fixedStores,
                message: `Corregidas discrepancias en: ${fixedStores.join(', ')}`,
                freshData: freshDataPayload
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
