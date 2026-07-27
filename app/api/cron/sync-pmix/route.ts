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
 */
import { NextResponse } from 'next/server'
import { getProductMix } from '@/lib/toast-pmix'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const maxDuration = 300 // Permitir hasta 5 minutos de ejecución en Vercel

export async function GET(request: Request) {
    try {
        // Validación de Vercel Cron Secret
        const authHeader = request.headers.get('authorization')
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabase = await getSupabaseAdminClient()
        const { data: stores } = await supabase.from('stores').select('external_id, name').eq('is_active', true)

        if (!stores || stores.length === 0) throw new Error("No active stores found.")

        // Calcular los últimos 4 días finalizados (Omitiendo "Hoy")
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        const datesToSync: string[] = []
        for (let i = 1; i <= 4; i++) {
            const d = new Date(laNow)
            d.setDate(d.getDate() - i)
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            datesToSync.push(`${y}-${m}-${day}`)
        }

        console.log(`⏰ [CRON PMIX] Iniciando validación PMIX para las fechas: ${datesToSync.join(', ')}`)

        const results = []

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

                    if (items.length > 0) {
                        const { error } = await supabase.from('pmix_daily_cache').upsert({
                            store_id: store.external_id,
                            business_date: dateStr,
                            items: items,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'store_id,business_date' })

                        if (error) throw error
                    }

                    results.push({ store: store.name, date: dateStr, items: items.length, status: 'synced_and_saved' })
                } catch (e: any) {
                    console.error(`❌ [CRON PMIX] Error en ${store.name} el ${dateStr}:`, e.message)
                    results.push({ store: store.name, date: dateStr, error: e.message })
                }
            }
        }

        console.log(`✅ [CRON PMIX] Operación completada exitosamente.`)
        return NextResponse.json({ success: true, processed_dates: datesToSync, results })

    } catch (e: any) {
        console.error(`💥 [CRON PMIX] Fatal error:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
