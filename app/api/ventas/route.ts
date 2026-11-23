/**
 * @module api/ventas/route
 * @description Primary analytics API endpoint fetching sales, labor, and delivery channel metrics from Toast POS with dynamic AI Forecast (Intelligence v3.1) integration.
 * @businessRules
 * - Enforces live-verified authentication and authorization (`getServerUser`) for admin, supervisor, and manager roles.
 * - Dynamic granularity guard: prevents client crashes by forcing weekly aggregation on ranges exceeding 95 days when daily granularity is requested (preserving daily granularity for Quarter filters).
 * - Intraday projections cache lookup with automatic Intelligence v3.1 fallback generation, concurrency throttling, and batched upsert into `sales_projections_cache`.
 * - Preserves manual overrides (`meta.manual_override === true`) and $0 closed-holiday projections without overwriting them.
 * @dataFlow
 * - Client -> GET /api/ventas -> Toast API / sales_daily_cache -> Smart Forecast Engine -> JSON Response.
 * @notes
 * - [2026-11-23] FIX CRÍTICO: (1) Auth vía `getServerUser(request)` soportando cookie `teg_token` + header `Authorization` + verificación en vivo de `is_active`; (2) Validación estricta de fechas ISO, allowlist de `groupBy` y límite anti-DoS en `skipCache`; (3) Límite de concurrencia (lotes de 6) + upsert en lote único para `sales_projections_cache`; (4) Coerción `Number(total_sales)`, preservación estricta de `manual_override` y rechazo de cachés corruptos `$0` no cerrados; (5) Granularity Guard ampliado a 95 días para soportar filtro de día/hora en Trimestre.
 */

