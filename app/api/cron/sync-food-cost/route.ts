import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const maxDuration = 300 // 5 minutos máximo en Vercel (Pro)

/**
 * CRON: sync-food-cost
 * 
 * Pre-calcula y cachea los datos de Food Cost desde el día 1 del mes actual
 * hasta ayer (días finalizados). Garantiza que el dashboard siempre muestre
 * el Food Cost del mes completo sin visita manual.
 * 
 * Réplica exacta del patrón de sync-sales: llama a la API existente de food-cost
 * que ya hace el cálculo completo + write-through al cache.
 * 
 * Schedule: Después de sync-sales (UTC 19:00 = 11:00 AM PT)
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

        // Regla de las 6 AM: si es antes de las 6am, el "hoy" operativo es ayer
        if (laNow.getHours() < 6) laNow.setDate(laNow.getDate() - 1)

        // 2. Rango: día 1 del mes actual → ayer (solo días finalizados, NO hoy)
        const yesterday = new Date(laNow)
        yesterday.setDate(yesterday.getDate() - 1)
        const firstOfMonth = new Date(laNow.getFullYear(), laNow.getMonth(), 1)

        const datesToSync: string[] = []
        const cursor = new Date(firstOfMonth)
        while (cursor <= yesterday) {
            const y = cursor.getFullYear()
            const m = String(cursor.getMonth() + 1).padStart(2, '0')
            const day = String(cursor.getDate()).padStart(2, '0')
            datesToSync.push(`${y}-${m}-${day}`)
            cursor.setDate(cursor.getDate() + 1)
        }

        console.log(`⏰ [CRON FOOD-COST] Sincronizando ${datesToSync.length} días: ${datesToSync[0]} → ${datesToSync[datesToSync.length - 1]}`)

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
