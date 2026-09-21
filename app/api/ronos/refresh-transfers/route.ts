/**
 * @module api/ronos/refresh-transfers
 * @description Endpoint para refrescar el caché de detección de traslados bajo demanda.
 *   Escanea todas las tiendas de RONOS para verificar ponchadas reales y actualiza el caché en memoria.
 *
 * @businessRules
 *   - El caché tiene un TTL de 4 horas. Este endpoint lo fuerza a refrescar inmediatamente.
 *   - Detección de traslados limitada exclusivamente a horas reales trabajadas (> 0) en la semana visible.
 *   - Solo analiza empleados con 0 horas en la tienda seleccionada.
 *   - Prohíbe terminantemente peticiones con format=csv.
 *
 * @dataFlow
 *   RONOS API (15 tiendas × 2 semanas) → refreshTransferCache() → caché en memoria
 *
 * @notes
 *   - Requiere rol 'admin' y valida formato numérico estricto para el parámetro companyId.
 */

import { NextResponse } from 'next/server'
import { refreshTransferCache } from '@/lib/ronos-mapping'
import { getRonosWeeks, getRonosWeekEmployees } from '@/lib/ronos-api'
import { verifyAdminAuth } from '@/lib/auth-server'

export async function POST(req: Request) {
  try {
    const auth = verifyAdminAuth(req)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    if (searchParams.get('format')?.toLowerCase() === 'csv') {
      return NextResponse.json({ error: 'El formato CSV no está permitido por razones de seguridad.' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))

    if (body.format && String(body.format).toLowerCase() === 'csv') {
      return NextResponse.json({ error: 'El formato CSV no está permitido por razones de seguridad.' }, { status: 400 })
    }

    const rawCompanyId = body.ronosCompanyId ?? body.companyId
    if (rawCompanyId === undefined || rawCompanyId === null || !/^\d+$/.test(String(rawCompanyId))) {
      return NextResponse.json({ error: 'Parámetro companyId / ronosCompanyId inválido: debe ser numérico' }, { status: 400 })
    }

    const ronosCompanyId = parseInt(String(rawCompanyId), 10)
    if (ronosCompanyId <= 0) {
      return NextResponse.json({ error: 'Parámetro companyId debe ser un ID mayor a 0' }, { status: 400 })
    }

    const targetWeekId = body.weekId && /^\d+$/.test(String(body.weekId)) ? parseInt(String(body.weekId), 10) : undefined

    // Obtener lista de empleados con 0 horas para esta tienda en la semana visible
    let currentWeekId = targetWeekId
    if (!currentWeekId) {
      const weeks = await getRonosWeeks(ronosCompanyId)
      currentWeekId = weeks[0]?.weekId
    }

    if (!currentWeekId) {
      return NextResponse.json({ error: 'No se encontraron semanas para esta tienda' }, { status: 404 })
    }

    // Consulta paginada exhaustiva (sin límite de 100)
    const rawEmployees = await getRonosWeekEmployees(ronosCompanyId, currentWeekId)

    const ronosList = (rawEmployees || []).filter((e: any) => e.active !== false)
    const zeroHoursUserIds = ronosList
      .filter((e: any) => (e.totalWeeklyHour || 0) === 0)
      .map((e: any) => Number(e.employeeUserId || e.userId))

    // Forzar refresco del caché limitado a horas reales en la semana visible
    const transfers = await refreshTransferCache(ronosCompanyId, zeroHoursUserIds, currentWeekId)

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
