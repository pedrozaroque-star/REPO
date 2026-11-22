/**
 * @module api/projections/generate
 * @description Genera y congela proyecciones de venta mediante Intelligence V3.
 * @businessRules Solo usuarios autenticados (`admin`, `supervisor`, `manager`, `planificador` o `CRON_SECRET`) pueden generar; managers se limitan estrictamente a su tienda vía `authorizeStoreScope`; máximo 31 días por solicitud.
 * @dataFlow Cliente autenticado -> `verifyStaffAuth` + `authorizeStoreScope` -> intelligence.ts -> sales_projections_cache -> respuesta JSON.
 * @notes La caché guarda `hourly_data` como mapa hora->venta para mantener compatibilidad con Ventas. `GET` exige `verifyStaffAuth` antes de devolver `405`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateSmartForecast } from '@/lib/intelligence'
import { addDays, format } from 'date-fns'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'

const PROJECTION_POST_ROLES = [
    'admin',
    'supervisor',
    'manager',
    'gerente',
    'general_manager',
    'asistente',
    'assistant',
    'planificador',
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRealIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
    const parsed = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function formatHourlyArray(hourlyData: any): Array<{ hour: number; projected_sales: number; projected_tickets?: number }> {
    if (Array.isArray(hourlyData)) {
        return hourlyData.map((h: any) => ({
            hour: Number(h.hour),
            projected_sales: Number(h.projected_sales ?? h.sales ?? 0),
            projected_tickets: Number(h.projected_tickets ?? h.tickets ?? 0)
        }))
    }
    if (hourlyData && typeof hourlyData === 'object') {
        return Object.entries(hourlyData).map(([hourStr, sales]) => ({
            hour: Number(hourStr),
            projected_sales: Number(sales ?? 0),
            projected_tickets: 0
        })).sort((a, b) => a.hour - b.hour)
    }
    return []
}

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: PROJECTION_POST_ROLES, allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const body = await request.json()
        const { storeId, weekStart, days = 7 } = body

        if (typeof storeId !== 'string' || !storeId.trim() || !isRealIsoDate(weekStart)) {
            return NextResponse.json(
                { error: 'Invalid storeId or weekStart; expected a real YYYY-MM-DD date' },
                { status: 400 }
            )
        }
        if (!Number.isInteger(days) || days < 1 || days > 31) {
            return NextResponse.json({ error: 'days must be an integer between 1 and 31' }, { status: 400 })
        }

        console.log(`📊 [Intelligence API] Generating projections for store=${storeId}, week=${weekStart}, days=${days}`)

        // Generate projections for requested days
        const projections: Record<string, number> = {}
        const meta: Record<string, any> = {
            model: 'Intelligence v3.1',
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

        const { getSupabaseAdminClient } = await import('@/lib/supabase');
        const supabase = await getSupabaseAdminClient();

        let storeQuery = supabase.from('stores').select('id, external_id')
        if (typeof storeId === 'number' || /^\d+$/.test(String(storeId))) {
            storeQuery = storeQuery.eq('id', Number(storeId))
        } else {
            storeQuery = storeQuery.eq('external_id', storeId)
        }
        const { data: requestedStore, error: storeError } = await storeQuery.maybeSingle()
        if (storeError || !requestedStore) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

        if (auth.user) {
            const rawServerUser = await getServerUser(request)
            let effectiveRole = (rawServerUser?.role || auth.user.role || auth.user.user_role || '').toLowerCase()
            let effectiveStoreId = rawServerUser?.store_id ?? auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id
            let effectiveScope = rawServerUser?.store_scope ?? auth.user.user_metadata?.store_scope

            if (!effectiveStoreId && auth.user.email && !['admin', 'administrador', 'supervisor'].includes(effectiveRole)) {
                const { data: userProfile } = await supabase
                    .from('users')
                    .select('role, store_id, store_scope')
                    .ilike('email', auth.user.email)
                    .maybeSingle()
                if (userProfile) {
                    if (userProfile.role) effectiveRole = String(userProfile.role).trim().toLowerCase()
                    if (userProfile.store_id !== null && userProfile.store_id !== undefined) effectiveStoreId = userProfile.store_id
                    if (userProfile.store_scope) effectiveScope = userProfile.store_scope
                }
            }

            const isGlobalOrUnscopedPlanner =
                ['admin', 'administrador', 'supervisor'].includes(effectiveRole) ||
                (effectiveRole === 'planificador' && !effectiveStoreId)

            if (!isGlobalOrUnscopedPlanner) {
                const serverUser = {
                    id: rawServerUser?.id || auth.user.id,
                    email: rawServerUser?.email || auth.user.email,
                    name: rawServerUser?.name || auth.user.user_metadata?.full_name || auth.user.email,
                    role: effectiveRole,
                    store_id: effectiveStoreId,
                    store_ids: rawServerUser?.store_ids ?? auth.user.user_metadata?.store_ids,
                    store_scope: effectiveScope,
                }

                const scopeCheck = await authorizeStoreScope(serverUser, requestedStore.id, supabase, {
                    action: 'publish_schedule',
                })
                if (!scopeCheck.authorized) {
                    return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status })
                }
            }
        }

        const cachedProjections: Record<string, any> = {};
        const overrides: Record<string, { manual: boolean; aiBaseSales: number; overriddenBy?: string; overriddenAt?: string }> = {};

        const { data: cachedData } = await supabase
            .from('sales_projections_cache')
            .select('*')
            .eq('store_id', requestedStore.external_id)
            .in('business_date', targetDates);

        if (cachedData && cachedData.length > 0) {
            cachedData.forEach(row => {
                const isManualLock = row.meta?.manual_override === true;
                // Static Manual Locks are NEVER overwritten, even when forceRecalc === true (Brain button)
                if (!forceRecalc || isManualLock) {
                    cachedProjections[row.business_date] = row;
                }
                if (isManualLock) {
                    overrides[row.business_date] = {
                        manual: true,
                        aiBaseSales: Math.round(Number(row.meta?.ai_base_sales ?? row.total_sales)),
                        overriddenBy: row.meta?.overridden_by,
                        overriddenAt: row.meta?.overridden_at,
                    };
                }
            });
        }

        const effectiveStoreExtId = requestedStore.external_id;

        for (const dateStr of targetDates) {
            try {
                if (cachedProjections[dateStr] && cachedProjections[dateStr].meta?.model === 'Intelligence v3.1') {
                    // Use cached (or protected static manual override)
                    const cached = cachedProjections[dateStr];
                    projections[dateStr] = Math.round(Number(cached.total_sales));
                    meta.dailyDetails.push({
                        date: dateStr,
                        total_sales: cached.total_sales,
                        ai_base_sales: Number(cached.meta?.ai_base_sales ?? cached.total_sales),
                        manual_override: cached.meta?.manual_override === true,
                        overridden_by: cached.meta?.overridden_by,
                        growth_factor: cached.meta?.growth_factor || 1.0,
                        weather_adjusted: cached.meta?.weather_adjusted || false,
                        hourly_breakdown: formatHourlyArray(cached.hourly_data),
                        cached: true,
                        updated_at: cached.updated_at
                    });
                    console.log(`  ✅ ${dateStr}: $${Math.round(cached.total_sales).toLocaleString()} (${cached.meta?.manual_override ? 'LOCKED MANUAL' : 'from CACHE'})`)
                    continue;
                }

                // Generate new forecast
                const forecast = await generateSmartForecast(effectiveStoreExtId, dateStr, forceRecalc)
                const hourlyMap = Object.fromEntries(forecast.hours.map(hour => [String(hour.hour), hour.projected_sales]))

                // Save to Cache
                const { error: upsertError } = await supabase
                    .from('sales_projections_cache')
                    .upsert({
                        store_id: effectiveStoreExtId,
                        business_date: dateStr,
                        total_sales: forecast.total_sales,
                        hourly_data: hourlyMap,
                        meta: {
                            model: 'Intelligence v3.1',
                            ai_base_sales: forecast.total_sales,
                            ai_hourly_data: hourlyMap,
                            manual_override: false,
                            closed: forecast.total_sales === 0 && forecast.hours.length === 0,
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
                    hourly_breakdown: formatHourlyArray(forecast.hours),
                    cached: false
                })

                console.log(`  ✅ ${dateStr}: $${Math.round(forecast.total_sales).toLocaleString()} (NEW generation, growth: ${forecast.growth_factor_applied.toFixed(2)})`)

            } catch (dayError: any) {
                console.error(`  ❌ ${dateStr}: Failed - ${dayError.message}`)
                // Omit failed dates; zero is a valid closed-day projection and must not represent an error.
                meta.dailyDetails.push({
                    date: dateStr,
                    error: dayError.message
                })
            }
        }

        console.log(`📊 [Intelligence API] Complete. ${Object.keys(projections).length} days generated.`)

        const errors = meta.dailyDetails.filter((detail: any) => detail.error)
        return NextResponse.json({
            success: true,
            partial: errors.length > 0,
            errors,
            projections,
            overrides,
            meta
        }, { status: errors.length > 0 ? 207 : 200 })

    } catch (error: any) {
        console.error('[Intelligence API] Fatal error:', error)
        return NextResponse.json(
            { error: error.message || 'Unknown error generating projections' },
            { status: 500 }
        )
    }
}

export async function GET(request: NextRequest) {
    const auth = await verifyStaffAuth(request)
    if (!auth.authorized) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }
    return NextResponse.json({ error: 'Use authenticated POST to generate projections' }, { status: 405 })
}
