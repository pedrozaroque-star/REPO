/**
 * @module api/ronos/payroll
 * @description Endpoint de cálculo y conciliación de Nómina y Facturación Cingular HR.
 *   - Calcula salarios brutos (Gross Wages) y facturación de Cingular HR (25.98% markup).
 *   - Aplica diferenciación para Asalariados (General Manager / Supervisor) vs Por Hora (Asistente hacia abajo).
 *   - Soporta exportación en formato CSV idéntico al Summary Report oficial de Cingular.
 *
 * @businessRules
 *   - Asalariados (Exempt): 80 hrs fijas bisemanales, sin OT/DT ni Meal Penalties.
 *   - Por Hora (Non-Exempt): Calculado sobre ponchadas reales de RONOS + 25.98% markup.
 *
 * @dataFlow
 *   Frontend -> GET /api/ronos/payroll?companyId=36&weekIds=155973,154247&format=json|csv -> `payroll-calculator` -> Response
 */

import { NextResponse } from 'next/server'
import { calculateCingularPayrollReport, generateCingularSummaryCSV } from '@/lib/payroll-calculator'
import { getRonosWeeks } from '@/lib/ronos-api'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const companyIdParam = searchParams.get('companyId')
    const weekIdsParam = searchParams.get('weekIds')
    const format = searchParams.get('format') || 'json' // 'json' | 'csv'
    const isBiWeekly = searchParams.get('biWeekly') !== 'false'

    const ronosCompanyId = companyIdParam ? parseInt(companyIdParam, 10) : 34

    let weekIds: number[] = []
    if (weekIdsParam) {
      weekIds = weekIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(Boolean)
    }

    // Si no se pasaron weekIds, tomar las 2 semanas cerradas más recientes para periodo bisemanal
    if (weekIds.length === 0) {
      const weeks = await getRonosWeeks(ronosCompanyId)
      if (weeks.length > 0) {
        const startIndex = (weeks.length > 0 && new Date(weeks[0]?.endDate || '').getTime() > Date.now()) ? 1 : 0
        if (isBiWeekly && weeks.length >= startIndex + 2) {
          weekIds = [weeks[startIndex + 1].weekId, weeks[startIndex].weekId]
        } else {
          weekIds = [weeks[startIndex].weekId]
        }
      }
    }

    const report = await calculateCingularPayrollReport(ronosCompanyId, weekIds, isBiWeekly)

    if (format === 'csv') {
      const csvData = generateCingularSummaryCSV(report)
      return new NextResponse(csvData, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="Cingular_Payroll_${report.storeCode}_${new Date().toISOString().slice(0, 10)}.csv"`
        }
      })
    }

    return NextResponse.json({
      success: true,
      data: report
    })
  } catch (error: any) {
    console.error('Error en /api/ronos/payroll:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error al calcular reporte de nómina Cingular' },
      { status: 500 }
    )
  }
}
