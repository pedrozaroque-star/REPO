/**
 * @module lib/payroll-calculator
 * @description Motor de Cálculo de Nómina, Pre-Facturación y Conciliación de Cingular HR (PEO).
 *   - Modela la estructura matemática oficial de las facturas de Cingular HR (ej. `invoice-TEGW-0009.pdf`).
 *   - Diferenciación legal y operativa entre personal Asalariado (Exempt) y personal Por Hora (Non-Exempt).
 *   - Proyecta y desglosa salarios brutos (Gross Wages), margen de Cingular (25.98% Markup Fee) y total a pagar.
 *
 * @businessRules
 *   - **Personal Asalariado (Exempt)**:
 *     * Puestos: General Manager (Gerente General), Supervisor de Zona (Area Supervisor).
 *     * Pago: Salario fijo bisemanal (estándar 80 horas equivalentes).
 *     * Exentos de Overtime (OT = 0), Double Time (DT = 0) y Penalizaciones de Comida (Meal Penalties = 0).
 *     * Facturación: Tarifa fija de facturación según contrato.
 *   - **Personal Por Hora (Non-Exempt - Asistente de Manager hacia abajo)**:
 *     * Puestos: Asistente de Manager, Líder de Turno, Cocinero, Preparador/Taquero, Cajera, Intendencia.
 *     * Pago: Basado 100% en ponchadas reales registradas en RONOS.
 *     * Markup Cingular HR: 25.98% sobre salario base (BILL_RATE = PAY_RATE * 1.2598).
 *     * Horas Regulares (RG): RG_HRS * BILL_RATE.
 *     * Horas Extras (OT 1.5x): OT_HRS * (BILL_RATE * 1.5).
 *     * Tiempo Doble (DT 2.0x): DT_HRS * (BILL_RATE * 2.0).
 *     * Penalizaciones de Comida / Otros: OTHER_HRS * BILL_RATE.
 *
 * @dataFlow
 *   RONOS `ronos_employee_timecards_cache` + Toast `toast_employees.wage_data` -> `payroll-calculator` -> Reporte Conciliado Cingular HR.
 */

import { supabaseAdmin } from './supabase'
import { RONOS_STORES_MAP, getRonosStoreAudit } from './ronos-api'

export const CINGULAR_HOURLY_MARKUP_FACTOR = 1.25976 // ~25.98% markup factor
export const DEFAULT_BASE_HOURLY_RATE = 16.90 // California QSR baseline

export interface CingularEmployeePayrollItem {
  employeeId: string
  employeeUserId: number
  firstName: string
  lastName: string
  fullName: string
  jobTitle: string
  isSalaried: boolean
  siteName: string
  payRate: number
  billRate: number
  regularHours: number
  salaryHours: number
  overtimeHours: number
  doubleTimeHours: number
  mealPenaltyHours: number
  sickHours: number
  vacationHours: number
  totalHours: number
  grossRegularPay: number
  grossOvertimePay: number
  grossDoubleTimePay: number
  grossOtherPay: number
  totalGrossPay: number
  invoicedRegularCost: number
  invoicedOvertimeCost: number
  invoicedDoubleTimeCost: number
  invoicedOtherCost: number
  totalInvoicedAmount: number
  cingularFeeAmount: number
  markupPercentage: number
}

export interface CingularInvoiceSummaryReport {
  invoiceId?: string
  storeId: number
  storeCode: string
  storeName: string
  ronosCompanyId: number
  periodStartDate: string
  periodEndDate: string
  isBiWeekly: boolean
  totalEmployees: number
  salariedCount: number
  hourlyCount: number
  totalHours: number
  totalRegularHours: number
  totalSalaryHours: number
  totalOvertimeHours: number
  totalDoubleTimeHours: number
  totalMealPenaltyHours: number
  totalSickHours: number
  totalVacationHours: number
  totalGrossPay: number
  totalInvoicedAmount: number
  totalCingularFee: number
  effectiveMarkupPercentage: number
  employees: CingularEmployeePayrollItem[]
}

