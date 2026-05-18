import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const maxDuration = 300 // 5 min max (Vercel Pro)

/**
 * BACKFILL: food-cost-daily-cache
 * 
 * Rellena días faltantes en food_cost_daily_cache para un rango de fechas.
 * Salta automáticamente los días que ya tienen cache.
 * 
 * Params:
 *   - startDate: YYYY-MM-DD (inicio del rango)
 *   - endDate: YYYY-MM-DD (fin del rango)
 *   - force: "true" para recalcular incluso si ya existe cache
 * 
 * Ejemplo:
 *   /api/cron/backfill-food-cost?startDate=2026-01-01&endDate=2026-04-26
 */
export async function GET(request: NextRequest) {
    try {
        // Validación opcional de Vercel Cron Secret
        const authHeader = request.headers.get('authorization')
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // Allow without secret for manual runs (localhost)
            const isLocal = request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1'
            if (!isLocal) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        const searchParams = request.nextUrl.searchParams
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const force = searchParams.get('force') === 'true'

        if (!startDate || !endDate) {
            return NextResponse.json({ 
                error: 'Parámetros requeridos: startDate y endDate (YYYY-MM-DD)',
                ejemplo: '/api/cron/backfill-food-cost?startDate=2026-01-01&endDate=2026-04-26'
            }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 1. Generar lista de todas las fechas en el rango
        const allDates: string[] = []
        const cursor = new Date(startDate + 'T12:00:00') // noon to avoid timezone issues
        const end = new Date(endDate + 'T12:00:00')

        while (cursor <= end) {
            const y = cursor.getFullYear()
            const m = String(cursor.getMonth() + 1).padStart(2, '0')
            const d = String(cursor.getDate()).padStart(2, '0')
            allDates.push(`${y}-${m}-${d}`)
            cursor.setDate(cursor.getDate() + 1)
        }

        // 2. Obtener fechas que ya tienen cache
        const { data: existingRows } = await supabase
            .from('food_cost_daily_cache')
            .select('business_date')
            .gte('business_date', startDate)
            .lte('business_date', endDate)

        const existingDates = new Set(
            (existingRows || []).map(r => r.business_date)
        )

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

        const baseUrl = process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : `http://localhost:${process.env.PORT || 3000}`

        const results: { date: string; status: string; error?: string }[] = []
        let successCount = 0
        let errorCount = 0

        // 4. Procesar secuencialmente (evita sobrecargar Toast API)
        for (const dateStr of datesToProcess) {
            try {
                // Borrar cache anterior si existe (para force mode)
                if (force) {
                    await supabase
                        .from('food_cost_daily_cache')
                        .delete()
                        .eq('business_date', dateStr)
                }

                const apiUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}`
                
                console.log(`🔄 [BACKFILL] Calculando ${dateStr} (${results.length + 1}/${datesToProcess.length})...`)

                const res = await fetch(apiUrl, {
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(60000) // 60s timeout per day
                })

                if (!res.ok) {
                    const errText = await res.text().catch(() => 'Unknown error')
                    throw new Error(`API ${res.status}: ${errText.substring(0, 200)}`)
                }

                const json = await res.json()
                const itemCount = json.data?.length || 0

                console.log(`✅ [BACKFILL] ${dateStr}: ${itemCount} items`)
                results.push({ date: dateStr, status: 'ok' })
                successCount++

            } catch (e: any) {
                console.error(`❌ [BACKFILL] ${dateStr}: ${e.message}`)
                results.push({ date: dateStr, status: 'error', error: e.message })
                errorCount++

                // Si hay muchos errores consecutivos, pausar para no saturar
                if (errorCount >= 5) {
                    console.warn('⚠️ [BACKFILL] Demasiados errores consecutivos, deteniendo.')
                    break
                }
            }

            // Pequeña pausa entre días para no saturar Toast API (rate limit 429)
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        console.log(`🏁 [BACKFILL] Completado: ${successCount} OK, ${errorCount} errores de ${datesToProcess.length} días.`)

        return NextResponse.json({
            success: true,
            totalDays: allDates.length,
            alreadyCached: existingDates.size,
            processed: datesToProcess.length,
            successCount,
            errorCount,
            results
        })

    } catch (e: any) {
        console.error(`💥 [BACKFILL FOOD-COST] Fatal:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
