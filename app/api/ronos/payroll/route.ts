/**
 * @module api/ronos/payroll
 * @description Endpoint de cálculo y conciliación de Nómina y Facturación Cingular HR.
 *   - Calcula salarios brutos (Gross Wages) y facturación de Cingular HR (26.00% markup).
 *   - Aplica diferenciación para Asalariados (General Manager / Supervisor) vs Por Hora (Asistente hacia abajo).
 *   - Soporta exportación en formato CSV idéntico al Summary Report oficial de Cingular.
 *
 * @businessRules
 *   - Asalariados (Exempt): 80 hrs fijas bisemanales, sin OT/DT ni Meal Penalties (markup ~24.51%).
 *   - Por Hora (Non-Exempt): Calculado sobre ponchadas reales de RONOS + 26.00% markup oficial.
 *
 * @notes
 *   - Soporta `companyId=0` o `companyId=all` para consolidar toda la cadena corporativa (15 Tiendas + Bodega).
 *   - Agrupa semanas por fechas reales para cruce exacto entre tiendas que manejan IDs de semana distintos.
 */

import { NextResponse } from 'next/server'
import { calculateCingularPayrollReport, generateCingularSummaryCSV, CingularInvoiceSummaryReport } from '@/lib/payroll-calculator'
import { getRonosWeeks, RONOS_STORES_MAP } from '@/lib/ronos-api'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const companyIdParam = searchParams.get('companyId')
    const weekIdsParam = searchParams.get('weekIds')
    const format = searchParams.get('format') || 'json' // 'json' | 'csv'
    const isBiWeekly = searchParams.get('biWeekly') !== 'false'

    const isChain = companyIdParam === '0' || companyIdParam === 'all' || companyIdParam === 'chain'
    const ronosCompanyId = isChain ? 0 : (companyIdParam ? parseInt(companyIdParam, 10) : 34)

    let weekIds: number[] = []
    if (weekIdsParam) {
      weekIds = weekIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(Boolean)
    }

    let report: CingularInvoiceSummaryReport

    if (isChain) {
      // 1. Obtener rango de fechas de referencia para toda la cadena
      let refStartDates: string[] = []
      let periodStartDate = ''
      let periodEndDate = ''

      if (weekIds.length > 0) {
        const { data: refWeeks } = await supabaseAdmin
          .from('ronos_work_weeks')
          .select('start_date, end_date')
          .in('week_id', weekIds)
          .order('start_date', { ascending: true })

        if (refWeeks && refWeeks.length > 0) {
          refStartDates = refWeeks.map(w => w.start_date)
          periodStartDate = refWeeks[0].start_date.substring(0, 10)
          periodEndDate = refWeeks[refWeeks.length - 1].end_date.substring(0, 10)
        }
      }

      // Si no hay semanas de referencia, tomar el ciclo cerrado más reciente de Lynwood (#34)
      if (refStartDates.length === 0) {
        const lynwoodWeeks = await getRonosWeeks(34)
        if (lynwoodWeeks.length > 0) {
          const sIdx = (new Date(lynwoodWeeks[0]?.endDate || '').getTime() > Date.now()) ? 1 : 0
          if (isBiWeekly && lynwoodWeeks.length >= sIdx + 2) {
            refStartDates = [lynwoodWeeks[sIdx + 1].startDate, lynwoodWeeks[sIdx].startDate]
            periodStartDate = lynwoodWeeks[sIdx + 1].startDate.substring(0, 10)
            periodEndDate = lynwoodWeeks[sIdx].endDate.substring(0, 10)
          } else {
            refStartDates = [lynwoodWeeks[sIdx].startDate]
            periodStartDate = lynwoodWeeks[sIdx].startDate.substring(0, 10)
            periodEndDate = lynwoodWeeks[sIdx].endDate.substring(0, 10)
          }
        }
      }

      // 2. Obtener todas las semanas de todas las tiendas que coinciden con las fechas de inicio
      const { data: allStoreWeeks } = await supabaseAdmin
        .from('ronos_work_weeks')
        .select('week_id, company_id, start_date')
        .in('start_date', refStartDates)

      const storeWeeksMap = new Map<number, number[]>()
      if (allStoreWeeks) {
        allStoreWeeks.forEach(w => {
          if (!storeWeeksMap.has(w.company_id)) storeWeeksMap.set(w.company_id, [])
          storeWeeksMap.get(w.company_id)!.push(w.week_id)
        })
      }

      // 3. Calcular nómina de cada sucursal en paralelo
      const reports = await Promise.all(
        RONOS_STORES_MAP.map(async (store) => {
          const sWeeks = storeWeeksMap.get(store.ronosCompanyId)
          if (!sWeeks || sWeeks.length === 0) return null
          try {
            return await calculateCingularPayrollReport(store.ronosCompanyId, sWeeks, isBiWeekly)
          } catch (err: any) {
            console.warn(`Error en nómina corporativa para ${store.tegName}:`, err?.message)
            return null
          }
        })
      )

      const validReports = reports.filter(Boolean) as CingularInvoiceSummaryReport[]

      report = {
        storeId: 0,
        storeCode: 'CHAIN',
        storeName: 'Todas las Tiendas (Cadena Completa)',
        ronosCompanyId: 0,
        periodStartDate,
        periodEndDate,
        isBiWeekly,
        totalEmployees: validReports.reduce((s, r) => s + (r.employees?.length || 0), 0),
        salariedCount: validReports.reduce((s, r) => s + (r.salariedCount || 0), 0),
        hourlyCount: validReports.reduce((s, r) => s + (r.hourlyCount || 0), 0),
        totalHours: Math.round(validReports.reduce((s, r) => s + r.totalHours, 0) * 100) / 100,
        totalRegularHours: Math.round(validReports.reduce((s, r) => s + (r.totalRegularHours || 0), 0) * 100) / 100,
        totalSalaryHours: Math.round(validReports.reduce((s, r) => s + (r.totalSalaryHours || 0), 0) * 100) / 100,
        totalOvertimeHours: Math.round(validReports.reduce((s, r) => s + (r.totalOvertimeHours || 0), 0) * 100) / 100,
        totalDoubleTimeHours: Math.round(validReports.reduce((s, r) => s + (r.totalDoubleTimeHours || 0), 0) * 100) / 100,
        totalMealPenaltyHours: Math.round(validReports.reduce((s, r) => s + (r.totalMealPenaltyHours || 0), 0) * 100) / 100,
        totalSickHours: Math.round(validReports.reduce((s, r) => s + (r.totalSickHours || 0), 0) * 100) / 100,
        totalVacationHours: Math.round(validReports.reduce((s, r) => s + (r.totalVacationHours || 0), 0) * 100) / 100,
        totalHolidayHours: Math.round(validReports.reduce((s, r) => s + (r.totalHolidayHours || 0), 0) * 100) / 100,
        totalGrossPay: Math.round(validReports.reduce((s, r) => s + r.totalGrossPay, 0) * 100) / 100,
        totalInvoicedAmount: Math.round(validReports.reduce((s, r) => s + r.totalInvoicedAmount, 0) * 100) / 100,
        totalCingularFee: Math.round(validReports.reduce((s, r) => s + r.totalCingularFee, 0) * 100) / 100,
        effectiveMarkupPercentage: 26.0,
        exactMatchesCount: validReports.reduce((s, r) => s + (r.exactMatchesCount || 0), 0),
        auditAlertsCount: validReports.reduce((s, r) => s + (r.auditAlertsCount || 0), 0),
        auditSavingsAmount: Math.round(validReports.reduce((s, r) => s + (r.auditSavingsAmount || 0), 0) * 100) / 100,
        reconciliationPercentage: 100,
        employees: validReports.flatMap(r => r.employees)
      }
    } else {
      // Si no se pasaron weekIds para tienda individual, tomar las 2 semanas cerradas más recientes
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

      report = await calculateCingularPayrollReport(ronosCompanyId, weekIds, isBiWeekly)
    }

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
