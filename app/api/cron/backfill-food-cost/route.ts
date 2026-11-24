/**
 * @module api/cron/backfill-food-cost
 * @description Rellena días históricos faltantes en `food_cost_daily_cache` para un rango de fechas especificado (`startDate` a `endDate`).
 *
 * @businessRules
 * - Salta automáticamente los días que ya tienen caché salvo que se indique `?force=true`.
 * - Procesa secuencialmente con pausa de 1s entre días y freno automático tras 5 errores consecutivos para proteger los límites de Toast API (429).
 *
 * @dataFlow
 * - Admin / Vercel Cron -> `GET /api/cron/backfill-food-cost` -> `food_cost_daily_cache` -> `/api/inventory/food-cost` -> respuesta JSON.
 *
 * @notes
 * - Autenticación Fail-Closed mediante `verifyStaffAuth` (`CRON_SECRET` o rol `admin`/`supervisor`).
 * - [2026-11-23] Paginación determinista `.order('id').range()` en `food_cost_daily_cache` (inmune al tope de 1,000 filas en rangos > 66 días), invocación directa in-process `foodCostGet` con fallback HTTP seguro, reseteo de `consecutiveErrors` tras éxito y eliminación del borrado destructivo previo al fetch en modo `force=true`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { buildInternalCronAuthHeaders, verifyStaffAuth } from '@/lib/auth-server'
import {
    addDaysIso,
    isInvalidFoodCostCacheRow,
    isValidIsoDate,
} from '@/lib/inventory/food-cost-sales-resolver'
import { GET as foodCostGet } from '@/app/api/inventory/food-cost/route'

export const maxDuration = 300 // 5 min max (Vercel Pro)

export async function GET(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const searchParams = request.nextUrl.searchParams
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const force = searchParams.get('force') === 'true'

        if (!startDate || !endDate || !isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
            return NextResponse.json({ 
                error: 'Parámetros requeridos válidos: startDate y endDate (YYYY-MM-DD con startDate <= endDate)',
                ejemplo: '/api/cron/backfill-food-cost?startDate=2026-01-01&endDate=2026-04-26'
            }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 1. Generar lista de todas las fechas en el rango usando aritmética UTC pura (inmune a DST)
        const allDates: string[] = []
        let cur = startDate
        while (cur <= endDate) {
            allDates.push(cur)
            cur = addDaysIso(cur, 1)
        }

        // 2. Obtener conteo de tiendas activas y paginar food_cost_daily_cache (> 1,000 filas seguro)
        const { data: activeStores } = await supabase
            .from('stores')
            .select('external_id')
            .eq('is_active', true)
        const validActiveCount = (activeStores || []).filter(s => Boolean(s.external_id)).length
        const minStoresForCompleteDay = Math.max(1, validActiveCount - 1)

        const existingRows: { id: string; business_date: string; store_id: string; total_cost: number; net_sales: number }[] = []
        let offset = 0
        const PAGE_SIZE = 1000
        while (true) {
            const { data: page, error: pageErr } = await supabase
                .from('food_cost_daily_cache')
                .select('id, business_date, store_id, total_cost, net_sales')
                .gte('business_date', startDate)
                .lte('business_date', endDate)
                .order('id', { ascending: true })
                .range(offset, offset + PAGE_SIZE - 1)
            if (pageErr) throw pageErr
            if (!page || page.length === 0) break
            existingRows.push(...page)
            if (page.length < PAGE_SIZE) break
            offset += PAGE_SIZE
        }

        const validStoresPerDate = new Map<string, Set<string>>()
        for (const r of existingRows) {
            if (isInvalidFoodCostCacheRow(Number(r.total_cost) || 0, Number(r.net_sales) || 0)) continue
            if (!validStoresPerDate.has(r.business_date)) {
                validStoresPerDate.set(r.business_date, new Set())
            }
            validStoresPerDate.get(r.business_date)!.add(r.store_id)
        }

        const existingDates = new Set<string>()
        validStoresPerDate.forEach((storesSet, dt) => {
            if (storesSet.size >= minStoresForCompleteDay) {
                existingDates.add(dt)
            }
        })

        // 3. Filtrar solo las que faltan (o todas si force=true)
        const datesToProcess = force 
            ? allDates 
            : allDates.filter(d => !existingDates.has(d))

        console.log(`🔧 [BACKFILL FOOD-COST] Rango: ${startDate} → ${endDate}`)
        console.log(`📊 Total días: ${allDates.length} | Ya cacheados: ${existingDates.size} | A procesar: ${datesToProcess.length}`)

        if (datesToProcess.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'Todos los días ya tienen cache. Usa ?force=true para recalcular.',
                totalDays: allDates.length,
                alreadyCached: existingDates.size,
                processed: 0
            })
        }

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL
            ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
            : (process.env.VERCEL_PROJECT_PRODUCTION_URL
                ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
                : (process.env.VERCEL_URL
                    ? `https://${process.env.VERCEL_URL}`
                    : `http://localhost:${process.env.PORT || 3000}`))

        const results: { date: string; status: string; items?: number; error?: string }[] = []
        let successCount = 0
        let totalErrorCount = 0
        let consecutiveErrors = 0

        // 4. Procesar secuencialmente (evita sobrecargar Toast API; NUNCA borra caché antes del fetch)
        for (const dateStr of datesToProcess) {
            const fetchStartedIso = new Date().toISOString()
            try {
                console.log(`🔄 [BACKFILL] Calculando ${dateStr} (${results.length + 1}/${datesToProcess.length})...`)

                let itemCount = 0
                try {
                    const directReq = new NextRequest(
                        `http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}`,
                        { headers: buildInternalCronAuthHeaders(request) }
                    )
                    const directRes = await foodCostGet(directReq)
                    if (!directRes.ok) {
                        const errTxt = await directRes.text().catch(() => 'Unknown error')
                        throw new Error(`In-process ${directRes.status}: ${errTxt.substring(0, 200)}`)
                    }
                    const directJson = await directRes.json()
                    itemCount = directJson.data?.length || 0
                } catch (inProcessErr: any) {
                    console.warn(`⚠️ [BACKFILL] In-process falló en ${dateStr} (${inProcessErr.message}), usando fallback HTTP...`)
                    const apiUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}`
                    const res = await fetch(apiUrl, {
                        headers: {
                            'Content-Type': 'application/json',
                            ...buildInternalCronAuthHeaders(request)
                        },
                        signal: AbortSignal.timeout(60000)
                    })
                    if (!res.ok) {
                        const errText = await res.text().catch(() => 'Unknown error')
                        throw new Error(`API ${res.status}: ${errText.substring(0, 200)}`)
                    }
                    const json = await res.json()
                    itemCount = json.data?.length || 0
                }

                // En modo force=true, limpiar filas huérfanas antiguas ÚNICAMENTE DESPUÉS de que el nuevo cálculo haya hecho upsert exitoso
                if (force && itemCount > 0) {
                    await supabase
                        .from('food_cost_daily_cache')
                        .delete()
                        .eq('business_date', dateStr)
                        .lt('updated_at', fetchStartedIso)
                }

                console.log(`✅ [BACKFILL] ${dateStr}: ${itemCount} items`)
                results.push({ date: dateStr, status: itemCount > 0 ? 'ok' : 'empty_pmix', items: itemCount })
                successCount++
                consecutiveErrors = 0 // Resetear racha de errores tras éxito

            } catch (e: any) {
                console.error(`❌ [BACKFILL] ${dateStr}: ${e.message}`)
                results.push({ date: dateStr, status: 'error', error: e.message })
                totalErrorCount++
                consecutiveErrors++

                // Si hay 5 errores CONSECUTIVOS, pausar para no saturar Toast API
                if (consecutiveErrors >= 5) {
                    console.warn('⚠️ [BACKFILL] 5 errores consecutivos alcanzados, deteniendo ejecución.')
                    break
                }
            }

            // Pequeña pausa entre días para no saturar Toast API (rate limit 429)
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        console.log(`🏁 [BACKFILL] Completado: ${successCount} OK, ${totalErrorCount} errores de ${datesToProcess.length} días.`)

        return NextResponse.json({
            success: true,
            totalDays: allDates.length,
            alreadyCached: existingDates.size,
            processed: results.length,
            requestedToProcess: datesToProcess.length,
            successCount,
            errorCount: totalErrorCount,
            stoppedByConsecutiveErrors: consecutiveErrors >= 5,
            results
        })

    } catch (e: any) {
        console.error(`💥 [BACKFILL FOOD-COST] Fatal:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
