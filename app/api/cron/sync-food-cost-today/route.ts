/**
 * @module api/cron/sync-food-cost-today/route
 * @description Cron job periódica ejecutada cada 20 minutos (0, 20, 40 de cada hora) durante el horario operativo para pre-calcular y cachear el Food Cost del día en curso ("Hoy") para las 15 sucursales de Tacos Gavilan en Supabase `food_cost_daily_cache`.
 * @businessRules
 * - El día laboral empieza a las 6:00 AM y termina a las 5:59 AM del siguiente día (PST/PDT `America/Los_Angeles`).
 * - Ocurre rollover de fecha a las 6:00 AM (`getBusinessDateLA()`). Antes de las 6:00 AM pertenece al día laboral anterior.
 * - Se omite la ventana muerta sin ventas (`04:15 AM - 06:59 AM LA`), dejando la barrida de las `04:00 AM` para capturar las últimas órdenes nocturnas.
 * - Ejecuta cálculo multi-tienda con `storeId='all'` para garantizar que las 15 tiendas queden cacheadas juntas.
 * - Usa invocación directa in-process para máxima velocidad y evitar barreras de red en Vercel.
 * @dataFlow
 * - Vercel Cron -> GET /api/cron/sync-food-cost-today -> in-process foodCostGet() -> Toast PMIX + Recetas -> food_cost_daily_cache (Supabase) -> Response.
 * @notes
 * - [2026-09-10] FIX: Migrado a invocación in-process directa con fallback HTTP para evitar fallos de DNS o Vercel Deployment Protection.
 * - Blindaje Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor`.
 * - [2026-11-23] Estandarizado sobre `getLANowParts()` (inmune a bug ICU `hour === 24` y zona horaria del servidor).
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildInternalCronAuthHeaders, verifyStaffAuth } from '@/lib/auth-server'
import { getLANowParts } from '@/lib/inventory/food-cost-sales-resolver'
import { GET as foodCostGet } from '@/app/api/inventory/food-cost/route'

export const dynamic = 'force-dynamic'

export const maxDuration = 300 // 5 minutos máximo en Vercel (Pro)

export async function GET(request: Request) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        // 1. Obtener hora y fecha laboral actual en LA timezone (regla 06:00 AM)
        const la = getLANowParts()
        const currentHour = la.hour
        const currentMinute = la.minute

        // Restricción de horario: Omitimos la ventana muerta real sin ventas (4:15 AM - 6:59 AM LA),
        // dejando una última barrida de cierre nocturno a las 4:00 AM tras las últimas órdenes de las 3 AM.
        if ((currentHour === 4 && currentMinute >= 15) || currentHour === 5 || currentHour === 6) {
            console.log(`⏳ [CRON FC TODAY] Ejecución omitida en ventana sin ventas (4:15am-6:59am). Hora actual LA: ${currentHour}:${String(currentMinute).padStart(2, '0')}`)
            return NextResponse.json({ success: true, message: 'Skipped: Dead hours (4:15 AM - 6:59 AM LA)' })
        }

        const todayStr = la.businessDate

        console.log(`⏰ [CRON FC TODAY] Sincronizando Food Cost "Hoy": ${todayStr}`)

        // 2. Ejecutar cálculo de food cost para todas las tiendas
        // Usamos ejecución in-process directa con fallback HTTP para máxima confiabilidad
        let itemCount = 0
        try {
            console.log(`🔄 [CRON FC TODAY] Calculando in-process para ${todayStr}...`)
            const directReq = new NextRequest(`http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${todayStr}&endDate=${todayStr}`, {
                headers: buildInternalCronAuthHeaders(request)
            })
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
                headers: {
                    'Content-Type': 'application/json',
                    ...buildInternalCronAuthHeaders(request)
                }
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

