/**
 * @module api/cron/sync-ronos-absences
 * @description Endpoint de ejecución periódica (Vercel Cron) para sincronizar automáticamente los días de
 *   Enfermedad (Sick) y Vacaciones (Vacation) de managers, asistentes y supervisores desde RONOS hacia la tabla 'schedules'.
 *
 * @businessRules
 *   - Se ejecuta diariamente a las 6:30 AM PST (después del inicio de la jornada laboral de las 6:00 AM).
 *   - Inserta ausencias oficiales de RONOS en 'schedules' para alertar a los supervisores de faltas operativas en las 15 tiendas.
 *   - Los turnos de ausencia (Enfermedad / Vacaciones) nunca cubren los bloques operativos AM (00:00 - 17:00) ni PM (17:00 - 06:00).
 *
 * @dataFlow
 *   Vercel Cron (30 14 * * *) -> GET /api/cron/sync-ronos-absences -> syncRonosAbsencesToSchedules -> Supabase 'schedules' -> UI /horarios.
 *
 * @notes
 *   - Admite ejecución manual vía GET o POST con parámetros opcionales (?store_id=X&force=true).
 */

import { NextResponse } from 'next/server'
import { syncRonosAbsencesToSchedules } from '@/lib/sync-ronos-absences'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const storeIdParam = searchParams.get('store_id')
    const forceParam = searchParams.get('force') === 'true'

    const storeId = storeIdParam ? parseInt(storeIdParam) : undefined
    const weeksParam = searchParams.get('weeks')
    const weeksToScan = weeksParam ? parseInt(weeksParam) : 4

    const result = await syncRonosAbsencesToSchedules({
      storeId,
      weeksToScan,
      forceRefresh: forceParam
    })

    return NextResponse.json({
      success: result.success,
      timestamp: new Date().toISOString(),
      durationMs: result.durationMs,
      summary: {
        totalScannedStores: result.totalScannedStores,
        totalAbsencesFound: result.totalAbsencesFound,
        totalAbsencesUpserted: result.totalAbsencesUpserted,
        records: result.records
      },
      errors: result.errors
    })
  } catch (error: any) {
    console.error('Error en /api/cron/sync-ronos-absences:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error en ejecución de cron de ausencias de RONOS'
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return GET(request)
}