// Registro oficial de tarifas de facturación de Cingular HR (Master Rates)
export const CINGULAR_RATE_OVERRIDES: Record<string, { payRate: number; billRate: number; otBillRate?: number }> = {
  'ana diaz': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'axel zamora': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'carolina sarabia': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'damaris vargas': { payRate: 19.40, billRate: 24.44, otBillRate: 36.67 },
  'esmeralda nicolas': { payRate: 17.90, billRate: 22.55, otBillRate: 33.83 },
  'freddie gurrusquieta': { payRate: 19.90, billRate: 25.07, otBillRate: 37.61 },
  'fredy leonardo tzalam pop': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'gilberto zepeda aguilar': { payRate: 18.90, billRate: 23.81, otBillRate: 35.71884 },
  'gilberto aguilar': { payRate: 18.90, billRate: 23.81, otBillRate: 35.71884 },
  'jesse julian alatorre quezada': { payRate: 21.87, billRate: 27.56, otBillRate: 41.33 },
  'jesse quezada': { payRate: 21.87, billRate: 27.56, otBillRate: 41.33 },
  'jesus alberto felipe miguel': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'jorge loaiza': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'jovana garcia': { payRate: 39.90, billRate: 49.68, otBillRate: 49.68 },
  'julian orozco bravo': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'julian bravo': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'marcos zamora ortiz': { payRate: 17.81, billRate: 22.44, otBillRate: 33.6491 },
  'maria rivera': { payRate: 22.40, billRate: 28.22, otBillRate: 42.34 },
  'maria d jimenez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'misael aguilar estrada': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'misael aguilar': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'rafael lopez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.49975 },
  'robinson adriano orozco': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'robinson orozco': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'rolando miguel zetina': { payRate: 17.90, billRate: 22.55, otBillRate: 33.82926 },
  'rolando miguel': { payRate: 17.90, billRate: 22.55, otBillRate: 33.82926 },
  'santos hernandez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'senia yasmini del cid martinez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'senia martinez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'sueam martinez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.890625 },

  // Sucursal Bell (TEG - Bell #13)
  'adriana reyes': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'antonio valle': { payRate: 17.90, billRate: 22.55, otBillRate: 33.83 },
  'diana carolina guevara': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'diana guevara': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'emelyn lazaro': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'javier ruiz': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'jose mendoza': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'jose rubio': { payRate: 22.90, billRate: 28.85, otBillRate: 43.28 },
  'jose garcia': { payRate: 17.65, billRate: 22.24, otBillRate: 33.36 },
  'jose manuel garcia': { payRate: 17.65, billRate: 22.24, otBillRate: 33.36 },
  'juan manuel hernandez': { payRate: 19.90, billRate: 25.07, otBillRate: 37.61 },
  'karla heredia': { payRate: 19.65, billRate: 24.76, otBillRate: 37.14 },
  'kevin campos': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'mario sanchez': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'paola castaneda': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'salvador hernandez': { payRate: 20.40, billRate: 25.70, otBillRate: 38.56 },
  'salvador velazquez': { payRate: 20.40, billRate: 25.70, otBillRate: 38.56 },

  // General Manager (Salaried) - Lynwood #14
  'carlos velazquez': { payRate: 37.93, billRate: 47.22 }, // $78,884/yr ($37.93/hr paystub legal rounded rate -> $3,034.40 with PTO)

  // Sucursal Broadway (TEG - Broadway #5 / Company ID: 30 / TEGB-0017)
  'aaron chay hernandez': { payRate: 33.80, billRate: 42.08 },
  'aaron hernandez': { payRate: 33.80, billRate: 42.08 },
  'hermenegildo albinez': { payRate: 23.38, billRate: 29.46, otBillRate: 44.19 },
  'rogelio ramirez': { payRate: 23.05, billRate: 29.04, otBillRate: 43.56 },
  'fatima monge': { payRate: 21.36, billRate: 26.91, otBillRate: 40.37 },
  'maynor gregorio ajin tecum': { payRate: 20.88, billRate: 26.31, otBillRate: 39.46 },
  'maynor ajin tecum': { payRate: 20.88, billRate: 26.31, otBillRate: 39.46 },
  'santos chay chiguil': { payRate: 20.42, billRate: 25.73, otBillRate: 38.59 },
  'santos chiguil': { payRate: 20.42, billRate: 25.73, otBillRate: 38.59 },
  'delia josefina arreaga ajiataz': { payRate: 20.42, billRate: 25.73, otBillRate: 38.59 },
  'delia arreaga': { payRate: 20.42, billRate: 25.73, otBillRate: 38.59 },
  'luis angel alvarez lopez': { payRate: 20.36, billRate: 25.65, otBillRate: 38.48 },
  'luis angel alvarez': { payRate: 20.36, billRate: 25.65, otBillRate: 38.48 },
  'nicasio franco': { payRate: 19.92, billRate: 25.10, otBillRate: 37.65 },
  'arturo varela': { payRate: 19.63, billRate: 24.73, otBillRate: 37.10 },
  'alfredo perez': { payRate: 19.61, billRate: 24.71, otBillRate: 37.07 },
  'maria ramirez': { payRate: 19.38, billRate: 24.42, otBillRate: 36.63 },
  'maria magdalena ramirez': { payRate: 19.38, billRate: 24.42, otBillRate: 36.63 },
  'romeo andres': { payRate: 19.36, billRate: 24.39, otBillRate: 36.59 },
  'benito ramirez': { payRate: 18.86, billRate: 23.76, otBillRate: 35.65 },
  'alex vasquez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'alexander mendez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'brayan bladimir abrego perez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'brayan perez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'diego joj escun': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'diego escun': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'edith majano sanchez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'edith sanchez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'eledoro tecum': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'juan perez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'keivis torres': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'kevin cortes': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'luisa fernanda wohlers solorzano': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'luisa wohlers': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'maria colin': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'yesenia catarina vasquez huinac': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },
  'yesenia vasquez': { payRate: 18.42, billRate: 23.21, otBillRate: 34.82 },

  // Sucursal Slauson (TEG - Slauson #7 / Company ID: 328)
  'jesus ramos': { payRate: 35.65, billRate: 44.38 }, // General Manager (Salaried)
  'alfonso alarcon': { payRate: 23.43, billRate: 29.52, otBillRate: 44.28 },
  'alberto romero': { payRate: 23.40, billRate: 29.48, otBillRate: 44.23 },
  'arturo juarez': { payRate: 21.49, billRate: 27.08, otBillRate: 40.62 },
  'hector flores': { payRate: 21.43, billRate: 27.00, otBillRate: 40.50 },
  'oscar tiguila': { payRate: 20.93, billRate: 26.37, otBillRate: 39.55 },
  'oscar tiguilla': { payRate: 20.93, billRate: 26.37, otBillRate: 39.55 },
  'daisy ramirez bautista': { payRate: 20.47, billRate: 25.79, otBillRate: 38.68 },
  'daisy bautista': { payRate: 20.47, billRate: 25.79, otBillRate: 38.68 },
  'veronica osorio': { payRate: 19.93, billRate: 25.11, otBillRate: 37.66 },
  'abigail mendoza antonio': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'abigail mendoza': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'alberto rodriguez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'alexander chay chiguil': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'alexander chiguil': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'brandon lopez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'carlos roca': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'felix reimundez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'felix remundez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'jennifer lizbeth baltazar rojas': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'jennifer baltazar': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'juan antonio hernandez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'juan hernandez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'justin rodriguez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'lorenzo lorenzo marcos': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'lorenzo lorenzo': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'maria moreno': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'rosalinda gutierrez hernandez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'rosalinda gutierrez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'sandra yoselyn gonon itzep': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'sandra gonon itzep': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'teresa gabarrete nunez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'teresa nunez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'william salgado': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 }
}

