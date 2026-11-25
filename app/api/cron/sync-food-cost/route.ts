/**
 * @module api/cron/sync-food-cost
 * @description Vercel Cron Job que pre-calcula y cachea los datos de Food Cost para el mes
 * actual completo. Garantiza que el dashboard de Food Cost siempre tenga datos
 * listos sin requerir visita manual de ningún usuario.
 *
 * @businessRules
 * - SCHEDULE: Se ejecuta después de sync-sales (UTC 19:00 = 11:00 AM PT).
 *   Esto asegura que las ventas del día anterior ya estén sincronizadas
 *   cuando se calculan los costos.
 * - RANGO DE FECHAS: Día 1 del mes actual → ayer. Solo procesa días
 *   finalizados (nunca el día en curso, porque las ventas aún no cierran).
 * - REGLA DE LAS 6 AM: El día laboral empieza a las 6:00 AM y termina a las
 *   5:59 AM del día siguiente. Si el cron se ejecuta antes de las 6 AM,
 *   "hoy" operativo es el día anterior.
 * - CACHE FRESCOS: Si un día ya tiene cache con menos de 12 horas de
 *   antigüedad, se salta (skip) para no desperdiciar compute.
 * - CACHE STALE: Si el cache tiene más de 12h, se borra y se recalcula
 *   para capturar ajustes de gerentes (ej: recetas editadas, precios
 *   corregidos durante el día).
 *
 * @dataFlow
 * 1. Determina rango [1er día del mes → ayer] en timezone America/Los_Angeles
 * 2. Para cada día en el rango:
 *    a. Consulta `food_cost_daily_cache` → ¿existe? ¿es fresco (<12h)?
 *    b. Si es fresco → skip
 *    c. Si es stale o no existe → llama a `/api/inventory/food-cost?storeId=all&startDate=X&endDate=X`
 * 3. Retorna resumen de días procesados, cacheados, saltados y errores
 *
 * @notes
 * - `maxDuration = 300` (5 min) es el máximo de Vercel Pro.
 * - En desarrollo local usa `http://localhost:3000` como baseUrl.
 * - [2026-07-27] CAPA B: Agregada detección automática de anomalías (items con FC > 100%).
 * - Blindaje Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor`.
 * - [2026-11-23] FIX CRÍTICO: (1) Eliminado bug de fin de mes garantizando que `datesToSync` SIEMPRE cubra al menos
 *   los últimos 7 días laborales cerrados (incluyendo `yesterday` el día 1 de cada mes) más todo el MTD;
 *   (2) Validación de cobertura completa de tiendas (`>= 14`) y que el caché haya sido escrito DESPUÉS del cierre de las 06:00 AM LA;
 *   (3) Persistido `toast_item_guid: a.guid || null`, sucursal `[Store] Item` en `item_name` y `store_number`/`store_name` dinámicos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { buildInternalCronAuthHeaders, verifyStaffAuth } from '@/lib/auth-server'
import {
    addDaysIso,
    getBusinessDateLA,
    isInvalidFoodCostCacheRow,
} from '@/lib/inventory/food-cost-sales-resolver'
import { syncDailyInventoryUsage } from '@/lib/inventory/usage-sync'
import { GET as foodCostGet } from '@/app/api/inventory/food-cost/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutos máximo en Vercel (Pro)

export async function GET(request: Request) {
    const startedAt = Date.now()
    const TIME_BUDGET_MS = 230_000
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const supabase = await getSupabaseAdminClient()
        const now = new Date()

        // 1. Obtener fecha laboral actual en LA timezone (regla 06:00 AM)
        const todayBusinessDate = getBusinessDateLA(now)
        const yesterdayStr = addDaysIso(todayBusinessDate, -1)
        const fourDaysAgoStr = addDaysIso(todayBusinessDate, -4)
        const sevenDaysAgoStr = addDaysIso(todayBusinessDate, -7)
        const firstOfMonthStr = `${todayBusinessDate.slice(0, 8)}01`

        // Garantizar SIEMPRE al menos los últimos 7 días cerrados + MTD completo, ordenados DEL MÁS RECIENTE AL MÁS ANTIGUO
        const rangeStartStr = firstOfMonthStr < sevenDaysAgoStr ? firstOfMonthStr : sevenDaysAgoStr

        const datesToSync: string[] = []
        let cur = yesterdayStr
        while (cur >= rangeStartStr) {
            datesToSync.push(cur)
            cur = addDaysIso(cur, -1)
        }

        // Cargar tiendas activas y detectar dinámicamente columnas opcionales de sucursal en food_cost_anomalies
        const { data: activeStoresData } = await supabase
            .from('stores')
            .select('id, name, external_id')
            .eq('is_active', true)
        const validActiveStores = (activeStoresData || []).filter(s => Boolean(s.external_id))
        const storeByExternalId = new Map<string, { id: number; name: string; external_id: string }>(
            validActiveStores.map(s => [s.external_id as string, { id: Number(s.id), name: s.name || 'Unknown', external_id: s.external_id as string }])
        )
        const minExpectedStores = Math.max(1, validActiveStores.length - 1)

        // Consultar updated_at máximo de `pmix_daily_cache` (solo metadatos, SIN columna `items` JSONB!) para detectar días refrescados por sync-pmix
        const latestPmixUpdatedByDate = new Map<string, number>()
        const { data: pmixMetaRows } = await supabase
            .from('pmix_daily_cache')
            .select('business_date, updated_at')
            .gte('business_date', fourDaysAgoStr)
            .lte('business_date', yesterdayStr)
        for (const r of pmixMetaRows || []) {
            if (!r.business_date || !r.updated_at) continue
            const ts = Date.parse(String(r.updated_at))
            if (!Number.isFinite(ts)) continue
            const prev = latestPmixUpdatedByDate.get(String(r.business_date)) || 0
            if (ts > prev) latestPmixUpdatedByDate.set(String(r.business_date), ts)
        }

        const { error: storeColsProbeErr } = await supabase
            .from('food_cost_anomalies')
            .select('store_number, store_name')
            .limit(0)
        const hasAnomalyStoreCols = !storeColsProbeErr

        console.log(`⏰ [CRON FOOD-COST] Verificando ${datesToSync.length} días cerrados (reciente→antiguo): ${datesToSync[0]} → ${datesToSync[datesToSync.length - 1]} (hoy laboral=${todayBusinessDate})`)

        const results = []
        const remainingDates: string[] = []

        // 3. Para cada día, saltar históricos ya cerrados (>4d) sin caducidad falsa de 12h; en ventana 4d solo recalcular si PMIX es más reciente o falta cobertura
        for (let idx = 0; idx < datesToSync.length; idx++) {
            const dateStr = datesToSync[idx]
            if (Date.now() - startedAt > TIME_BUDGET_MS) {
                remainingDates.push(...datesToSync.slice(idx))
                console.warn(`⏱️ [CRON FOOD-COST] Presupuesto de tiempo (${TIME_BUDGET_MS}ms) alcanzado; ${remainingDates.length} días pendientes para siguiente corrida.`)
                break
            }

            try {
                const { data: cachedDayRows, error: checkErr } = await supabase
                    .from('food_cost_daily_cache')
                    .select('store_id, total_cost, net_sales, updated_at')
                    .eq('business_date', dateStr)

                if (checkErr) {
                    console.error(`❌ [CRON FOOD-COST] Error verificando cache para ${dateStr}:`, checkErr.message)
                }

                const validRows = (cachedDayRows || []).filter(
                    r => !isInvalidFoodCostCacheRow(Number(r.total_cost) || 0, Number(r.net_sales) || 0)
                )
                const hasCompleteStoreCoverage = validRows.length >= minExpectedStores
                const allWrittenAfterClose = hasCompleteStoreCoverage && validRows.every(r => {
                    if (!r.updated_at) return false
                    return getBusinessDateLA(new Date(r.updated_at)) > dateStr
                })

                let isCacheUpToDate = false
                if (allWrittenAfterClose) {
                    if (dateStr < fourDaysAgoStr) {
                        isCacheUpToDate = true
                    } else {
                        const minFcUpdatedMs = validRows.reduce((min, r) => {
                            const ts = Date.parse(String(r.updated_at || ''))
                            return Number.isFinite(ts) && ts < min ? ts : min
                        }, Number.POSITIVE_INFINITY)
                        const maxPmixUpdatedMs = latestPmixUpdatedByDate.get(dateStr) || 0
                        isCacheUpToDate = minFcUpdatedMs >= maxPmixUpdatedMs
                    }
                }

                if (isCacheUpToDate) {
                    results.push({ date: dateStr, status: 'skipped_fresh_cache', stores: validRows.length })
                    continue
                }

                console.log(`🔄 [CRON FOOD-COST] Calculando ${dateStr}...`)
                const directReq = new NextRequest(
                    `http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}&bypassCache=1`,
                    { headers: buildInternalCronAuthHeaders(request) }
                )
                const directRes = await foodCostGet(directReq)
                if (!directRes.ok) {
                    const errTxt = await directRes.text().catch(() => '')
                    throw new Error(`In-process responded ${directRes.status}: ${errTxt.slice(0, 200)}`)
                }
                const json = await directRes.json()

                const itemCount = json?.data?.length || 0

                // ═══ CAPA B: Detección automática de anomalías de Food Cost ═══
                // Previene bugs tipo Milaneza (FC 560% por 5 meses sin detectar)
                // Escanea items con FC > 100% y los PERSISTE en food_cost_anomalies
                try {
                    const items = json.data || []
                    const anomalies = items.filter((item: any) =>
                        item.has_recipe &&
                        item.food_cost_percent > 100 &&
                        item.total_cost > 10
                    )

                    if (anomalies.length > 0) {
                        console.warn(`🚨 [CRON FOOD-COST] ¡ANOMALÍAS DETECTADAS en ${dateStr}! ${anomalies.length} items con FC > 100%:`)
                        anomalies.slice(0, 10).forEach((a: any) => {
                            console.warn(`   🔴 [${a.store_name || 'Store'}] "${a.name}" — FC: ${Number(a.food_cost_percent).toFixed(1)}% | Cost: $${Number(a.total_cost).toFixed(2)} | Qty: ${a.quantity}`)
                        })

                        // Persistir anomalías en food_cost_anomalies incluyendo sucursal y toast_item_guid real
                        const anomalyRows = anomalies.map((a: any) => {
                            const matchedStore = a.store_id ? storeByExternalId.get(a.store_id) : undefined
                            const storeLabel = (a.store_name || matchedStore?.name || '').trim()
                            const rawItemName = String(a.name || 'Unknown Item')
                            const labeledItemName = storeLabel && !rawItemName.startsWith(`[${storeLabel}]`)
                                ? `[${storeLabel}] ${rawItemName}`
                                : rawItemName

                            const row: Record<string, any> = {
                                business_date: dateStr,
                                item_name: labeledItemName,
                                toast_item_guid: a.guid || a.toast_guid || null,
                                food_cost_percent: Number(Number(a.food_cost_percent || 0).toFixed(2)),
                                total_cost: Number(Number(a.total_cost || 0).toFixed(2)),
                                quantity: Math.round(Number(a.quantity) || 0),
                                severity: Number(a.food_cost_percent) > 200 ? 'critical' : 'warning'
                            }
                            if (hasAnomalyStoreCols) {
                                row.store_number = matchedStore?.id ? Number(matchedStore.id) : null
                                row.store_name = storeLabel || null
                            }
                            return row
                        })

                        // Borrar anomalías previas del mismo día para evitar duplicados
                        await supabase
                            .from('food_cost_anomalies')
                            .delete()
                            .eq('business_date', dateStr)
                            .eq('resolved', false)

                        const { error: insertErr } = await supabase
                            .from('food_cost_anomalies')
                            .insert(anomalyRows)

                        if (insertErr) {
                            console.error(`⚠️ [CRON FOOD-COST] Error persistiendo anomalías:`, insertErr.message)
                        } else {
                            console.warn(`   💾 ${anomalyRows.length} anomalías guardadas en food_cost_anomalies`)
                        }
                    } else {
                        // Si NO hay anomalías para este día, auto-resolver las viejas
                        await supabase
                            .from('food_cost_anomalies')
                            .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: 'cron-auto' })
                            .eq('business_date', dateStr)
                            .eq('resolved', false)
                    }
                } catch (anomalyErr: any) {
                    // Non-blocking: anomaly detection should never break the cron
                    console.error(`⚠️ [CRON FOOD-COST] Anomaly scan error (non-blocking):`, anomalyErr.message)
                }
                // ═══ END CAPA B ═══

                // Sincronizar consumo teórico en `inventory_usage_log` para días recientes (últimos 4 días) o cuando falte cobertura
                try {
                    let shouldRunUsageSync = dateStr >= fourDaysAgoStr
                    if (!shouldRunUsageSync) {
                        const { count: existingUsageCount } = await supabase
                            .from('inventory_usage_log')
                            .select('*', { count: 'exact', head: true })
                            .eq('business_date', dateStr)
                        shouldRunUsageSync = (existingUsageCount || 0) < validActiveStores.length
                    }
                    if (shouldRunUsageSync) {
                        for (const s of validActiveStores) {
                            if (Date.now() - startedAt > TIME_BUDGET_MS) break
                            if (s.external_id) {
                                await syncDailyInventoryUsage(s.external_id, dateStr)
                            }
                        }
                    }
                } catch (usageErr: any) {
                    console.error(`⚠️ [CRON FOOD-COST] Error al sincronizar inventory_usage_log para ${dateStr}:`, usageErr.message)
                }

                console.log(`✅ [CRON FOOD-COST] ${dateStr}: ${itemCount} items procesados y cacheados.`)
                results.push({ date: dateStr, status: 'calculated_and_cached', items: itemCount })

            } catch (e: any) {
                console.error(`❌ [CRON FOOD-COST] Error en ${dateStr}:`, e.message)
                results.push({ date: dateStr, status: 'error', error: e.message })
            }
        }

        console.log(`✅ [CRON FOOD-COST] Operación completada (${Date.now() - startedAt}ms).`)
        return NextResponse.json({
            success: true,
            elapsed_ms: Date.now() - startedAt,
            processed_dates: datesToSync,
            remaining_dates: remainingDates,
            results,
            processed_at: new Date().toISOString()
        })

    } catch (e: any) {
        console.error(`💥 [CRON FOOD-COST] Fatal error:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
