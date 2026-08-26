/**
 * @module api/cron/sync-ronos-labor
 * @description Cron job automatizado para sincronización y auditoría periódica de ponchadas y penalizaciones de RONOS.
 *
 * @businessRules
 *   - Ejecución programada para auditar las 15 tiendas de Tacos Gavilan y la Bodega central.
 *   - Detecta tempranamente violaciones de la 5ta hora de comida (Meal Penalties) y horas extras acumuladas antes del cierre de nómina.
 *
 * @dataFlow
 *   Vercel Cron -> GET /api/cron/sync-ronos-labor -> ronos-api -> Auditoría global de nómina.
 */

import { NextResponse } from 'next/server'
import { getRonosChainWideAudit } from '@/lib/ronos-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const startTime = Date.now()

  try {
    const chainAudit = await getRonosChainWideAudit()
    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      durationMs,
      summary: {
        totalStores: chainAudit.totalStores,
        totalActiveEmployees: chainAudit.totalActiveEmployees,
        totalChainHours: chainAudit.totalChainHours,
        totalOvertimeHours: chainAudit.totalOvertimeHours,
        totalMealPenalties: chainAudit.totalMealPenalties,
        totalBrokenTimecards: chainAudit.totalBrokenTimecards,
        totalPenaltyCostUsd: chainAudit.totalPenaltyCostUsd,
        totalOvertimeCostUsd: chainAudit.totalOvertimeCostUsd
      }
    })
  } catch (error: any) {
    console.error('Error en /api/cron/sync-ronos-labor:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error en ejecución de cron de RONOS'
      },
      { status: 500 }
    )
  }
}
