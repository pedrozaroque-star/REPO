/**
 * @module api/ventas/yearly/route
 * @description Provides annual monthly sales matrix aggregating 12-month net sales per store from Supabase sales_daily_cache, and provides list of available historical years.
 * @businessRules
 * - Enforces live-verified authentication (`getServerUser`) for admin, supervisor, and manager roles.
 * - Uses `America/Los_Angeles` business year (6:00 AM rule) instead of server UTC year.
 * - Paginates deterministically (`.range` + `.order`) so monthly queries never silently truncate at PostgREST's 1,000-row cap.
 * - Groups stores by canonical `store_id` (Toast GUID) mapped to `public.stores.name`, preventing store renames from splitting historical rows.
 * - Filters out mock, test, and placeholder stores and ignores $0 future rows in `mode=years`.
 * @dataFlow
 * - Client -> GET /api/ventas/yearly -> Supabase sales_daily_cache + stores -> Formatted JSON matrix.
 * @notes
 * - [2026-11-23] FIX CRÍTICO: (1) Auth vía `getServerUser(request)` validando `is_active`; (2) Año laboral LA en lugar de UTC; (3) Validación estricta de `year` y `limit_date`; (4) Paginación real `.range()` + manejo explícito de errores DB (nunca devuelve `$0` silencioso con HTTP 200); (5) Agrupación por `store_id` y filtro `.gt('net_sales', 0)` en `mode=years` para ocultar filas futuras `$0`.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth-server'
import { getBusinessDateLA, isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

const YEARLY_ALLOWED_ROLES = ['admin', 'administrador', 'supervisor', 'manager', 'gerente', 'general_manager']
const PAGE_SIZE = 1000

async function fetchAllMonthRows(
    supabase: any,
    startStr: string,
    endStr: string
): Promise<{ data: any[]; error: any }> {
    const allRows: any[] = []
    let page = 0
    while (true) {
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('store_id, store_name, business_date, net_sales')
            .gte('business_date', startStr)
            .lte('business_date', endStr)
            .order('business_date', { ascending: true })
            .order('store_id', { ascending: true })
            .range(from, to)

        if (error) return { data: [], error }
        if (!data || data.length === 0) break
        allRows.push(...data)
        if (data.length < PAGE_SIZE) break
        page++
    }
    return { data: allRows, error: null }
}

export async function GET(request: Request) {
    try {
        // 🛡️ SECURITY CHECK (live-verified active user + cookie/header support)
        const user = await getServerUser(request)
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const role = (user.role || '').trim().toLowerCase()
        if (!YEARLY_ALLOWED_ROLES.includes(role)) {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const mode = searchParams.get('mode')
        const businessDateLA = getBusinessDateLA()
        const currentYearLA = Number(businessDateLA.slice(0, 4))

        const supabase = await getSupabaseAdminClient()

        // ----------- MODO AÑOS DISPONIBLES -----------
        if (mode === 'years') {
            const promises = []
            for (let y = currentYearLA; y >= 2018; y--) {
                promises.push(
                    supabase
                        .from('sales_daily_cache')
                        .select('id')
                        .gte('business_date', `${y}-01-01`)
                        .lte('business_date', `${y}-12-31`)
                        .gt('net_sales', 0)
                        .limit(1)
                        .then(({ data, error }) => {
                            if (error) throw error
                            return { year: y, exists: Boolean(data && data.length > 0) }
                        })
                )
            }
            const results = await Promise.all(promises)
            const years = results.filter((r) => r.exists).map((r) => r.year)
            return NextResponse.json(years)
        }

        // ----------- MODO REPORTE ANUAL (MATRIX) -----------
        const yearParam = (searchParams.get('year') || String(currentYearLA)).trim()
        if (!/^\d{4}$/.test(yearParam)) {
            return NextResponse.json({ error: 'Invalid year parameter (4-digit YYYY required)' }, { status: 400 })
        }
        const yearNum = Number(yearParam)
        if (yearNum < 2018 || yearNum > currentYearLA + 1) {
            return NextResponse.json({ error: 'Year out of allowed range' }, { status: 400 })
        }

        const limitDateParam = (searchParams.get('limit_date') || '').trim()
        let limM: number | null = null
        let limD: number | null = null

        if (limitDateParam) {
            if (!isValidIsoDate(limitDateParam)) {
                return NextResponse.json({ error: 'Invalid limit_date (YYYY-MM-DD required)' }, { status: 400 })
            }
            const parts = limitDateParam.split('-').map(Number)
            limM = parts[1]
            limD = parts[2]
        }

        // Canonical store names lookup by external_id (Toast GUID)
        const { data: storesRows } = await supabase.from('stores').select('external_id, name')
        const canonicalNameByGuid = new Map<string, string>()
        storesRows?.forEach((st: any) => {
            if (st.external_id && st.name) {
                canonicalNameByGuid.set(String(st.external_id).trim().toLowerCase(), String(st.name).trim())
            }
        })

        const storeMap = new Map<string, { store_id: string; name: string; months: number[] }>()
        const monthPromises = []

        for (let m = 0; m < 12; m++) {
            const monthNum = m + 1
            const monthPad = String(monthNum).padStart(2, '0')
            const lastDayOfMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate()

            if (limM !== null && monthNum > limM) {
                monthPromises.push(Promise.resolve({ data: [], error: null }))
                continue
            }

            const startStr = `${yearParam}-${monthPad}-01`
            let endDay = String(lastDayOfMonth).padStart(2, '0')

            if (limM !== null && monthNum === limM && limD !== null) {
                endDay = String(Math.min(limD, lastDayOfMonth)).padStart(2, '0')
            }
            const endStr = `${yearParam}-${monthPad}-${endDay}`

            monthPromises.push(fetchAllMonthRows(supabase, startStr, endStr))
        }

        const results = await Promise.all(monthPromises)

        // Never silently swallow DB errors and return $0 with HTTP 200
        const failedMonthIdx = results.findIndex((chunk) => Boolean(chunk.error))
        if (failedMonthIdx !== -1) {
            console.error(`❌ Error fetching Month ${failedMonthIdx + 1}:`, results[failedMonthIdx].error?.message)
            return NextResponse.json(
                { error: 'Failed to load complete yearly sales data' },
                { status: 502 }
            )
        }

        let totalRowsFetched = 0

        results.forEach((chunk, monthIdx) => {
            const rows = chunk.data || []
            totalRowsFetched += rows.length

            rows.forEach((row: any) => {
                const rawSid = String(row.store_id || '').trim()
                const normSid = rawSid.toLowerCase()
                const fallbackName = String(row.store_name || '').trim() || 'Unknown'
                const canonicalName = canonicalNameByGuid.get(normSid) || fallbackName
                const groupKey = normSid || canonicalName.toLowerCase()

                let entry = storeMap.get(groupKey)
                if (!entry) {
                    entry = {
                        store_id: rawSid || canonicalName,
                        name: canonicalName,
                        months: Array(12).fill(0),
                    }
                    storeMap.set(groupKey, entry)
                }

                entry.months[monthIdx] += Number(row.net_sales || 0)
            })
        })

        const result = Array.from(storeMap.values())
            .map((entry) => {
                const total = entry.months.reduce((a, b) => a + b, 0)
                return {
                    store_id: entry.store_id,
                    name: entry.name,
                    months: entry.months,
                    total,
                }
            })
            .filter((r) => {
                const n = r.name.toLowerCase()
                if (n.includes('mock')) return false
                if (n.includes('test')) return false
                if (n.includes('example')) return false
                if (n === 'unknown') return false
                // Exclude ghost $0-only stores (e.g. from pre-seeded future rows)
                if (r.total === 0 && r.months.every((v) => v === 0)) return false
                return true
            })
            .sort((a, b) => b.total - a.total)

        return NextResponse.json({
            data: result,
            meta: {
                strategy: 'paginated_parallel_monthly_fetch',
                year: yearParam,
                limitDate: limitDateParam || null,
                totalRowsFetched,
                timestamp: new Date().toISOString(),
            },
        })
    } catch (error: any) {
        console.error('Yearly Sales API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
