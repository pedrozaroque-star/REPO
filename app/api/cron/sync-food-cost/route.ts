import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const maxDuration = 300 // 5 minutos máximo en Vercel (Pro)

/**
 * CRON: sync-food-cost
 * 
 * Pre-calcula y cachea los datos de Food Cost para los últimos 4 días finalizados.
 * Réplica exacta del patrón de sync-sales: llama a la API existente de food-cost
 * que ya hace el cálculo completo + write-through al cache.
 * 
 * Esto garantiza que al abrir el módulo de Ventas, el Food Cost siempre tenga
 * datos pre-calculados (igual que las ventas), sin necesidad de visita manual.
 * 
 * Schedule recomendado: Después de sync-sales y sync-pmix (UTC 19:00 = 11:00 AM PT)
 * para asegurar que los datos de ventas (net_sales) ya existan cuando calculamos el %.
 */
export async function GET(request: Request) {
    try {
        // Validación de Vercel Cron Secret
        const authHeader = request.headers.get('authorization')
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabase = await getSupabaseAdminClient()

        // 1. Obtener fecha actual en LA timezone
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        // 2. Calcular los últimos 4 días finalizados (NO incluir "Hoy" = volátil)
        const datesToSync: string[] = []
        for (let i = 1; i <= 4; i++) {
            const d = new Date(laNow)
            d.setDate(d.getDate() - i)
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            datesToSync.push(`${y}-${m}-${day}`)
        }

        console.log(`⏰ [CRON FOOD-COST] Iniciando cálculo para: ${datesToSync.join(', ')}`)

        const results = []

        // 3. Para cada día, verificar si ya hay cache y si no, calcular
        for (const dateStr of datesToSync) {
            try {
                // Verificar si ya existe cache para este día
                const { data: existing, error: checkErr } = await supabase
                    .from('food_cost_daily_cache')
                    .select('business_date')
                    .eq('business_date', dateStr)
                    .limit(1)

                if (checkErr) {
                    console.error(`❌ [CRON FOOD-COST] Error verificando cache para ${dateStr}:`, checkErr.message)
                }

                // Si ya tiene cache, verificar si es "fresco" (menos de 12h)
                // Si es viejo, recalcular para capturar ajustes de gerentes
                const { data: freshCheck } = await supabase
                    .from('food_cost_daily_cache')
                    .select('updated_at')
                    .eq('business_date', dateStr)
                    .order('updated_at', { ascending: false })
                    .limit(1)

                const isStale = !freshCheck || freshCheck.length === 0 || (() => {
                    const updatedAt = new Date(freshCheck[0].updated_at)
                    const hoursAgo = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60)
                    return hoursAgo > 12 // Recalcular si tiene más de 12 horas
                })()

                if (existing && existing.length > 0 && !isStale) {
                    console.log(`⏭️ [CRON FOOD-COST] Cache fresco para ${dateStr}, saltando.`)
                    results.push({ date: dateStr, status: 'skipped_fresh_cache' })
                    continue
                }

                // 4. Borrar cache anterior para este día (igual que sync-sales)
                const { error: deleteError } = await supabase
                    .from('food_cost_daily_cache')
                    .delete()
                    .eq('business_date', dateStr)

                if (deleteError) {
                    console.error(`⚠️ [CRON FOOD-COST] Error borrando cache para ${dateStr}:`, deleteError.message)
                }

                // 5. Llamar a la API de food-cost que ya tiene todo el cálculo + write-through
                // Construimos la URL interna (mismo servidor)
                const baseUrl = process.env.VERCEL_URL 
                    ? `https://${process.env.VERCEL_URL}` 
                    : 'http://localhost:3000'
                
                const apiUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}`
                
                console.log(`🔄 [CRON FOOD-COST] Calculando ${dateStr}...`)
                
                const res = await fetch(apiUrl, {
                    headers: {
                        // No necesita auth header ya que es una API interna pública
                        'Content-Type': 'application/json'
                    }
                })

                if (!res.ok) {
                    const errorText = await res.text()
                    throw new Error(`API responded ${res.status}: ${errorText}`)
                }

                const json = await res.json()
                const itemCount = json.data?.length || 0

                console.log(`✅ [CRON FOOD-COST] ${dateStr}: ${itemCount} items procesados y cacheados.`)
                results.push({ date: dateStr, status: 'calculated_and_cached', items: itemCount })

            } catch (e: any) {
                console.error(`❌ [CRON FOOD-COST] Error en ${dateStr}:`, e.message)
                results.push({ date: dateStr, status: 'error', error: e.message })
            }
        }

        console.log(`✅ [CRON FOOD-COST] Operación completada.`)
        return NextResponse.json({
            success: true,
            processed_dates: datesToSync,
            results,
            processed_at: new Date().toISOString()
        })

    } catch (e: any) {
        console.error(`💥 [CRON FOOD-COST] Fatal error:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
