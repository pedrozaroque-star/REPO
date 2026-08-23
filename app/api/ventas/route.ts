/**
 * @module api/ventas/route
 * @description Primary API endpoint for Sales Dashboard data retrieval, orchestrating Toast API integration, Supabase caching, and live machine-learning sales forecasts.
 * @businessRules
 * - Enforces authentication and authorization for admin, supervisor, and manager roles.
 * - Business day follows the standard 6:00 AM to 5:59 AM next day rule.
 * - Integrates with sales_projections_cache and generateSmartForecast for intraday and multi-day pacing targets.
 * @dataFlow
 * - Client -> GET /api/ventas -> Toast API / sales_daily_cache -> Smart Forecast Engine -> JSON Response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchToastData, ToastMetricsOptions } from '@/lib/toast-api'
import { verifyAuthToken } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        // 🛡️ SECURITY CHECK 🛡️
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim()

        // 1. Validate Token (Manual JWT Verify)
        const user = verifyAuthToken(token)

        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        // 2. Validate Role (Admin, Supervisor, Manager)
        if (user.user_role !== 'admin' && user.user_role !== 'supervisor' && user.user_role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        const searchParams = request.nextUrl.searchParams

        const storeIds = searchParams.get('storeIds') || 'all'
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const groupBy = (searchParams.get('groupBy') as any) || 'day'
        const skipCache = searchParams.get('skipCache') === 'true'

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: 'Missing startDate or endDate' },
                { status: 400 }
            )
        }

        // Logic "Granularity Guard"
        const start = new Date(startDate)
        const end = new Date(endDate)
        const dayDiff = (end.getTime() - start.getTime()) / (1000 * 3600 * 24)

        let effectiveGroupBy = groupBy
        if (dayDiff > 60 && groupBy === 'day') {
            effectiveGroupBy = 'week'
        }

        const options: ToastMetricsOptions = {
            storeIds,
            startDate,
            endDate,
            groupBy: effectiveGroupBy,
            skipCache,
            allowDirtyCache: true
        }

        const { rows, connectionError } = await fetchToastData(options)

        // 📊 PROJECTION ENHANCEMENT: Use LIVE Intelligence Engine
        // CASE 1: Single day with hourly view (Today/Yesterday)
        if (effectiveGroupBy === 'hour' && startDate === endDate) {
            try {
                const { generateSmartForecast } = await import('@/lib/intelligence')
                const supabase = await getSupabaseAdminClient()

                // Get unique store IDs
                const storeMap = new Map<string, any>()
                rows.forEach((row: any) => {
                    if (!storeMap.has(row.storeId)) {
                        storeMap.set(row.storeId, row)
                    }
                })

                // Generate or fetch projections for each UNIQUE store
                const projectionResults = new Map<string, { projectedHourly: Record<number, number>, projectedSales: number, meta?: any }>()

                const projectionPromises = Array.from(storeMap.entries()).map(async ([storeId]) => {
                    try {
                        // 1. Check Cache
                        const { data: cached } = await supabase
                            .from('sales_projections_cache')
                            .select('*')
                            .eq('store_id', storeId)
                            .eq('business_date', startDate)
                            .maybeSingle();
                        
                        let totalSales = 0;
                        let hourlyMap: Record<number, number> = {};
                        let projMeta: any = {};

                        if (cached) {
                            totalSales = cached.total_sales;
                            hourlyMap = cached.hourly_data || {};
                            projMeta = cached.meta || {};
                        } else {
                            // 2. Generate if missing
                            const forecast = await generateSmartForecast(storeId, startDate)
                            totalSales = forecast.total_sales;
                            if (forecast.hours) {
                                forecast.hours.forEach(h => {
                                    hourlyMap[h.hour] = h.projected_sales || 0
                                })
                            }
                            
                            // Save to Cache so Planner sees the exact same number
                            await supabase.from('sales_projections_cache').upsert({
                                store_id: storeId,
                                business_date: startDate,
                                total_sales: totalSales,
                                hourly_data: hourlyMap,
                                meta: {
                                    model: 'Intelligence v2.1',
                                    growth_factor: forecast.growth_factor_applied,
                                    weather_adjusted: forecast.weather_adjustment || false,
                                    generated_at: new Date().toISOString()
                                }
                            });
                            projMeta = {
                                growth_factor: forecast.growth_factor_applied,
                                weather_adjusted: forecast.weather_adjustment || false,
                                base_sales: forecast.base_sales
                            };
                        }

                        projectionResults.set(storeId, {
                            projectedHourly: hourlyMap,
                            projectedSales: totalSales,
                            meta: projMeta
                        })
                        
                    } catch (storeError) {
                        console.warn(`Failed to get projection for store ${storeId}:`, storeError)
                    }
                })

                await Promise.all(projectionPromises)

                // Assign projections to rows
                rows.forEach((row: any) => {
                    const proj = projectionResults.get(row.storeId)
                    if (proj) {
                        row.projectedHourly = proj.projectedHourly
                        row.projectedSales = proj.projectedSales
                        row.projectionMeta = proj.meta
                    }
                })

            } catch (projError) {
                console.warn('Failed to load Intelligence Engine:', projError)
            }
        }

        // CASE 2: Multi-day view (This Week, Last Week, This Month, etc.)
        // Generate daily projections for each date + store combination
        else if (effectiveGroupBy === 'day' && dayDiff <= 31) {
            try {
                const { generateSmartForecast } = await import('@/lib/intelligence')
                const supabase = await getSupabaseAdminClient()

                // Get unique store IDs
                const uniqueStoreIds = new Set<string>()
                rows.forEach((row: any) => uniqueStoreIds.add(row.storeId))

                // Get all unique dates in the range
                const uniqueDates = new Set<string>()
                rows.forEach((row: any) => {
                    if (row.periodStart) {
                        uniqueDates.add(row.periodStart)
                    }
                })

                // Build projection cache: Map<"storeId|date", { total: number, hourly: Record<number, number>, meta: any }>
                const projectionCache = new Map<string, { total: number, hourly: Record<number, number>, meta: any }>()
                const missingCombinations: { storeId: string, dateStr: string }[] = []

                // 1. Bulk Fetch from DB Cache
                const targetDatesArr = Array.from(uniqueDates)
                const storeIdsArr = Array.from(uniqueStoreIds)
                
                if (storeIdsArr.length > 0 && targetDatesArr.length > 0) {
                    const { data: cachedProjections } = await supabase
                        .from('sales_projections_cache')
                        .select('*')
                        .in('store_id', storeIdsArr)
                        .in('business_date', targetDatesArr);
                    
                    if (cachedProjections) {
                        cachedProjections.forEach(row => {
                            projectionCache.set(`${row.store_id}|${row.business_date}`, {
                                total: row.total_sales,
                                hourly: row.hourly_data || {},
                                meta: row.meta || {}
                            })
                        })
                    }
                }

                // 2. Identify missing combinations
                storeIdsArr.forEach(storeId => {
                    targetDatesArr.forEach(dateStr => {
                        if (!projectionCache.has(`${storeId}|${dateStr}`)) {
                            missingCombinations.push({ storeId, dateStr })
                        }
                    })
                })

                // 3. Generate missing in parallel
                const storePromises = missingCombinations.map(async ({ storeId, dateStr }) => {
                    try {
                        const forecast = await generateSmartForecast(storeId, dateStr)
                        if (forecast && forecast.total_sales > 0) {
                            const hourlyMap: Record<number, number> = {}
                            forecast.hours?.forEach(h => hourlyMap[h.hour] = h.projected_sales)

                            projectionCache.set(`${storeId}|${dateStr}`, {
                                total: forecast.total_sales,
                                hourly: hourlyMap,
                                meta: {
                                    growth_factor: forecast.growth_factor_applied,
                                    weather_adjusted: forecast.weather_adjustment || false,
                                    base_sales: forecast.base_sales
                                }
                            })

                            // Safe async cache save
                            await supabase.from('sales_projections_cache').upsert({
                                store_id: storeId,
                                business_date: dateStr,
                                total_sales: forecast.total_sales,
                                hourly_data: hourlyMap,
                                meta: {
                                    model: 'Intelligence v2.1',
                                    growth_factor: forecast.growth_factor_applied,
                                    generated_at: new Date().toISOString()
                                }
                            })
                        }
                    } catch (err) {
                        // Non-blocking
                    }
                })

                await Promise.all(storePromises)

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
                effectiveGroupBy: effectiveGroupBy,
                totalRows: rows.length,
                connectionError
            },
            data: rows
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json(
            {
                error: 'Internal Server Error',
                details: error.message,
                ...(process.env.NODE_ENV === 'development' ? { _debug_stack: error.stack } : {})
            },
            { status: 500 }
        )
    }
}
