
import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        // Verificar firma de autorización (Opcional, recomendado para Vercel Cron)
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // Si no hay secreto configurado, permitir (modo dev/local), si safe.
            // Pero mejor retornamos 401 si se configura.
            if (process.env.CRON_SECRET) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        // Calcular AYER (Fecha de cierre)
        // Usamos tiempo local o UTC? Toast suele trabajar en local store time.
        // Asumiremos que el servidor corre en una zona compatible o usamos fecha simple.
        const now = new Date()
        const yesterday = new Date(now)
        yesterday.setDate(now.getDate() - 1)
        const dateStr = yesterday.toISOString().split('T')[0]

        console.log(`⏰ [CRON] Iniciando sincronización de ventas para: ${dateStr}`)

        // Ejecutar sincronización
        const { rows, connectionError } = await fetchToastData({
            storeIds: 'all',
            startDate: dateStr,
            endDate: dateStr,
            groupBy: 'day'
        })

        if (connectionError) {
            console.error(`❌ [CRON] Error conectando a Toast: ${connectionError}`)
            return NextResponse.json({ error: connectionError }, { status: 502 })
        }

        console.log(`✅ [CRON] Sincronización exitosa: ${rows.length} registros guardados/actualizados.`)

        return NextResponse.json({
            success: true,
            date: dateStr,
            records_processed: rows.length,
            message: `Ventas del ${dateStr} sincronizadas correctamente.`
        })

    } catch (error: any) {
        console.error(`💥 [CRON] Error crítico:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
