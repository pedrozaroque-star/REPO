/**
 * @module app/api/projections/override/route
 * @description Endpoint autenticado para fijar estáticamente (`action: 'set'`) o restaurar a IA (`action: 'unlock'`)
 *   la proyección diaria de ventas de una sucursal desde el Planificador (`/planificador`), sincronizando en tiempo real
 *   con el módulo Ventas (`/ventas`), Reporte Semanal (`/ventas/reportes`) y el modal por hora (`SalesDetailModal`),
 *   sin alterar la demanda estadística pura usada en Preparador de Carnes (`/inventory/preparador`), PAR Ideal ni Descansos IA.
 *
 * @businessRules
 *   - Solo roles autorizados (`admin`, `supervisor`, `manager`, `gerente`, `general_manager`, `asistente`, `assistant`, `planificador`)
 *     con alcance validado por `authorizeStoreScope` (`requireWrite: true`) pueden fijar o desbloquear proyecciones.
 *   - **Candado contra errores de dedo (*Sanity Guardrail*)**: Para roles de tienda (`manager`, `asistente`, `planificador` acotado),
 *     el ajuste manual debe estar entre **`-40%` y `+50%`** respecto a `ai_base_sales` (la proyección original de Intelligence v3.1).
 *     Los roles `admin` y `supervisor` no tienen restricción porcentual (`$0` a `$250,000`).
 *   - **Doble Trazabilidad**: Siempre conserva intactos `meta.ai_base_sales` y `meta.ai_hourly_data` en `sales_projections_cache`
 *     mientras reescala proporcionalmente `hourly_data` al centavo exacto para que la curva de 24h (`6:00 AM – 5:59 AM`) sume `total_sales`.
 *   - Persiste atómicamente en `sales_projections_cache` y en `weekly_budgets` (limpiando la semana exacta Lunes..Domingo).
 *
 * @dataFlow
 *   `BudgetTool` / `MobilePlannerView` -> `POST /api/projections/override` -> `sales_projections_cache` + `weekly_budgets` -> `/ventas` & `/planificador`.
 *
 * @notes
 *   - Mantiene `meta.model = 'Intelligence v3.1'` para que `/api/ventas` y `lib/intelligence.ts` reconozcan la fila como válida
 *     y jamás la sobreescriban automáticamente ni al presionar el botón general de recálculo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { addDays, format } from 'date-fns'
import { generateSmartForecast } from '@/lib/intelligence'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

const OVERRIDE_ROLES = [
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
const MANAGER_MIN_RATIO = 0.60 // -40%
const MANAGER_MAX_RATIO = 1.50 // +50%

function isRealIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
    const parsed = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function getMondayIso(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`)
    const day = d.getUTCDay() // 0=Sun, 1=Mon...
    const diff = day === 0 ? -6 : 1 - day
    d.setUTCDate(d.getUTCDate() + diff)
    return d.toISOString().slice(0, 10)
}

function scaleHourlyMapExact(
    baseHourly: Record<string, number>,
    targetTotal: number
): Record<string, number> {
    const entries = Object.entries(baseHourly || {})
        .map(([k, v]) => [k, Math.max(0, Number(v) || 0)] as const)
        .filter(([k]) => Number.isFinite(Number(k)))

    const cleanTarget = Math.max(0, Math.round(targetTotal * 100) / 100)
    if (cleanTarget === 0 || entries.length === 0) {
        if (entries.length === 0 && cleanTarget > 0) {
            // Fallback uniform 10am-9pm if curve was empty
            const hrs = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21']
            const perHr = Math.floor((cleanTarget / hrs.length) * 100) / 100
            const out: Record<string, number> = {}
            let acc = 0
            hrs.forEach((h, idx) => {
                if (idx === hrs.length - 1) {
                    out[h] = Number((cleanTarget - acc).toFixed(2))
                } else {
                    out[h] = perHr
                    acc += perHr
                }
            })
            return out
        }
        return Object.fromEntries(entries.map(([k]) => [k, 0]))
    }

    const baseSum = entries.reduce((sum, [, val]) => sum + val, 0)
    const scaled: Record<string, number> = {}
    let runningSum = 0
    let maxHourKey = entries[0][0]
    let maxHourVal = -1

    for (const [hKey, val] of entries) {
        const share = baseSum > 0 ? val / baseSum : 1 / entries.length
        const rounded = Math.round(cleanTarget * share * 100) / 100
        scaled[hKey] = rounded
        runningSum += rounded
        if (rounded > maxHourVal) {
            maxHourVal = rounded
            maxHourKey = hKey
        }
    }

    const residual = Number((cleanTarget - runningSum).toFixed(2))
    if (Math.abs(residual) > 0 && maxHourKey) {
        scaled[maxHourKey] = Number(Math.max(0, (scaled[maxHourKey] || 0) + residual).toFixed(2))
    }

    return scaled
}

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: OVERRIDE_ROLES, allowCron: false })
        if (!auth.authorized || !auth.user) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const body = await request.json()
        const { storeId, businessDate, action = 'set', totalSales } = body

        if (typeof storeId !== 'string' || !storeId.trim() || !isRealIsoDate(businessDate)) {
            return NextResponse.json(
                { error: 'Parámetros inválidos: se requiere storeId y businessDate (YYYY-MM-DD).' },
                { status: 400 }
            )
        }

        if (action !== 'set' && action !== 'unlock') {
            return NextResponse.json({ error: 'Acción inválida; use "set" o "unlock".' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 1. Resolve Store
        let storeQuery = supabase.from('stores').select('id, name, external_id')
        if (/^\d+$/.test(storeId.trim())) {
            storeQuery = storeQuery.eq('id', Number(storeId.trim()))
        } else {
            storeQuery = storeQuery.eq('external_id', storeId.trim())
        }
        const { data: store, error: storeErr } = await storeQuery.maybeSingle()
        if (storeErr || !store) {
            return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 })
        }

        // 2. Authorize Store Scope & Identify Effective Role
        const rawServerUser = await getServerUser(request)
        let effectiveRole = String(rawServerUser?.role || auth.user.role || auth.user.user_role || '').trim().toLowerCase()
        let effectiveStoreId = rawServerUser?.store_id ?? auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id
        let effectiveScope = rawServerUser?.store_scope ?? auth.user.user_metadata?.store_scope
        let actorName = String(rawServerUser?.name || auth.user.user_metadata?.full_name || auth.user.email || 'Manager').trim()

        if (auth.user.email) {
            const { data: userProfile } = await supabase
                .from('users')
                .select('full_name, role, store_id, store_scope')
                .ilike('email', auth.user.email)
                .maybeSingle()
            if (userProfile) {
                if (userProfile.role) effectiveRole = String(userProfile.role).trim().toLowerCase()
                if (userProfile.store_id !== null && userProfile.store_id !== undefined) effectiveStoreId = userProfile.store_id
                if (userProfile.store_scope) effectiveScope = userProfile.store_scope
                if (userProfile.full_name) actorName = String(userProfile.full_name).trim()
            }
        }

        // Never expose protected executive name; label as Dirección / Admin if executive
        if (/carlos\s*velazquez/i.test(actorName) || ['carlos@tacosgavilan.com', 'roque@tacosgavilan.com'].includes(String(auth.user.email || '').toLowerCase())) {
            actorName = 'Dirección Operativa'
        }

        const isExecutiveOrSupervisor = ['admin', 'administrador', 'supervisor'].includes(effectiveRole)
        const isGlobalUnscopedPlanner = effectiveRole === 'planificador' && !effectiveStoreId

        if (!isExecutiveOrSupervisor && !isGlobalUnscopedPlanner) {
            const serverUser = {
                id: rawServerUser?.id || auth.user.id,
                email: rawServerUser?.email || auth.user.email,
                name: actorName,
                role: effectiveRole,
                store_id: effectiveStoreId,
                store_ids: rawServerUser?.store_ids ?? auth.user.user_metadata?.store_ids,
                store_scope: effectiveScope,
            }
            const scopeCheck = await authorizeStoreScope(serverUser, store.id, supabase, {
                requireWrite: true,
                action: 'publish_schedule',
            })
            if (!scopeCheck.authorized) {
                return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status })
            }
        }

        const externalStoreId = store.external_id
        const weekStartStr = getMondayIso(businessDate)
        const weekDates = Array.from({ length: 7 }, (_, idx) =>
            format(addDays(new Date(`${weekStartStr}T12:00:00`), idx), 'yyyy-MM-dd')
        )

        // 3. Load Existing Cache Row (or generate clean AI baseline first)
        const { data: existingCache } = await supabase
            .from('sales_projections_cache')
            .select('*')
            .eq('store_id', externalStoreId)
            .eq('business_date', businessDate)
            .maybeSingle()

        let aiBaseSales = 0
        let aiHourlyData: Record<string, number> = {}
        let baseMeta: Record<string, any> = {}

        if (
            existingCache &&
            existingCache.meta?.model === 'Intelligence v3.1' &&
            Number(existingCache.meta?.ai_base_sales ?? existingCache.total_sales) >= 0
        ) {
            aiBaseSales = Number(existingCache.meta?.ai_base_sales ?? existingCache.total_sales)
            const rawHr = existingCache.meta?.ai_hourly_data || existingCache.hourly_data || {}
            if (rawHr && typeof rawHr === 'object' && !Array.isArray(rawHr)) {
                aiHourlyData = Object.fromEntries(Object.entries(rawHr).map(([k, v]) => [String(k), Number(v) || 0]))
            }
            baseMeta = { ...(existingCache.meta || {}) }
        } else {
            const freshForecast = await generateSmartForecast(externalStoreId, businessDate, true)
            aiBaseSales = Number(freshForecast.total_sales) || 0
            aiHourlyData = Object.fromEntries(freshForecast.hours.map(h => [String(h.hour), Number(h.projected_sales) || 0]))
            baseMeta = {
                model: 'Intelligence v3.1',
                growth_factor: freshForecast.growth_factor_applied,
                base_sales: freshForecast.base_sales,
                base_tickets: freshForecast.base_tickets,
                avg_check_used: freshForecast.avg_check_used,
                ticket_growth_factor: freshForecast.ticket_growth_factor,
                holiday_multiplier: freshForecast.holiday_multiplier,
                weather_adjusted: freshForecast.weather_adjustment || false,
                weather_factor: freshForecast.weather_factor,
                methodology: freshForecast.methodology,
                confidence_low: freshForecast.confidence_low,
                confidence_high: freshForecast.confidence_high,
                sample_size: freshForecast.sample_size,
                generated_at: new Date().toISOString(),
            }
        }

        // Helper to sync weekly_budgets cleanly (only the 7 dates of weekStartStr)
        const syncWeeklyBudgetDay = async (targetDate: string, amountRounded: number) => {
            const [{ data: existingBudget }, { data: weekCacheRows }] = await Promise.all([
                supabase
                    .from('weekly_budgets')
                    .select('sales_projections, labor_target')
                    .eq('store_id', externalStoreId)
                    .eq('week_start', weekStartStr)
                    .maybeSingle(),
                supabase
                    .from('sales_projections_cache')
                    .select('business_date, total_sales')
                    .eq('store_id', externalStoreId)
                    .in('business_date', weekDates),
            ])

            const cleanWeekMap: Record<string, string> = {}
            const prevMap = (existingBudget?.sales_projections && typeof existingBudget.sales_projections === 'object')
                ? existingBudget.sales_projections as Record<string, any>
                : {}

            weekDates.forEach(dStr => {
                const cachedRow = (weekCacheRows || []).find(r => r.business_date === dStr)
                if (cachedRow && Number(cachedRow.total_sales) >= 0) {
                    cleanWeekMap[dStr] = String(Math.round(Number(cachedRow.total_sales)))
                } else if (prevMap[dStr] !== undefined) {
                    cleanWeekMap[dStr] = String(Math.round(Number(prevMap[dStr]) || 0))
                }
            })

            cleanWeekMap[targetDate] = String(Math.round(amountRounded))

            await supabase
                .from('weekly_budgets')
                .upsert({
                    store_id: externalStoreId,
                    week_start: weekStartStr,
                    sales_projections: cleanWeekMap,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'store_id,week_start' })
        }

        // 4A. UNLOCK ACTION -> Restore pure AI forecast
        if (action === 'unlock') {
            // Recompute or restore pure AI baseline
            const freshAi = await generateSmartForecast(externalStoreId, businessDate, true)
            const restoredSales = Number(freshAi.total_sales) || 0
            const restoredHourly = Object.fromEntries(freshAi.hours.map(h => [String(h.hour), Number(h.projected_sales) || 0]))

            const unlockedMeta = {
                model: 'Intelligence v3.1',
                ai_base_sales: restoredSales,
                ai_hourly_data: restoredHourly,
                manual_override: false,
                overridden_by: null,
                overridden_by_role: null,
                overridden_at: null,
                growth_factor: freshAi.growth_factor_applied,
                base_sales: freshAi.base_sales,
                base_tickets: freshAi.base_tickets,
                avg_check_used: freshAi.avg_check_used,
                ticket_growth_factor: freshAi.ticket_growth_factor,
                holiday_multiplier: freshAi.holiday_multiplier,
                weather_adjusted: freshAi.weather_adjustment || false,
                weather_factor: freshAi.weather_factor,
                methodology: freshAi.methodology,
                confidence_low: freshAi.confidence_low,
                confidence_high: freshAi.confidence_high,
                sample_size: freshAi.sample_size,
                generated_at: new Date().toISOString(),
            }

            const { error: unlockErr } = await supabase
                .from('sales_projections_cache')
                .upsert({
                    store_id: externalStoreId,
                    business_date: businessDate,
                    total_sales: restoredSales,
                    hourly_data: restoredHourly,
                    meta: unlockedMeta,
                    updated_at: new Date().toISOString(),
                })

            if (unlockErr) {
                return NextResponse.json({ error: unlockErr.message }, { status: 500 })
            }

            await syncWeeklyBudgetDay(businessDate, Math.round(restoredSales))

            return NextResponse.json({
                success: true,
                action: 'unlock',
                businessDate,
                totalSales: Math.round(restoredSales),
                aiBaseSales: Math.round(restoredSales),
                manualOverride: false,
            })
        }

        // 4B. SET MANUAL STATIC OVERRIDE
        const parsedTarget = Math.round(Number(totalSales))
        if (!Number.isFinite(parsedTarget) || parsedTarget < 0 || parsedTarget > 250000) {
            return NextResponse.json(
                { error: 'Monto de venta proyectada inválido.' },
                { status: 400 }
            )
        }

        // Enforce Manager Sanity Guardrail (-40% to +50% over AI base) for store-level roles
        if (!isExecutiveOrSupervisor && aiBaseSales > 0) {
            const minAllowed = Math.round(aiBaseSales * MANAGER_MIN_RATIO)
            const maxAllowed = Math.round(aiBaseSales * MANAGER_MAX_RATIO)
            if (parsedTarget < minAllowed || parsedTarget > maxAllowed) {
                return NextResponse.json(
                    {
                        error: 'GUARDRAIL_EXCEEDED',
                        minAllowed,
                        maxAllowed,
                        aiBaseSales: Math.round(aiBaseSales),
                        message: `El ajuste manual debe estar entre $${minAllowed.toLocaleString('en-US')} y $${maxAllowed.toLocaleString('en-US')} (Base IA: $${Math.round(aiBaseSales).toLocaleString('en-US')}).`,
                    },
                    { status: 400 }
                )
            }
        }

        const scaledHourly = scaleHourlyMapExact(aiHourlyData, parsedTarget)
        const nowIso = new Date().toISOString()

        const updatedMeta = {
            ...baseMeta,
            model: 'Intelligence v3.1',
            ai_base_sales: aiBaseSales,
            ai_hourly_data: aiHourlyData,
            manual_override: true,
            overridden_by: actorName,
            overridden_by_role: effectiveRole,
            overridden_at: nowIso,
        }

        const { error: saveErr } = await supabase
            .from('sales_projections_cache')
            .upsert({
                store_id: externalStoreId,
                business_date: businessDate,
                total_sales: parsedTarget,
                hourly_data: scaledHourly,
                meta: updatedMeta,
                updated_at: nowIso,
            })

        if (saveErr) {
            return NextResponse.json({ error: saveErr.message }, { status: 500 })
        }

        await syncWeeklyBudgetDay(businessDate, parsedTarget)

        return NextResponse.json({
            success: true,
            action: 'set',
            businessDate,
            totalSales: parsedTarget,
            aiBaseSales: Math.round(aiBaseSales),
            manualOverride: true,
            overriddenBy: actorName,
            overriddenAt: nowIso,
        })
    } catch (error: any) {
        console.error('[Projections Override API] Error:', error)
        return NextResponse.json(
            { error: error.message || 'Error guardando ajuste de proyección' },
            { status: 500 }
        )
    }
}
