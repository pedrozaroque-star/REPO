/**
 * @module api/ronos/refresh-transfers
 * @description Endpoint para refrescar el caché de detección de traslados bajo demanda.
 *   Escanea todas las tiendas de RONOS para verificar ponchadas reales y actualiza el caché en memoria.
 *
 * @businessRules
 *   - El caché tiene un TTL de 4 horas. Este endpoint lo fuerza a refrescar inmediatamente.
 *   - Consulta semana actual + semana anterior para cubrir lunes/martes sin datos.
 *   - Solo analiza empleados con 0 horas en la tienda seleccionada.
 *
 * @dataFlow
 *   RONOS API (15 tiendas × 2 semanas) → refreshTransferCache() → caché en memoria
 */

import { NextResponse } from 'next/server'
import { refreshTransferCache } from '@/lib/ronos-mapping'
import { callRonosApi, getRonosWeeks } from '@/lib/ronos-api'

export async function POST(req: Request) {
  try {
    const { ronosCompanyId } = await req.json()

    if (!ronosCompanyId) {
      return NextResponse.json({ error: 'ronosCompanyId es requerido' }, { status: 400 })
    }

    // Obtener lista de empleados con 0 horas para esta tienda
    const weeks = await getRonosWeeks(ronosCompanyId)
    const currentWeekId = weeks[0]?.weekId
    if (!currentWeekId) {
      return NextResponse.json({ error: 'No se encontraron semanas para esta tienda' }, { status: 404 })
    }

    const weekData = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
      searchTerm: null,
      companyId: ronosCompanyId,
      weekId: currentWeekId,
      departmentId: 0,
      pageNumber: 0,
      pageSize: 100,
      sort: 'FirstName',
      showInactive: 0,
      payType: 0,
      internalSalariedRules: false
    })

    const ronosList = ((weekData.results || []) as any[]).filter((e: any) => e.active !== false)
    const zeroHoursUserIds = ronosList
      .filter((e: any) => (e.totalWeeklyHour || 0) === 0)
      .map((e: any) => Number(e.employeeUserId || e.userId))

    // Forzar refresco del caché
    const transfers = await refreshTransferCache(ronosCompanyId, zeroHoursUserIds)

    const transfersList = Array.from(transfers.entries()).map(([userId, data]) => ({
      userId,
      storeName: data.storeName,
      hours: data.hours
    }))

    return NextResponse.json({
      success: true,
      zeroHoursCount: zeroHoursUserIds.length,
      transfersFound: transfersList.length,
      transfers: transfersList,
      cachedAt: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('Error refreshing transfer cache:', error)
    return NextResponse.json(
      { error: error.message || 'Error interno al refrescar traslados' },
      { status: 500 }
    )
  }
}
