import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

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

        // Restricción de horario: Correr entre las 7 AM y las 4:59 AM del día siguiente.
        // Omitimos únicamente las 5 AM y 6 AM (horas muertas donde se cierra el día).
        if (currentHour === 5 || currentHour === 6) {
            console.log(`⏳ [CRON FC TODAY] Ejecución omitida. Fuera de horario operativo (7am-4:59am). Hora actual LA: ${currentHour}:00`)
            return NextResponse.json({ success: true, message: 'Skipped: Outside operating hours' })
        }

        // Regla de las 6 AM
        if (currentHour < 6) {
            laNow.setDate(laNow.getDate() - 1)
        }

        const y = laNow.getFullYear()
        const m = String(laNow.getMonth() + 1).padStart(2, '0')
        const day = String(laNow.getDate()).padStart(2, '0')
        const todayStr = `${y}-${m}-${day}`

        console.log(`⏰ [CRON FC TODAY] Sincronizando Food Cost "Hoy": ${todayStr}`)

        // 2. Borrar cache previa para forzar recálculo
        const { error: deleteError } = await supabase
            .from('food_cost_daily_cache')
            .delete()
            .eq('business_date', todayStr)

        if (deleteError) {
            console.error(`⚠️ [CRON FC TODAY] Error borrando cache para ${todayStr}:`, deleteError.message)
        }

        // 3. Llamar a la API de food-cost que ya hace el cálculo y write-through
        const baseUrl = process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : 'http://localhost:3000'
        
        const apiUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${todayStr}&endDate=${todayStr}`
        
        console.log(`🔄 [CRON FC TODAY] Calculando ${todayStr}...`)
        
        const res = await fetch(apiUrl, {
            headers: { 'Content-Type': 'application/json' }
        })

        if (!res.ok) {
            const errorText = await res.text()
            throw new Error(`API responded ${res.status}: ${errorText}`)
        }

        const json = await res.json()
        const itemCount = json.data?.length || 0

        console.log(`✅ [CRON FC TODAY] ${todayStr}: ${itemCount} items procesados y cacheados.`)

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