import { NextResponse } from 'next/server'
import { fetchToastData, ToastMetricsOptions } from '@/lib/toast-api'
import { getServerUser } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { diffCalendarDays, isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

const VENTAS_ALLOWED_ROLES = ['admin', 'administrador', 'supervisor', 'manager', 'gerente', 'general_manager']
const ALLOWED_GROUP_BY = new Set(['hour', 'day', 'week', 'month', 'year'])

function isUsableCachedProjection(cached: any): boolean {
    if (!cached || !cached.meta) return false
    const totalSales = Number(cached.total_sales ?? 0)
    // Always honor explicit manual overrides regardless of model version
    if (cached.meta.manual_override === true) return Number.isFinite(totalSales)
    if (cached.meta.model !== 'Intelligence v3.1') return false
    // Allow $0 only when explicitly marked as closed holiday
    if (totalSales <= 0 && cached.meta.closed !== true) return false
    return Number.isFinite(totalSales)
}

export async function GET(request: Request) {
    try {
        // 1. Live-verified Auth (Authorization Bearer OR teg_token cookie + DB is_active check)
        const user = await getServerUser(request)
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const role = (user.role || '').trim().toLowerCase()
        if (!VENTAS_ALLOWED_ROLES.includes(role)) {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        // 2. Validate query params
        const { searchParams } = new URL(request.url)
        const storeIds = (searchParams.get('storeIds') || 'all').trim() || 'all'
        const startDate = (searchParams.get('startDate') || '').trim()
        const endDate = (searchParams.get('endDate') || '').trim()
        const rawGroupBy = (searchParams.get('groupBy') || 'day').trim().toLowerCase()
        const requestedSkipCache = searchParams.get('skipCache') === 'true'

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 })
        }
        if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
            return NextResponse.json({ error: 'Invalid date range (YYYY-MM-DD required, startDate <= endDate)' }, { status: 400 })
        }

        const groupBy = (ALLOWED_GROUP_BY.has(rawGroupBy) ? rawGroupBy : 'day') as ToastMetricsOptions['groupBy'] | 'hour'
        const dayDiff = diffCalendarDays(startDate, endDate)

        // Guard skipCache against DoS on massive ranges
        const isGlobalRole = ['admin', 'administrador', 'supervisor'].includes(role)
        const maxSkipDays = isGlobalRole ? 7 : 1
        const skipCache = requestedSkipCache && dayDiff <= maxSkipDays

        // Granularity Guard: keep daily granularity up to 95 days (covers full Quarter + weekday/hour filters)
        let effectiveGroupBy = groupBy
        if (dayDiff > 95 && groupBy === 'day') {
            effectiveGroupBy = 'week'
        }
        if (startDate === endDate && effectiveGroupBy !== 'day') {
            effectiveGroupBy = 'hour'
        }

        const options: ToastMetricsOptions = {
            storeIds,
            startDate,
            endDate,
            groupBy: effectiveGroupBy === 'hour' ? 'day' : effectiveGroupBy,
            skipCache,
            allowDirtyCache: true,
        }
        // Preserve hourly breakdown when explicitly requested on single-day view
        if (effectiveGroupBy === 'hour') {
            ;(options as any).groupBy = 'hour'
        }

        const { rows, connectionError } = await fetchToastData(options)

        // 📊 PROJECTION ENHANCEMENT: Use LIVE Intelligence Engine
        // CASE 1: Single day with hourly view (Today/Yesterday/Single Custom)
        if (effectiveGroupBy === 'hour' && startDate === endDate) {
            try {
                const { generateSmartForecast } = await import('@/lib/intelligence')
                const supabase = await getSupabaseAdminClient()

                const uniqueStoreIds = Array.from(new Set(rows.map((r: any) => r.storeId).filter(Boolean)))
                const projectionResults = new Map<string, { projectedHourly: Record<number, number>; projectedSales: number; meta?: any }>()
                const upsertBatch: any[] = []

                // Bulk fetch existing cached projections for this single day
                const cachedByStore = new Map<string, any>()
                if (uniqueStoreIds.length > 0) {
                    const { data: cachedList, error: cacheErr } = await supabase
                        .from('sales_projections_cache')
                        .select('*')
                        .in('store_id', uniqueStoreIds)
                        .eq('business_date', startDate)

                    if (!cacheErr && cachedList) {
                        cachedList.forEach((c: any) => cachedByStore.set(c.store_id, c))
                    }
                }

                const missingStores: string[] = []
                for (const sid of uniqueStoreIds) {
                    const cached = cachedByStore.get(sid)
                    if (isUsableCachedProjection(cached)) {
                        projectionResults.set(sid, {
                            projectedHourly: cached.hourly_data || {},
                            projectedSales: Number(cached.total_sales || 0),
                            meta: cached.meta || {},
                        })
                    } else {
                        missingStores.push(sid)
                    }
                }

                // Generate missing projections in throttled chunks of 6
                const CHUNK_SIZE = 6
                for (let i = 0; i < missingStores.length; i += CHUNK_SIZE) {
                    const chunk = missingStores.slice(i, i + CHUNK_SIZE)
                    await Promise.all(
                        chunk.map(async (sid) => {
                            try {
                                const forecast = await generateSmartForecast(sid, startDate)
                                const totalSales = Number(forecast.total_sales || 0)
                                const hourlyMap: Record<number, number> = {}
                                if (forecast.hours) {
                                    forecast.hours.forEach((h) => {
                                        hourlyMap[h.hour] = Number(h.projected_sales || 0)
                                    })
                                }
                                const isClosedHoliday =
                                    Boolean(forecast.methodology?.startsWith('closed')) ||
                                    (totalSales === 0 && (!forecast.hours || forecast.hours.length === 0))

                                const projMeta = {
                                    model: 'Intelligence v3.1',
                                    ai_base_sales: totalSales,
                                    ai_hourly_data: hourlyMap,
                                    manual_override: false,
                                    closed: isClosedHoliday,
                                    growth_factor: forecast.growth_factor_applied,
                                    base_sales: forecast.base_sales,
                                    base_tickets: forecast.base_tickets,
                                    avg_check_used: forecast.avg_check_used,
                                    ticket_growth_factor: forecast.ticket_growth_factor,
                                    holiday_multiplier: forecast.holiday_multiplier,
                                    weather_adjusted: forecast.weather_adjustment || false,
                                    weather_factor: forecast.weather_factor,
                                    methodology: forecast.methodology,
                                    confidence_low: forecast.confidence_low,
                                    confidence_high: forecast.confidence_high,
                                    sample_size: forecast.sample_size,
                                    generated_at: new Date().toISOString(),
                                }

                                projectionResults.set(sid, {
                                    projectedHourly: hourlyMap,
                                    projectedSales: totalSales,
                                    meta: projMeta,
                                })

                                upsertBatch.push({
                                    store_id: sid,
                                    business_date: startDate,
                                    total_sales: totalSales,
                                    hourly_data: hourlyMap,
                                    meta: projMeta,
                                })
                            } catch (storeError) {
                                console.warn(`Failed to get projection for store ${sid}:`, storeError)
                            }
                        })
                    )
                }

                if (upsertBatch.length > 0) {
                    const { error: upErr } = await supabase
                        .from('sales_projections_cache')
                        .upsert(upsertBatch, { onConflict: 'store_id,business_date' })
                    if (upErr) {
                        console.warn('[VentasAPI] Failed to batch-save single-day projections:', upErr.message)
                    }
                }

                // Assign projections to rows (attach full hourly/meta on first row per store + projectedSales on all)
                const seenStoreForMeta = new Set<string>()
                rows.forEach((row: any) => {
                    const proj = projectionResults.get(row.storeId)
                    if (proj) {
                        row.projectedSales = proj.projectedSales
                        if (!seenStoreForMeta.has(row.storeId)) {
                            seenStoreForMeta.add(row.storeId)
                            row.projectedHourly = proj.projectedHourly
                            row.projectionMeta = proj.meta
                        } else {
                            row.projectedHourly = proj.projectedHourly
                            row.projectionMeta = proj.meta
                        }
                    }
                })
            } catch (projError) {
                console.warn('Failed to load Intelligence Engine:', projError)
            }
        }
        // CASE 2: Multi-day view (This Week, Last Week, This Month, etc.)
        else if (effectiveGroupBy === 'day' && dayDiff <= 31) {
            try {
                const { generateSmartForecast } = await import('@/lib/intelligence')
                const supabase = await getSupabaseAdminClient()

                const storeIdsArr = Array.from(new Set(rows.map((r: any) => r.storeId).filter(Boolean)))
                const targetDatesArr = Array.from(new Set(rows.map((r: any) => r.periodStart).filter(Boolean)))

                const projectionCache = new Map<string, { total: number; hourly: Record<number, number>; meta: any }>()
                const missingCombinations: { storeId: string; dateStr: string }[] = []

                // 1. Bulk Fetch from DB Cache (with explicit error guard)
                if (storeIdsArr.length > 0 && targetDatesArr.length > 0) {
                    const { data: cachedProjections, error: cacheErr } = await supabase
                        .from('sales_projections_cache')
                        .select('*')
                        .in('store_id', storeIdsArr)
                        .in('business_date', targetDatesArr)
                        .limit(1000)

                    if (cacheErr) {
                        console.warn('[VentasAPI] sales_projections_cache read error:', cacheErr.message)
                    } else if (cachedProjections) {
                        cachedProjections.filter(isUsableCachedProjection).forEach((row: any) => {
                            projectionCache.set(`${row.store_id}|${row.business_date}`, {
                                total: Number(row.total_sales || 0),
                                hourly: row.hourly_data || {},
                                meta: row.meta || {},
                            })
                        })
                    }
                }

                // 2. Identify missing combinations
                storeIdsArr.forEach((sid) => {
                    targetDatesArr.forEach((dateStr) => {
                        if (!projectionCache.has(`${sid}|${dateStr}`)) {
                            missingCombinations.push({ storeId: sid, dateStr })
                        }
                    })
                })

                // 3. Generate missing in throttled batches of 6 + single bulk upsert
                const upsertBatch: any[] = []
                const CHUNK_SIZE = 6
                for (let i = 0; i < missingCombinations.length; i += CHUNK_SIZE) {
                    const chunk = missingCombinations.slice(i, i + CHUNK_SIZE)
                    await Promise.all(
                        chunk.map(async ({ storeId: sid, dateStr }) => {
                            try {
                                const forecast = await generateSmartForecast(sid, dateStr)
                                if (forecast && Number(forecast.total_sales) >= 0) {
                                    const totalSales = Number(forecast.total_sales || 0)
                                    const hourlyMap: Record<number, number> = {}
                                    forecast.hours?.forEach((h) => {
                                        hourlyMap[h.hour] = Number(h.projected_sales || 0)
                                    })
                                    const isClosedHoliday =
                                        Boolean(forecast.methodology?.startsWith('closed')) ||
                                        (totalSales === 0 && (!forecast.hours || forecast.hours.length === 0))

                                    const meta = {
                                        model: 'Intelligence v3.1',
                                        ai_base_sales: totalSales,
                                        ai_hourly_data: hourlyMap,
                                        manual_override: false,
                                        closed: isClosedHoliday,
                                        growth_factor: forecast.growth_factor_applied,
                                        base_sales: forecast.base_sales,
                                        base_tickets: forecast.base_tickets,
                                        avg_check_used: forecast.avg_check_used,
                                        ticket_growth_factor: forecast.ticket_growth_factor,
                                        holiday_multiplier: forecast.holiday_multiplier,
                                        weather_adjusted: forecast.weather_adjustment || false,
                                        weather_factor: forecast.weather_factor,
                                        methodology: forecast.methodology,
                                        confidence_low: forecast.confidence_low,
                                        confidence_high: forecast.confidence_high,
                                        sample_size: forecast.sample_size,
                                        generated_at: new Date().toISOString(),
                                    }

                                    projectionCache.set(`${sid}|${dateStr}`, {
                                        total: totalSales,
                                        hourly: hourlyMap,
                                        meta,
                                    })

                                    upsertBatch.push({
                                        store_id: sid,
                                        business_date: dateStr,
                                        total_sales: totalSales,
                                        hourly_data: hourlyMap,
                                        meta,
                                    })
                                }
                            } catch {
                                // Non-blocking per store-day
                            }
                        })
                    )
                }

                if (upsertBatch.length > 0) {
                    for (let i = 0; i < upsertBatch.length; i += 100) {
                        const { error: upErr } = await supabase
                            .from('sales_projections_cache')
                            .upsert(upsertBatch.slice(i, i + 100), { onConflict: 'store_id,business_date' })
                        if (upErr) {
                            console.warn('[VentasAPI] Failed to batch-save multi-day projections:', upErr.message)
                        }
                    }
                }

                // Assign projectedSales AND projectedHourly to each row
                rows.forEach((row: any) => {
                    const key = `${row.storeId}|${row.periodStart}`
                    const projData = projectionCache.get(key)
                    if (projData) {
                        row.projectedSales = projData.total
                        row.projectedHourly = projData.hourly
                        row.projectionMeta = projData.meta
                    }
                })
            } catch (projError) {
                console.warn('Failed to load Intelligence Engine or Cache:', projError)
            }
        }

        return NextResponse.json({
            meta: {
                requestedGroupBy: groupBy,
                effectiveGroupBy,
                totalRows: rows.length,
                connectionError,
            },
            data: rows,
        })
    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json(
            {
                error: 'Internal Server Error',
                ...(process.env.NODE_ENV === 'development' ? { details: error.message, _debug_stack: error.stack } : {}),
            },
            { status: 500 }
        )
    }
}
