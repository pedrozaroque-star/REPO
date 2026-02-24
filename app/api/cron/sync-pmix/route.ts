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

                    // Aseguramos la persistencia "Awaitable" (Fire-and-forget puede morir en Serverless)
                    if (items.length > 0) {
                        const { error } = await supabase.from('pmix_daily_cache').upsert({
                            store_id: store.external_id,
                            business_date: dateStr,
                            items: items
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
