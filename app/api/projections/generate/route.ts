/**
 * API: /api/projections/generate
 * 
 * Generates sales projections using the Intelligence Engine (v2.1)
 * This replaces the legacy useSmartProjections client-side calculation
 * 
 * Input: { storeId: string, weekStart: string (YYYY-MM-DD) }
 * Output: { projections: Record<string, number>, meta: {...} }
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateSmartForecast } from '@/lib/intelligence'
import { addDays, format } from 'date-fns'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { storeId, weekStart, days = 7 } = body

        if (!storeId || !weekStart) {
            return NextResponse.json(
                { error: 'Missing required fields: storeId, weekStart' },
                { status: 400 }
            )
        }

        console.log(`📊 [Intelligence API] Generating projections for store=${storeId}, week=${weekStart}, days=${days}`)

        // Generate projections for requested days
        const projections: Record<string, number> = {}
        const meta: Record<string, any> = {
            model: 'Intelligence v2.1',
            generatedAt: new Date().toISOString(),
            storeId,
            weekStart,
            dailyDetails: []
        }

        // Parse weekStart safely (append T12:00 to avoid timezone issues)
        const startDate = new Date(weekStart + 'T12:00:00')

        // 1. Check existing cache if not forcing recalc
        const forceRecalc = body.forceRecalc === true;
        const targetDates: string[] = [];
        for (let i = 0; i < days; i++) {
            targetDates.push(format(addDays(startDate, i), 'yyyy-MM-dd'));
        }

        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

        let cachedProjections: Record<string, any> = {};
        if (!forceRecalc) {
            const { data: cachedData } = await supabase
                .from('sales_projections_cache')
                .select('*')
                .eq('store_id', storeId)
                .in('business_date', targetDates);
            
            if (cachedData && cachedData.length > 0) {
                cachedData.forEach(row => {
                    cachedProjections[row.business_date] = row;
                });
            }
        }

        for (const dateStr of targetDates) {
            try {
                if (cachedProjections[dateStr]) {
                    // Use cached
                    const cached = cachedProjections[dateStr];
                    projections[dateStr] = Math.round(Number(cached.total_sales));
                    meta.dailyDetails.push({
                        date: dateStr,
                        total_sales: cached.total_sales,
                        growth_factor: cached.meta?.growth_factor || 1.0,
                        weather_adjusted: cached.meta?.weather_adjusted || false,
                        hourly_breakdown: cached.hourly_data || [],
                        cached: true,
                        updated_at: cached.updated_at
                    });
                    console.log(`  ✅ ${dateStr}: $${Math.round(cached.total_sales).toLocaleString()} (from CACHE)`)
                    continue;
                }

                // Generate new forecast
                const forecast = await generateSmartForecast(storeId, dateStr)

                // Save to Cache
                const { error: upsertError } = await supabase
                    .from('sales_projections_cache')
                    .upsert({
                        store_id: storeId,
                        business_date: dateStr,
                        total_sales: forecast.total_sales,
                        hourly_data: forecast.hours || [],
                        meta: {
                            model: 'Intelligence v2.1',
                            growth_factor: forecast.growth_factor_applied,
                            weather_adjusted: forecast.weather_adjustment || false,
                            generated_at: new Date().toISOString()
                        },
                        updated_at: new Date().toISOString()
                    });

                if (upsertError) {
                    console.error(`  ⚠️ [Cache Error] Failed to save projection for ${dateStr}:`, upsertError.message);
                }

                // Store the daily total
                projections[dateStr] = Math.round(forecast.total_sales)

                // Store metadata and HOURLY details for the heatmap
                meta.dailyDetails.push({
                    date: dateStr,
                    total_sales: forecast.total_sales,
                    growth_factor: forecast.growth_factor_applied,
                    weather_adjusted: forecast.weather_adjustment || false,
                    hourly_breakdown: forecast.hours || [],
                    cached: false
                })

                console.log(`  ✅ ${dateStr}: $${Math.round(forecast.total_sales).toLocaleString()} (NEW generation, growth: ${forecast.growth_factor_applied.toFixed(2)})`)

            } catch (dayError: any) {
                console.error(`  ❌ ${dateStr}: Failed - ${dayError.message}`)
                // Don't fail the entire request, just skip this day
                projections[dateStr] = 0
                meta.dailyDetails.push({
                    date: dateStr,
                    error: dayError.message
                })
            }
        }

        console.log(`📊 [Intelligence API] Complete. ${Object.keys(projections).length} days generated.`)

        return NextResponse.json({
            success: true,
            projections,
            meta
        })

    } catch (error: any) {
        console.error('[Intelligence API] Fatal error:', error)
        return NextResponse.json(
            { error: error.message || 'Unknown error generating projections' },
            { status: 500 }
        )
    }
}

// Also support GET for simple testing
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('storeId')
    const weekStart = searchParams.get('weekStart')

    if (!storeId || !weekStart) {
        return NextResponse.json({
            error: 'Missing query params: storeId, weekStart',
            example: '/api/projections/generate?storeId=abc123&weekStart=2026-02-03'
        }, { status: 400 })
    }

    // Redirect to POST logic
    const mockRequest = {
        json: async () => ({ storeId, weekStart })
    } as NextRequest

    return POST(mockRequest)
}
