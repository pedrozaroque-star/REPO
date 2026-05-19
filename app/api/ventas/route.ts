import { NextRequest, NextResponse } from 'next/server'
import { fetchToastData, ToastMetricsOptions } from '@/lib/toast-api'
import { verifyAuthToken } from '@/lib/auth-server'

export async function GET(request: NextRequest) {
    try {
        // 🛡️ SECURITY CHECK 🛡️
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace('Bearer ', '')

        // 1. Validate Token (Manual JWT Verify)
        const user = verifyAuthToken(token)

        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        // 2. Validate Role (Admin Only)
        // Check the 'user_role' claim inside the token directly! 
        // Logic: Our /api/login embeds 'user_role' in the JWT.
        if (user.user_role !== 'admin' && user.user_role !== 'supervisor' && user.user_role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        // ✅ AUTH SUCCESS - PROCEED


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

        const options: ToastMetricsOptions = {
            storeIds,
            startDate,
            endDate,
            groupBy,
            skipCache,
            allowDirtyCache: true // Allow reading intra-day cached data if available (populated by cron)
        }

        // Logic "Granularity Guard"
        // If range > 60 days and groupBy is 'day', suggest 'week'
        const start = new Date(startDate)
        const end = new Date(endDate)
        const dayDiff = (end.getTime() - start.getTime()) / (1000 * 3600 * 24)

        let effectiveGroupBy = groupBy
        if (dayDiff > 60 && groupBy === 'day') {
            effectiveGroupBy = 'week'
            // We could auto-switch, but for now we just process what is asked 
            // or we could force it: options.groupBy = 'week'
        }

        const { rows, connectionError } = await fetchToastData(options)

        // DEBUG: Check Labor
        if (rows.length > 0) {
            const totalLabor = rows.reduce((acc, r) => acc + (r.laborCost || 0), 0)
            console.log(`[API DEBUG] /api/ventas returned ${rows.length} rows. Total Labor Cost: ${totalLabor}`)
            if (totalLabor === 0) {
                console.warn('[API WARNING] Labor Cost is 0 everywhere!')
                // Check first row detail
                console.log('[API DEBUG] Row[0]:', JSON.stringify(rows[0], null, 2))
            }
        }

        // 📊 PROJECTION ENHANCEMENT: Use LIVE Intelligence Engine

        // CASE 1: Single day with hourly view (Today/Yesterday)
        if (groupBy === 'hour' && startDate === endDate) {
            try {
                const { generateSmartForecast } = await import('@/lib/intelligence')
                const { createClient } = await import('@supabase/supabase-js')
                const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

                // Get unique store IDs
                const storeMap = new Map<string, any>()
                rows.forEach((row: any) => {
                    if (!storeMap.has(row.storeId)) {
                        storeMap.set(row.storeId, row)
                    }
                })

                // Generate or fetch projections for each UNIQUE store
                const projectionResults = new Map<string, { projectedHourly: Record<number, number>, projectedSales: number }>()

                const projectionPromises = Array.from(storeMap.entries()).map(async ([storeId, sampleRow]) => {
                    try {
                        // 1. Check Cache
                        const { data: cached } = await supabase
                            .from('sales_projections_cache')
                            .select('*')
                            .eq('store_id', storeId)
                            .eq('business_date', startDate)
                            .single();
                        
                        let totalSales = 0;
                        let hourlyMap: Record<number, number> = {};

                        if (cached) {
                            totalSales = cached.total_sales;
                            hourlyMap = cached.hourly_data || {};
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
                        }

                        projectionResults.set(storeId, {
                            projectedHourly: hourlyMap,
                            projectedSales: totalSales
                        })
                        
                    } catch (storeError) {
                        console.warn(`Failed to get projection for store ${storeId}:`, storeError)
                    }
                })

                await Promise.all(projectionPromises)

                // Assign projections to first row of each store only
                const assignedStores = new Set<string>()
                rows.forEach((row: any) => {
                    const proj = projectionResults.get(row.storeId)
                    if (proj && !assignedStores.has(row.storeId)) {
                        row.projectedHourly = proj.projectedHourly
                        row.projectedSales = proj.projectedSales
                        assignedStores.add(row.storeId)
                    }
                })

            } catch (projError) {
                console.warn('Failed to load Intelligence Engine:', projError)
            }
        }

        // CASE 2: Multi-day view (This Week, Last Week, This Month, etc.)
        // Generate daily projections for each date + store combination
        else if (groupBy === 'day' && dayDiff <= 31) {
            try {
                const { generateSmartForecast } = await import('@/lib/intelligence')
                const { createClient } = await import('@supabase/supabase-js')
                const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

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

                // Build projection cache: Map<"storeId|date", { total: number, hourly: Record<number, number> }>
                const projectionCache = new Map<string, { total: number, hourly: Record<number, number> }>()
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
                                hourly: row.hourly_data || {}
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
                            forecast.hours.forEach(h => hourlyMap[h.hour] = h.projected_sales)

                            projectionCache.set(`${storeId}|${dateStr}`, {
                                total: forecast.total_sales,
                                hourly: hourlyMap
                            })

                            // Fire and forget cache save
                            supabase.from('sales_projections_cache').upsert({
                                store_id: storeId,
                                business_date: dateStr,
                                total_sales: forecast.total_sales,
                                hourly_data: hourlyMap,
                                meta: {
                                    model: 'Intelligence v2.1',
                                    growth_factor: forecast.growth_factor_applied,
                                    generated_at: new Date().toISOString()
                                }
                            }).then();
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
                connectionError // Pass error to frontend
            },
            data: rows
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json(
            {
                error: 'Internal Server Error',
                details: error.message,
                _debug_stack: error.stack
            },
            { status: 500 }
        )
    }
}
