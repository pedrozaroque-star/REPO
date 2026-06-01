/**
 * @module api/cron/sync-food-cost
 *
 * MODULE:
 * Vercel Cron Job que pre-calcula y cachea los datos de Food Cost para el mes
 * actual completo. Garantiza que el dashboard de Food Cost siempre tenga datos
 * listos sin requerir visita manual de ningún usuario.
 *
 * BUSINESS RULES:
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
 * - PATRÓN DELETE-THEN-RECALCULATE: Igual que sync-sales, se borra
 *   explícitamente la entrada del día antes de recalcular para evitar
 *   datos duplicados o corruptos.
 *
 * DATA FLOW:
 * 1. Determina rango [1er día del mes → ayer] en timezone America/Los_Angeles
 * 2. Para cada día en el rango:
 *    a. Consulta `food_cost_daily_cache` → ¿existe? ¿es fresco (<12h)?
 *    b. Si es fresco → skip
 *    c. Si es stale o no existe → DELETE del cache viejo
 *    d. Llama a `/api/inventory/food-cost?storeId=all&startDate=X&endDate=X`
 *       (misma API que usa el dashboard, con write-through al cache)
 * 3. Retorna resumen de días procesados, cacheados, saltados y errores
 *
 * Dependencias:
 * - `/api/inventory/food-cost` → API interna que calcula food cost + escribe cache
 * - `@/lib/supabase` → `getSupabaseAdminClient` (acceso admin)
 * - Tabla `food_cost_daily_cache` → cache de resultados por business_date
 * - Variable `CRON_SECRET` → autenticación de Vercel Cron
 * - Variable `VERCEL_URL` → para construir la URL interna del API call
 *
 * NOTES:
 * - `maxDuration = 300` (5 min) es el máximo de Vercel Pro. Si hay muchos
 *   días sin cache (ej: inicio de mes) puede acercarse al límite.
 * - La llamada interna a `/api/inventory/food-cost` no requiere auth header
 *   porque es una API pública interna.
 * - En desarrollo local usa `http://localhost:3000` como baseUrl.
 */
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
