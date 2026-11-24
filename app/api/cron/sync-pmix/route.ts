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

export const maxDuration = 300 // Permitir hasta 5 minutos de ejecución en Vercel

export async function GET(request: Request) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const supabase = await getSupabaseAdminClient()
        const { data: stores } = await supabase.from('stores').select('external_id, name').eq('is_active', true)

        if (!stores || stores.length === 0) throw new Error("No active stores found.")

        // Calcular los últimos 4 días laborales cerrados usando la regla oficial de las 06:00 AM LA
        const todayBusinessDate = getBusinessDateLA()
        const datesToSync: string[] = [1, 2, 3, 4].map(i => addDaysIso(todayBusinessDate, -i))

        console.log(`⏰ [CRON PMIX] Iniciando validación PMIX para las fechas cerradas: ${datesToSync.join(', ')} (hoy laboral=${todayBusinessDate})`)

        const results = []
        const refreshedDates = new Set<string>()

        // Iterar días y tiendas secuencialmente para evitar Rate Limits (429) de Toast
        for (const dateStr of datesToSync) {
            for (const store of stores) {
                if (!store.external_id) continue

                try {
                    // skipCache: true obliga a Toast a descargar los datos reales otra vez
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

        // Invalidar food_cost_daily_cache de los días cuyo PMIX acaba de refrescarse para que sync-food-cost los recalcule al 100%
        const invalidatedDates = Array.from(refreshedDates)
        if (invalidatedDates.length > 0) {
            const { error: invErr } = await supabase
                .from('food_cost_daily_cache')
                .delete()
                .in('business_date', invalidatedDates)

            if (invErr) {
                console.warn(`⚠️ [CRON PMIX] No se pudo invalidar food_cost_daily_cache para [${invalidatedDates.join(', ')}]:`, invErr.message)
            } else {
                console.log(`🧹 [CRON PMIX] Invalidado food_cost_daily_cache para [${invalidatedDates.join(', ')}] previo a sync-food-cost.`)
            }
        }

        console.log(`✅ [CRON PMIX] Operación completada exitosamente.`)
        return NextResponse.json({
            success: true,
            today_business_date: todayBusinessDate,
            processed_dates: datesToSync,
            invalidated_food_cost_dates: invalidatedDates,
            results,
        })

    } catch (e: any) {
        console.error(`💥 [CRON PMIX] Fatal error:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