/**
 * Determina si un colaborador es asalariado (Exempt) o por hora (Non-Exempt)
 */
export function isEmployeeSalaried(jobTitle?: string, fullName?: string): boolean {
  if (!jobTitle && !fullName) return false
  const title = (jobTitle || '').toLowerCase()
  const name = (fullName || '').toLowerCase()

  // General Manager o Supervisor -> Asalariados
  if (
    title.includes('general manager') ||
    title.includes('gerente general') ||
    title.includes('supervisor') ||
    title.includes('district manager') ||
    (title === 'manager' && !title.includes('assistant') && !title.includes('asistente') && !title.includes('shift'))
  ) {
    return true
  }

  // Casos conocidos corporativos
  if (
    name.includes('jovana garcia') ||
    name.includes('carlos velazquez') ||
    name.includes('jesus ramos') ||
    name.includes('aaron hernandez')
  ) {
    return true
  }

  return false
}

/**
 * Calcula la nómina y proyección exacta de facturación Cingular HR para una sucursal y semana(s)
 */
export async function calculateCingularPayrollReport(
  ronosCompanyId: number,
  weekIds: number[],
  isBiWeekly = true
): Promise<CingularInvoiceSummaryReport> {
  const storeMeta = RONOS_STORES_MAP.find(s => s.ronosCompanyId === ronosCompanyId) || {
    tegStoreId: 0,
    tegCode: 'UNKNOWN',
    tegName: 'Desconocida',
    ronosCompanyId,
    ronosName: `Store #${ronosCompanyId}`
  }

  // 1. Obtener tarjetas de tiempo de Supabase
  let { data: timecards, error: tErr } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('*')
    .eq('company_id', ronosCompanyId)
    .in('week_id', weekIds)

  if (tErr) {
    console.error('Error fetching timecards for Cingular payroll calculation:', tErr.message)
  }

  // Si faltan semanas en la caché de Supabase, sincronizarlas automáticamente en tiempo real
  const cachedWeekIds = new Set((timecards || []).map(tc => tc.week_id))
  const missingWeeks = weekIds.filter(wId => !cachedWeekIds.has(wId))

  if (missingWeeks.length > 0) {
    for (const mW of missingWeeks) {
      try {
        await getRonosStoreAudit(ronosCompanyId, mW)
      } catch (err: any) {
        console.warn(`Error auto-syncing missing week ${mW} for store ${ronosCompanyId}:`, err?.message)
      }
    }

    // Re-consultar la base de datos de Supabase actualizada
    const { data: refreshedTimecards } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('*')
      .eq('company_id', ronosCompanyId)
      .in('week_id', weekIds)

    if (refreshedTimecards && refreshedTimecards.length > 0) {
      timecards = refreshedTimecards
    }
  }

  // 2. Obtener salarios reales de toast_employees
  const { data: toastEmps } = await supabaseAdmin
    .from('toast_employees')
    .select('first_name, last_name, wage_data, job_references, external_id, id')
    .limit(5000)

  const wageMap = new Map<string, number>()
  const titleMap = new Map<string, string>()

  if (toastEmps && Array.isArray(toastEmps)) {
    toastEmps.forEach(te => {
      const fName = (te.first_name || '').trim().toLowerCase()
      const lName = (te.last_name || '').trim().toLowerCase()
      const normalizedName = `${fName} ${lName}`.trim()
      if (Array.isArray(te.wage_data) && te.wage_data.length > 0) {
        const w = Number(te.wage_data[0]?.wage)
        if (w > 0) {
          wageMap.set(normalizedName, w)
          if (fName && lName) wageMap.set(`${fName}|${lName}`, w)
        }
      }
      if (Array.isArray(te.job_references) && te.job_references.length > 0) {
        const title = te.job_references[0]?.title || te.job_references[0]?.name || ''
        if (title) {
          titleMap.set(normalizedName, title)
          if (fName && lName) titleMap.set(`${fName}|${lName}`, title)
        }
      }
    })
  }

  // 3. Agrupar horas por colaborador para el periodo (semana simple o bisemanal)
  const empAggregation = new Map<number, {
    rawCards: any[]
    fullName: string
    firstName: string
    lastName: string
    pin: string
    jobTitle: string
    totalHours: number
    regularHours: number
    overtimeHours: number
    doubleTimeHours: number
    mealPenalties: number
    sickHours: number
    vacationHours: number
    holidayHours: number
  }>()

  ;(timecards || []).forEach(card => {
    const uId = card.employee_user_id
    if (!uId) return
    const cardName = (card.full_name || `${card.first_name || ''} ${card.last_name || ''}`).toLowerCase()
    // Omitir colaborador fantasma/placeholder del sistema RONOS
    if (cardName.includes('manager default')) return

    let agg = empAggregation.get(uId)
    if (!agg) {
      agg = {
        rawCards: [],
        fullName: card.full_name || `${card.first_name || ''} ${card.last_name || ''}`.trim(),
        firstName: card.first_name || '',
        lastName: card.last_name || '',
        pin: card.pin || '',
        jobTitle: card.job_title || '',
        totalHours: 0,
        regularHours: 0,
        overtimeHours: 0,
        doubleTimeHours: 0,
        mealPenalties: 0,
        sickHours: 0,
        vacationHours: 0,
        holidayHours: 0
      }
      empAggregation.set(uId, agg)
    }

    agg.rawCards.push(card)
    agg.totalHours += Number(card.total_weekly_hours || 0)
    agg.regularHours += Number(card.regular_hours || 0)
    agg.overtimeHours += Number(card.overtime_hours || 0)
    agg.doubleTimeHours += Number(card.double_time_hours || 0)
    agg.mealPenalties += Number(card.meal_penalty_count || 0)
    agg.sickHours += Number(card.sick_hours || 0)
    agg.vacationHours += Number(card.vacation_hours || 0)
    agg.holidayHours += Number(card.holiday_hours || 0)
  })

  // 4. Calcular importes exactos empleado por empleado
  const employeeItems: CingularEmployeePayrollItem[] = []

  empAggregation.forEach((agg, uId) => {
    const normName = agg.fullName.toLowerCase()
    const detectedTitle = titleMap.get(normName) || agg.jobTitle || 'Crew'
    const salaried = isEmployeeSalaried(detectedTitle, agg.fullName)

    // Determinar Pay Rate & Bill Rate (Prioridad: Registros Verificados Cingular -> Toast Wage Data -> Default)
    let payRate = 0
    let billRate = 0
    let otBillRate = 0

    // Buscar en tarifas conocidas de Cingular
    for (const [key, val] of Object.entries(CINGULAR_RATE_OVERRIDES)) {
      if (normName.includes(key) || key.includes(normName)) {
        payRate = val.payRate
        billRate = val.billRate
        otBillRate = val.otBillRate || 0
        break
      }
    }

    if (payRate <= 0) {
      payRate = wageMap.get(normName) || 0
    }

    if (payRate <= 0) {
      // Salarios estándar según rol si no está en Toast ni en Cingular
      if (salaried) payRate = 39.90 // $3,192 bi-weekly
      else if (detectedTitle.toLowerCase().includes('asistente') || detectedTitle.toLowerCase().includes('assistant')) payRate = 22.40
      else if (detectedTitle.toLowerCase().includes('lead') || detectedTitle.toLowerCase().includes('lider')) payRate = 19.40
      else if (detectedTitle.toLowerCase().includes('cook') || detectedTitle.toLowerCase().includes('cocinero')) payRate = 18.90
      else payRate = DEFAULT_BASE_HOURLY_RATE
    }

    if (billRate <= 0) {
      if (salaried) {
        billRate = Number((payRate * 1.2451).toFixed(2)) // 24.51% para Salaried
      } else {
        billRate = Number((payRate * CINGULAR_HOURLY_MARKUP_FACTOR).toFixed(2)) // 25.98% para Hourly
      }
    }

    if (otBillRate <= 0) {
      otBillRate = Number((billRate * 1.5).toFixed(2))
    }

    // Horas y Salarios
    let regHrs = 0
    let salHrs = 0
    let otHrs = 0
    let dtHrs = 0
    let mealHrs = 0
    let sickHrs = 0
    let vacHrs = 0
    let holHrs = 0
    let grossReg = 0
    let grossOt = 0
    let grossDt = 0
    let grossOther = 0
    let totPay = 0
    let invReg = 0
    let invOt = 0
    let invDt = 0
    let invOther = 0
    let totBill = 0

    const otPayRate = Number((payRate * 1.5).toFixed(2))
    const dtPayRate = Number((payRate * 2.0).toFixed(2))
    const dtBillRate = Number((billRate * 2.0).toFixed(2))

    if (salaried) {
      const baseSalHrs = isBiWeekly ? 80.0 : 40.0
      const totalPto = agg.sickHours + agg.vacationHours + agg.holidayHours
      sickHrs = Number(agg.sickHours.toFixed(2))
      vacHrs = Number(agg.vacationHours.toFixed(2))
      holHrs = Number(agg.holidayHours.toFixed(2))

      if (totalPto > 0) {
        // Obligación legal de California (LC § 246): Desglose de PTO en el talón de pago (Paystub)
        // La tarifa horaria equivalente se redondea a 2 decimales hacia arriba ($37.925 -> $37.93)
        const roundedHourlyPay = Number(payRate.toFixed(2))
        const roundedHourlyBill = Number(billRate.toFixed(2))
        salHrs = Math.max(0, baseSalHrs - totalPto)

        grossReg = Number((salHrs * roundedHourlyPay).toFixed(2))
        grossOther = Number((totalPto * roundedHourlyPay).toFixed(2))
        totPay = Number((grossReg + grossOther).toFixed(2))

        invReg = Number((salHrs * roundedHourlyBill).toFixed(2))
        invOther = Number((totalPto * roundedHourlyBill).toFixed(2))
        totBill = Number((invReg + invOther).toFixed(2))
      } else {
        salHrs = baseSalHrs
        grossReg = Number((salHrs * payRate).toFixed(2))
        totPay = grossReg
        invReg = Number((salHrs * billRate).toFixed(2))
        totBill = invReg
      }
    } else {
      agg.rawCards.forEach(card => {
        const cReg = Number((card.regular_hours || 0).toFixed(2))
        const cOt = Number((card.overtime_hours || 0).toFixed(2))
        const cDt = Number((card.double_time_hours || 0).toFixed(2))
        const cMeal = Number((card.meal_penalty_count || 0).toFixed(2))
        const cSick = Number((card.sick_hours || 0).toFixed(2))
        const cVac = Number((card.vacation_hours || 0).toFixed(2))
        const cHol = Number((card.holiday_hours || 0).toFixed(2))
        const cOther = cMeal + cSick + cVac + cHol

        regHrs += cReg
        otHrs += cOt
        dtHrs += cDt
        mealHrs += cMeal
        sickHrs += cSick
        vacHrs += cVac
        holHrs += cHol

        const cGrossReg = Number((cReg * payRate).toFixed(2))
        const cGrossOt = Number((cOt * otPayRate).toFixed(2))
        const cGrossDt = Number((cDt * dtPayRate).toFixed(2))
        const cGrossOther = Number((cOther * payRate).toFixed(2))
        const cTotPay = Number((cGrossReg + cGrossOt + cGrossDt + cGrossOther).toFixed(2))

        const cInvReg = Number((cReg * billRate).toFixed(2))
        const cInvOt = Number((cOt * otBillRate).toFixed(2))
        const cInvDt = Number((cDt * dtBillRate).toFixed(2))
        const cInvOther = Number((cOther * billRate).toFixed(2))
        const cTotBill = Number((cInvReg + cInvOt + cInvDt + cInvOther).toFixed(2))

        grossReg += cGrossReg
        grossOt += cGrossOt
        grossDt += cGrossDt
        grossOther += cGrossOther
        totPay += cTotPay

        invReg += cInvReg
        invOt += cInvOt
        invDt += cInvDt
        invOther += cInvOther
        totBill += cTotBill
      })

      // Round aggregated values
      regHrs = Number(regHrs.toFixed(2))
      otHrs = Number(otHrs.toFixed(2))
      dtHrs = Number(dtHrs.toFixed(2))
      mealHrs = Number(mealHrs.toFixed(2))
      sickHrs = Number(sickHrs.toFixed(2))
      vacHrs = Number(vacHrs.toFixed(2))
      holHrs = Number(holHrs.toFixed(2))
      grossReg = Number(grossReg.toFixed(2))
      grossOt = Number(grossOt.toFixed(2))
      grossDt = Number(grossDt.toFixed(2))
      grossOther = Number(grossOther.toFixed(2))
      totPay = Number(totPay.toFixed(2))
      invReg = Number(invReg.toFixed(2))
      invOt = Number(invOt.toFixed(2))
      invDt = Number(invDt.toFixed(2))
      invOther = Number(invOther.toFixed(2))
      totBill = Number(totBill.toFixed(2))
    }

    const totalCalculatedHours = salHrs + regHrs + otHrs + dtHrs + mealHrs + sickHrs + vacHrs + holHrs

    // Omitir colaboradores inactivos sin horas en el periodo
    if (totalCalculatedHours <= 0 && !salaried) return

    const cingularFee = Number((totBill - totPay).toFixed(2))
    const markupPct = totPay > 0 ? Number(((totBill / totPay - 1) * 100).toFixed(2)) : 0

    employeeItems.push({
      employeeId: agg.pin || String(uId),
      employeeUserId: uId,
      firstName: agg.firstName,
      lastName: agg.lastName,
      fullName: agg.fullName,
      jobTitle: detectedTitle,
      isSalaried: salaried,
      siteName: `TEG - ${storeMeta.tegName}`,
      payRate: Number(payRate.toFixed(2)),
      billRate: Number(billRate.toFixed(2)),
      regularHours: regHrs,
      salaryHours: salHrs,
      overtimeHours: otHrs,
      doubleTimeHours: dtHrs,
      mealPenaltyHours: mealHrs,
      sickHours: sickHrs,
      vacationHours: vacHrs,
      totalHours: Number(totalCalculatedHours.toFixed(2)),
      grossRegularPay: Number(grossReg.toFixed(2)),
      grossOvertimePay: Number(grossOt.toFixed(2)),
      grossDoubleTimePay: Number(grossDt.toFixed(2)),
      grossOtherPay: Number(grossOther.toFixed(2)),
      totalGrossPay: totPay,
      invoicedRegularCost: Number(invReg.toFixed(2)),
      invoicedOvertimeCost: Number(invOt.toFixed(2)),
      invoicedDoubleTimeCost: Number(invDt.toFixed(2)),
      invoicedOtherCost: Number(invOther.toFixed(2)),
      totalInvoicedAmount: totBill,
      cingularFeeAmount: cingularFee,
      markupPercentage: markupPct
    })
  })

  // Ordenar alfabéticamente
  employeeItems.sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }))

  // 5. Totales generales del reporte
  const totalEmployees = employeeItems.length
  const salariedCount = employeeItems.filter(e => e.isSalaried).length
  const hourlyCount = employeeItems.filter(e => !e.isSalaried).length

  const sumGrossPay = employeeItems.reduce((acc, e) => acc + e.totalGrossPay, 0)
  const sumInvoiced = employeeItems.reduce((acc, e) => acc + e.totalInvoicedAmount, 0)
  const sumCingularFee = employeeItems.reduce((acc, e) => acc + e.cingularFeeAmount, 0)

  const sumTotalHours = employeeItems.reduce((acc, e) => acc + e.totalHours, 0)
  const sumRegHours = employeeItems.reduce((acc, e) => acc + e.regularHours, 0)
  const sumSalHours = employeeItems.reduce((acc, e) => acc + e.salaryHours, 0)
  const sumOtHours = employeeItems.reduce((acc, e) => acc + e.overtimeHours, 0)
  const sumDtHours = employeeItems.reduce((acc, e) => acc + e.doubleTimeHours, 0)
  const sumMealHours = employeeItems.reduce((acc, e) => acc + e.mealPenaltyHours, 0)
  const sumSickHours = employeeItems.reduce((acc, e) => acc + e.sickHours, 0)
  const sumVacHours = employeeItems.reduce((acc, e) => acc + e.vacationHours, 0)

  const effectiveMarkup = sumGrossPay > 0 ? Number(((sumInvoiced / sumGrossPay - 1) * 100).toFixed(2)) : 0

  return {
    storeId: storeMeta.tegStoreId,
    storeCode: storeMeta.tegCode,
    storeName: storeMeta.tegName,
    ronosCompanyId,
    periodStartDate: '',
    periodEndDate: '',
    isBiWeekly,
    totalEmployees,
    salariedCount,
    hourlyCount,
    totalHours: Number(sumTotalHours.toFixed(2)),
    totalRegularHours: Number(sumRegHours.toFixed(2)),
    totalSalaryHours: Number(sumSalHours.toFixed(2)),
    totalOvertimeHours: Number(sumOtHours.toFixed(2)),
    totalDoubleTimeHours: Number(sumDtHours.toFixed(2)),
    totalMealPenaltyHours: Number(sumMealHours.toFixed(2)),
    totalSickHours: Number(sumSickHours.toFixed(2)),
    totalVacationHours: Number(sumVacHours.toFixed(2)),
    totalGrossPay: Number(sumGrossPay.toFixed(2)),
    totalInvoicedAmount: Number(sumInvoiced.toFixed(2)),
    totalCingularFee: Number(sumCingularFee.toFixed(2)),
    effectiveMarkupPercentage: effectiveMarkup,
    employees: employeeItems
  }
}

