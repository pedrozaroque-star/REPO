/**
 * @module SyncRonosAPI
 * @description Endpoint de API para sincronizar bajo demanda las ausencias oficiales (Enfermedad y Vacaciones)
 * desde RONOS hacia la matriz operativa de Horarios de Supervisores (`schedules`).
 *
 * @businessRules
 * 1. Extrae solicitudes aprobadas de PTO (Vacaciones) y días por enfermedad (Sick) de RONOS.
 * 2. Cruza con los empleados de liderazgo (Managers, Asistentes y Supervisores).
 * 3. Actualiza 'schedules' con turnos '00:00' - '00:00' y shift_label 'Enfermedad' | 'Vacaciones'.
 * 4. Las ausencias no cubren bloques operativos, alertando los semáforos de cobertura.
 *
 * @dataFlow
 * - Invocado por: Botón "Sincronizar RONOS" en `/horarios`.
 * - Ejecuta: `syncRonosAbsencesToSchedules` en `lib/sync-ronos-absences.ts`.
 */

import { NextResponse } from 'next/server'
import { syncRonosAbsencesToSchedules } from '@/lib/sync-ronos-absences'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Body vacío permitido
    }

    const { store_id, weeks_to_scan, start_date, end_date, force_refresh } = body

    const storeIdNum = store_id && store_id !== 'all' ? Number(store_id) : undefined

    const result = await syncRonosAbsencesToSchedules({
      storeId: storeIdNum,
      startDate: start_date ? String(start_date) : undefined,
      endDate: end_date ? String(end_date) : undefined,
      weeksToScan: weeks_to_scan ? Number(weeks_to_scan) : 4,
      forceRefresh: Boolean(force_refresh)
    })

    return NextResponse.json({
      success: result.success,
      message: `Sincronización completada. ${result.totalAbsencesUpserted} ausencias actualizadas de RONOS.`,
      totalSynced: result.totalAbsencesUpserted,
      totalFound: result.totalAbsencesFound,
      totalScannedStores: result.totalScannedStores,
      records: result.records,
      durationMs: result.durationMs,
      errors: result.errors
    })
  } catch (e: any) {
    console.error('❌ [API /api/schedule/sync-ronos] Error:', e)
    return NextResponse.json(
      { success: false, error: e.message || 'Error interno al sincronizar ausencias de RONOS' },
      { status: 500 }
    )
  }
}
