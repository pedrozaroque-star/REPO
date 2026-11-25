/**
 * @module api/cron/sync-pmix
 * @description Vercel Cron Job daily sync that pulls the Product Mix (PMIX) from Toast API and updates the local daily cache.
 * 
 * @businessRules
 * - **Rango de Sincronización**: Sincroniza los últimos 4 días finalizados (omitiendo hoy) para capturar ajustes retroactivos de gerentes o facturaciones de catering tardías.
 * - **Sincronización Secuencial**: Ejecuta las consultas de tiendas y días de manera estrictamente secuencial para evitar exceder los límites de llamadas de la API de Toast (Error 429).
 * - **Persistencia Explícita**: Guarda los registros en `pmix_daily_cache` con un timestamp de actualización explícito (`updated_at`) para facilitar la lógica de auto-sanación de caché.
 * 
 * @dataFlow
 * - Supabase Stores table (Active Stores only) -> reads store external IDs -> triggers Toast Orders bulk endpoint via `getProductMix(skipCache: true)` -> upserts returned items into `pmix_daily_cache`.
 * 
 * @notes
 * - La caché autosanable invalidará estos registros en futuras consultas si la fecha de actualización `updated_at` es anterior a la fecha operativa.
 * - [2026-09-09] OPTIMIZATION: Removido el segundo upsert redundante a pmix_daily_cache ya que getProductMix persiste la data automáticamente con await.
 * - Blindaje Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor`.
 * - [2026-11-23] FIX CRÍTICO: Usa `getBusinessDateLA()` (regla 06:00 AM LA) e invalida `food_cost_daily_cache` para las fechas refrescadas para que `sync-food-cost` recalcule con el PMIX definitivo y `sales_daily_cache` cerrado.
 */
import { NextResponse } from 'next/server'
import { getProductMix } from '@/lib/toast-pmix'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import { addDaysIso, getBusinessDateLA } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Permitir hasta 5 minutos de ejecución en Vercel

export async function GET(request: Request) {
    const startedAt = Date.now()
    const TIME_BUDGET_MS = 245_000
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const url = new URL(request.url)
        const batchNum = Math.max(1, parseInt(url.searchParams.get('batch') || '1', 10) || 1)
        const totalBatches = Math.max(1, Math.min(5, parseInt(url.searchParams.get('batches') || '1', 10) || 1))
        const daysParam = parseInt(url.searchParams.get('days') || '', 10)

        const supabase = await getSupabaseAdminClient()
        const { data: rawStores } = await supabase
            .from('stores')
            .select('id, external_id, name')
            .eq('is_active', true)
            .order('id', { ascending: true })

        const activeStores = (rawStores || []).filter(s => Boolean(s.external_id))
        if (activeStores.length === 0) throw new Error("No active stores found.")

        // Dividir tiendas en lotes limpios cuando se invoca con `?batch=1&batches=2`
        const batchSize = Math.ceil(activeStores.length / totalBatches)
        const startIdx = (batchNum - 1) * batchSize
        const stores = activeStores.slice(startIdx, startIdx + batchSize)

        // Calcular días cerrados (regla 06:00 AM LA): 4 días los lunes para barrido semanal, 2 días mar–dom (o ?days=1..7)
        const todayBusinessDate = getBusinessDateLA()
        const dowUtc = new Date(`${todayBusinessDate}T12:00:00Z`).getUTCDay()
        const defaultDays = dowUtc === 1 ? 4 : 2
        const lookbackDays = Number.isFinite(daysParam) && daysParam >= 1 && daysParam <= 7 ? daysParam : defaultDays
        const datesToSync: string[] = Array.from({ length: lookbackDays }, (_, idx) =>
            addDaysIso(todayBusinessDate, -(idx + 1))
        )

        console.log(`⏰ [CRON PMIX] Lote ${batchNum}/${totalBatches} (${stores.length} tiendas) | fechas cerradas: ${datesToSync.join(', ')} (hoy laboral=${todayBusinessDate})`)

        const results = []
        const refreshedDates = new Set<string>()
        let stoppedByTimeBudget = false

        // Iterar días y tiendas secuencialmente para evitar Rate Limits (429) de Toast
        for (const dateStr of datesToSync) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) {
                stoppedByTimeBudget = true
                break
            }
            for (const store of stores) {
                if (Date.now() - startedAt > TIME_BUDGET_MS) {
                    stoppedByTimeBudget = true
                    break
                }
                if (!store.external_id) continue

                try {
                    const items = await getProductMix({
                        storeId: store.external_id,
                        startDate: dateStr,
                        endDate: dateStr,
                        bundleModifiers: true,
                        mergeDiningOptions: false,
                        skipCache: true
                    })

                    refreshedDates.add(dateStr)
                    results.push({ store: store.name, date: dateStr, items: items.length, status: 'synced_and_saved' })
                } catch (e: any) {
                    console.error(`❌ [CRON PMIX] Error en ${store.name} el ${dateStr}:`, e.message)
                    results.push({ store: store.name, date: dateStr, error: e.message })
                }
            }
        }

        // BLINDAJE CERO BLACKOUT: NO borramos `food_cost_daily_cache` aquí.
        // `sync-food-cost` compara `MAX(pmix_daily_cache.updated_at) > MIN(food_cost_daily_cache.updated_at)`
        // y refresca atómicamente vía UPSERT sin dejar días vacíos que disparen tormentas live desde dashboards.
        const refreshedList = Array.from(refreshedDates)
        console.log(`✅ [CRON PMIX] Lote ${batchNum}/${totalBatches} completado en ${Date.now() - startedAt}ms.`)
        return NextResponse.json({
            success: true,
            batch: batchNum,
            batches: totalBatches,
            elapsed_ms: Date.now() - startedAt,
            stopped_by_time_budget: stoppedByTimeBudget,
            today_business_date: todayBusinessDate,
            processed_dates: datesToSync,
            refreshed_pmix_dates: refreshedList,
            results,
        })

    } catch (e: any) {
        console.error(`💥 [CRON PMIX] Fatal error:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
