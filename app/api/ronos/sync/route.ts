/**
 * @module api/ronos/sync
 * @description Endpoint de sincronización forzada bajo demanda para actualizar datos de RONOS.
 *
 * @businessRules
 *   - Permite forzar la re-sincronización y auditoría inmediata de una sucursal o de toda la cadena.
 *   - Refresca el token de autenticación y re-calcula las métricas de penalizaciones laborales.
 *
 * @dataFlow
 *   Frontend (Botón "Sincronizar RONOS Ahora") -> POST /api/ronos/sync -> ronos-api -> Actualización en tiempo real.
 */

import { NextResponse } from 'next/server'
import { getRonosStoreAudit, getRonosChainWideAudit } from '@/lib/ronos-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 60 segundos máx

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    const body = await request.json().catch(() => ({}))
    const { companyId = 34, weekId, syncChain = false } = body

    if (syncChain) {
      const chainAudit = await getRonosChainWideAudit()
      const durationMs = Date.now() - startTime
      return NextResponse.json({
        success: true,
        type: 'chain',
        durationMs,
        data: chainAudit
      })
    }

    const storeAudit = await getRonosStoreAudit(companyId, weekId)
    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      type: 'store',
      durationMs,
      data: storeAudit
    })
  } catch (error: any) {
    console.error('Error en /api/ronos/sync:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al sincronizar datos de RONOS'
      },
      { status: 500 }
    )
  }
}
