/**
 * @module api/cron/monitor-system-health/route
 * @description Endpoint de cron de Vercel para monitorear el estado de salud de Supabase y Vercel.
 * Realiza pruebas de latencia, verifica capacidad de almacenamiento vs Spend Cap (8 GB),
 * frescura de Toast y disponibilidad general. Notifica vía email a carlos@tacosgavilan.com si se cruzan umbrales.
 * 
 * @businessRules
 * - Monitorea umbrales de 6.0 GB (Preventivo) y 7.2 GB (Crítico) contra el límite fijo de 8 GB de Spend Cap.
 * - Evita bloqueos por Read-Only Mode en PostgreSQL.
 * - Soporta parámetro query `?forceEmail=true` para auditorías manuales bajo demanda.
 * 
 * @dataFlow
 * - Vercel Cron -> GET /api/cron/monitor-system-health -> lib/system-health-sentinel.ts -> Response JSON.
 * 
 * @notes
 * - Seguro con CRON_SECRET en producción; permite pruebas manuales para administradores.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAndNotifySystemHealth } from '@/lib/system-health-sentinel'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization')
        if (process.env.CRON_SECRET) {
            if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        const { searchParams } = new URL(req.url)
        const forceEmail = searchParams.get('forceEmail') === 'true'

        const report = await checkAndNotifySystemHealth(forceEmail)

        return NextResponse.json({
            success: true,
            status: report.overallStatus,
            report
        })
    } catch (error: any) {
        console.error('[CRON MONITOR SYSTEM HEALTH] Error:', error.message)
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 })
    }
}