/**
 * Genera el archivo CSV idéntico al Summary Report oficial de Cingular HR
 */
export function generateCingularSummaryCSV(report: CingularInvoiceSummaryReport): string {
  const headers = [
    'EMP ID',
    'FIRST',
    'LAST',
    'SITE',
    'TIPO',
    'PAY RT',
    'TOT PAY',
    'BILL RT',
    'TOT BILL',
    'CINGULAR FEE',
    'TOT HRS',
    'REG',
    'SAL',
    'OT',
    'DT',
    'MEAL PENALTY',
    'SICK',
    'VAC'
  ]

  const rows = report.employees.map(e => [
    `"${e.employeeId}"`,
    `"${e.firstName}"`,
    `"${e.lastName}"`,
    `"${e.siteName}"`,
    `"${e.isSalaried ? 'SALARIED (EXEMPT)' : 'HOURLY (NON-EXEMPT)'}"`,
    e.payRate.toFixed(2),
    e.totalGrossPay.toFixed(2),
    e.billRate.toFixed(2),
    e.totalInvoicedAmount.toFixed(2),
    e.cingularFeeAmount.toFixed(2),
    e.totalHours.toFixed(2),
    e.regularHours.toFixed(2),
    e.salaryHours.toFixed(2),
    e.overtimeHours.toFixed(2),
    e.doubleTimeHours.toFixed(2),
    e.mealPenaltyHours.toFixed(2),
    e.sickHours.toFixed(2),
    e.vacationHours.toFixed(2)
  ])

  const totalsRow = [
    '"TOTALS"',
    '""',
    '""',
    `"${report.storeName}"`,
    `"${report.salariedCount} Salaried / ${report.hourlyCount} Hourly"`,
    '""',
    report.totalGrossPay.toFixed(2),
    '""',
    report.totalInvoicedAmount.toFixed(2),
    report.totalCingularFee.toFixed(2),
    report.totalHours.toFixed(2),
    report.totalRegularHours.toFixed(2),
    report.totalSalaryHours.toFixed(2),
    report.totalOvertimeHours.toFixed(2),
    report.totalDoubleTimeHours.toFixed(2),
    report.totalMealPenaltyHours.toFixed(2),
    report.totalSickHours.toFixed(2),
    report.totalVacationHours.toFixed(2)
  ]

  return [headers.join(','), ...rows.map(r => r.join(',')), totalsRow.join(',')].join('\n')
}
