/**
 * @module api/cron/sync-food-cost-today/route
 * @description Cron job periódica ejecutada cada 5 minutos durante el horario operativo (6:00 AM a 4:59 AM del día siguiente) para pre-calcular y cachear el Food Cost del día en curso ("Hoy") para las 15 sucursales de Tacos Gavilan en Supabase food_cost_daily_cache.
 * @businessRules
 * - El día laboral empieza a las 6:00 AM y termina a las 5:59 AM del siguiente día (PST/PDT America/Los_Angeles).
 * - Ocurre rollover de fecha a las 6:00 AM. Antes de las 6:00 AM pertenece al día anterior.
 * - Solo se omite la hora 5:00 AM (5:00 AM - 5:59 AM) por cierre y transición de jornada.
 * - Ejecuta cálculo multi-tienda con storeId='all' para garantizar que las 15 tiendas queden cacheadas juntas.
 * - Usa invocación directa in-process para máxima velocidad y evitar barreras de red en Vercel.
 * @dataFlow
 * - Vercel Cron -> GET /api/cron/sync-food-cost-today -> in-process foodCostGet() -> Toast PMIX + Recetas -> food_cost_daily_cache (Supabase) -> Response.
 * @notes
 * - [2026-09-10] FIX: Migrado a invocación in-process directa con fallback HTTP para evitar fallos de DNS o Vercel Deployment Protection.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { GET as foodCostGet } from '@/app/api/inventory/food-cost/route'

export const dynamic = 'force-dynamic'

export const maxDuration = 300 // 5 minutos máximo en Vercel (Pro)

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
        
        const currentHour = laNow.getHours()

        // Restricción de horario: Correr entre las 6 AM y las 4:59 AM del día siguiente.
        // Omitimos únicamente las 5 AM (cierre/transición de jornada).
        if (currentHour === 5) {
            console.log(`⏳ [CRON FC TODAY] Ejecución omitida. Fuera de horario operativo (5:00am-5:59am). Hora actual LA: ${currentHour}:00`)
            return NextResponse.json({ success: true, message: 'Skipped: Outside operating hours (5 AM rollover)' })
        }

        // Regla de las 6 AM: si es antes de las 6 AM, sigue siendo el "hoy" operativo del día anterior
        if (currentHour < 6) {
            laNow.setDate(laNow.getDate() - 1)
        }

        const y = laNow.getFullYear()
        const m = String(laNow.getMonth() + 1).padStart(2, '0')
        const day = String(laNow.getDate()).padStart(2, '0')
        const todayStr = `${y}-${m}-${day}`

        console.log(`⏰ [CRON FC TODAY] Sincronizando Food Cost "Hoy": ${todayStr}`)

        // 2. Ejecutar cálculo de food cost para todas las tiendas
        // Usamos ejecución in-process directa con fallback HTTP para máxima confiabilidad
        let itemCount = 0
        try {
            console.log(`🔄 [CRON FC TODAY] Calculando in-process para ${todayStr}...`)
            const directReq = new NextRequest(`http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${todayStr}&endDate=${todayStr}`)
            const directRes = await foodCostGet(directReq)
            
            if (directRes.ok) {
                const directJson = await directRes.json()
                itemCount = directJson.data?.length || 0
                console.log(`✅ [CRON FC TODAY] In-process exitoso: ${itemCount} items procesados y cacheados.`)
            } else {
                throw new Error(`In-process returned status ${directRes.status}`)
            }
        } catch (inProcessErr: any) {
            console.warn(`⚠️ [CRON FC TODAY] In-process falló (${inProcessErr.message}), intentando fallback HTTP...`)
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL 
                ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
                : (process.env.VERCEL_PROJECT_PRODUCTION_URL 
                    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` 
                    : (process.env.VERCEL_URL 
                        ? `https://${process.env.VERCEL_URL}` 
                        : 'http://localhost:3000'))
            
            const apiUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${todayStr}&endDate=${todayStr}`
            const res = await fetch(apiUrl, {
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const errorText = await res.text()
                throw new Error(`HTTP API responded ${res.status}: ${errorText}`)
            }

            const json = await res.json()
            itemCount = json.data?.length || 0
            console.log(`✅ [CRON FC TODAY] Fallback HTTP exitoso: ${itemCount} items procesados y cacheados.`)
        }

        return NextResponse.json({
            success: true,
            date: todayStr,
            items: itemCount,
            processed_at: new Date().toISOString()
        })

    } catch (e: any) {
        console.error(`💥 [CRON FC TODAY] Fatal error:`, e.message)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

