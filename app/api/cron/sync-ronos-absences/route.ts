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
 *   - Requiere CRON_SECRET; valida store_id, weeks y force antes de ejecutar escrituras.
 */

import { NextResponse } from 'next/server'
import { syncRonosAbsencesToSchedules } from '@/lib/sync-ronos-absences'
import { getCronSecret } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    const cronSecret = getCronSecret()
    const authorization = request.headers.get('authorization') || request.headers.get('Authorization')
    if (!cronSecret) {
      console.error('[sync-ronos-absences] CRON_SECRET no está configurado')
      return NextResponse.json({ success: false, error: 'Servicio de cron no configurado' }, { status: 503 })
    }
    if (authorization !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const storeIdParam = searchParams.get('store_id')
    const forceValue = searchParams.get('force')
    if (forceValue !== null && forceValue !== 'true' && forceValue !== 'false') {
      return NextResponse.json({ success: false, error: 'force debe ser true o false' }, { status: 400 })
    }
    const forceParam = forceValue === 'true'

    const storeId = storeIdParam ? Number(storeIdParam) : undefined
    if (storeId !== undefined && (!Number.isSafeInteger(storeId) || storeId <= 0)) {
      return NextResponse.json({ success: false, error: 'store_id debe ser un entero positivo' }, { status: 400 })
    }
    const weeksParam = searchParams.get('weeks')
    const weeksToScan = weeksParam ? Number(weeksParam) : 4
    if (!Number.isSafeInteger(weeksToScan) || weeksToScan < 1 || weeksToScan > 8) {
      return NextResponse.json({ success: false, error: 'weeks debe ser un entero entre 1 y 8' }, { status: 400 })
    }

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
        // Los detalles individuales se registran internamente; el cron solo expone totales.
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
