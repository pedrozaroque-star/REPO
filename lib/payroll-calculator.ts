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
import { getSimplifyHrRateForEmployee } from './simplifyhr-api'

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
  holidayHours: number
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
  // Campos de Auditoría PEO y Discrepancias
  auditStatus?: 'exact' | 'saving' | 'variance' | 'pto'
  auditBadgeText?: string
  auditNote?: string
  simplifyPayRate?: number
  simplifyPayType?: string
  varianceAmount?: number
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
  totalHolidayHours?: number
  totalGrossPay: number
  totalInvoicedAmount: number
  totalCingularFee: number
  effectiveMarkupPercentage: number
  // Métricas de Auditoría PEO
  exactMatchesCount: number
  auditAlertsCount: number
  auditSavingsAmount: number
  reconciliationPercentage: number
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

  // Sucursal Azusa (TEG - Azusa #4 / Company ID: 24 / TEGA-0009)
  'lucia reyes rubi': { payRate: 33.80, billRate: 42.08 }, // GM $70,304/yr ($33.80/hr -> $2,704.00 bi-weekly / $3,366.40 billed)
  'lucia reyes': { payRate: 33.80, billRate: 42.08 },
  'yadira sanchez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'abraham lopez morales': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'abraham lopez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'jacob antonio jacinto': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'jacob jacinto': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'antonio lorenzo': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'antonio lorenzo martinez': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'isaias moreno': { payRate: 18.40, billRate: 23.18, otBillRate: 34.77 },
  'ramon ruesga': { payRate: 18.15, billRate: 22.87, otBillRate: 34.31 },
  'deysi rosales valdivia': { payRate: 17.90, billRate: 22.55, otBillRate: 33.83 },
  'deysi valdivia': { payRate: 17.90, billRate: 22.55, otBillRate: 33.83 },
  'belgine martinez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'julieta lopez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'lucy valenzuela': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'luis miguel tetatzin temeca': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'luis miguel tetatzin': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'miguel jimenez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'valentina lopez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'jenifer janet brandon salvatierra': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'jenifer blandon': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },

  // Sucursal La Puente (TEG - La Puente #15 / Company ID: 37 / TEGL-0022)
  'benjamin nunez': { payRate: 34.89, billRate: 43.43 }, // General Manager ($72,571/yr -> $2,791.00 pay / $3,474.40 billed)
  'benjamin nuñez': { payRate: 34.89, billRate: 43.43 },
  'wilmer martinez': { payRate: 22.97, billRate: 22.97, otBillRate: 34.46 }, // Caso especial: Facturado con 0% markup en billRate base por Cingular
  'josue martinez': { payRate: 22.47, billRate: 28.31, otBillRate: 42.47 },
  'araceli rojas': { payRate: 22.43, billRate: 28.26, otBillRate: 42.39 },
  'adelfo castro': { payRate: 21.93, billRate: 27.63, otBillRate: 41.45 },
  'danilo ical': { payRate: 21.93, billRate: 27.63, otBillRate: 41.45 },
  'leonela castro': { payRate: 21.43, billRate: 27.00, otBillRate: 40.50 },
  'maria castro': { payRate: 20.97, billRate: 26.42, otBillRate: 39.63 },
  'gustavo juan': { payRate: 18.97, billRate: 23.90, otBillRate: 35.85 },
  'kiara sheccid cortes diaz': { payRate: 18.97, billRate: 23.90, otBillRate: 35.85 },
  'kiara cortes': { payRate: 18.97, billRate: 23.90, otBillRate: 35.85 },
  'gustavo arizaga': { payRate: 18.47, billRate: 23.27, otBillRate: 34.91 },
  'guillermo ibarra': { payRate: 18.47, billRate: 23.27, otBillRate: 34.91 },
  'filemon ortega ruiz': { payRate: 18.47, billRate: 23.27, otBillRate: 34.91 },
  'filemon ortega': { payRate: 18.47, billRate: 23.27, otBillRate: 34.91 },
  'fabiola ruso': { payRate: 18.47, billRate: 23.27, otBillRate: 34.91 },
  'heriberto nava': { payRate: 18.47, billRate: 23.27, otBillRate: 34.91 },

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
 * Empleados que Cingular factura bajo otra entidad/tienda aunque ponchen en la sucursal
 * indicada en RONOS. Se excluyen del cálculo de la tienda donde poncharon.
 * Clave = ronosCompanyId, Valor = lista de fragmentos de nombre normalizados (lowercase)
 */
const CINGULAR_EMPLOYEE_EXCLUSIONS: Record<number, string[]> = {
  // Azusa (#4 / TEGA / Company 24): Arnoldo y Ricardo son facturados por Cingular
  // bajo otra entidad, no aparecen en invoice TEGA-0009
  24: ['arnoldo balladares', 'ricardo joel escobar'],
}

/**
 * Helper de parseo numérico seguro
 */
function safeNum(val: any, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return isNaN(n) || !isFinite(n) ? fallback : n
}

/**
 * Determina si un colaborador es asalariado (Exempt) o por hora (Non-Exempt)
 * Arquitectura en cascada multicapa:
 * 1. Descalificación inmediata de asistentes, líderes y personal operativo.
 * 2. Umbral legal salarial de California ($30.00/h ≈ $62,400/año).
 * 3. Validación de Gerentes Generales (GMs) y Directivos Oficiales.
 * 4. Títulos manageriales ejecutivos exentos.
 */
export function isEmployeeSalaried(jobTitle?: string, fullName?: string, payRate?: number): boolean {
  if (!jobTitle && !fullName) return false
  const title = String(jobTitle || '').toLowerCase().trim()
  const name = String(fullName || '').toLowerCase().trim()

  // 1. Verificación por Nombres de Gerentes Generales (GMs) y Directivos Oficiales (Precedencia Absoluta)
  if (
    name.includes('jovana garcia') ||
    name.includes('carlos velazquez') ||
    name.includes('jesus ramos') ||
    name.includes('aaron hernandez') ||
    name.includes('aaron chay') ||
    name.includes('lucia reyes') ||
    name.includes('benjamin nunez') ||
    name.includes('benjamin nuñez') ||
    name.includes('alfonso carrillo') ||
    name.includes('bernabe ramirez') ||
    name.includes('julio valadez') ||
    name.includes('marco salgado') ||
    name.includes('marco antonio salgado') ||
    name.includes('erick martinez') ||
    name.includes('jesus olivares') ||
    name.includes('eloy velazquez')
  ) {
    return true
  }

  // 2. Descalificación Inmediata: Asistentes, Mandos Medios y Personal Operativo
  // En Tacos Gavilan y bajo la ley de California (IWC Order 5), todo asistente, líder o personal de línea es Por Hora (Non-Exempt)
  if (
    title.includes('asst') ||
    title.includes('assistant') ||
    title.includes('asistente') ||
    title.includes('subgerente') ||
    title.includes('shift') ||
    title.includes('lead') ||
    title.includes('lider') ||
    title.includes('crew') ||
    title.includes('taquero') ||
    title.includes('cajero') ||
    title.includes('cocinero') ||
    title.includes('cook') ||
    title.includes('cashier') ||
    title.includes('dishwasher') ||
    title.includes('driver') ||
    title.includes('chofer') ||
    (title.includes('bodega') && !title.includes('manager') && !title.includes('supervisor') && !title.includes('gerente')) ||
    (title.includes('warehouse') && !title.includes('manager') && !title.includes('supervisor') && !title.includes('gerente')) ||
    title.includes('colaborador') ||
    title.includes('team')
  ) {
    return false
  }

  // 3. Umbral Salarial Legal de California ($30.00/h)
  // Cualquier colaborador con tarifa base menor a $30/h es legalmente Por Hora (Non-Exempt)
  if (payRate !== undefined && payRate > 0 && payRate < 30.00) {
    return false
  }

  // 4. Verificación por Títulos Manageriales Exentos Reales
  return (
    title.includes('general manager') ||
    title.includes('gerente general') ||
    title.includes('district manager') ||
    title.includes('area manager') ||
    title.includes('area supervisor') ||
    title.includes('store manager') ||
    title === 'manager' ||
    (title.includes('gerente') && !title.includes('asistente') && !title.includes('subgerente') && !title.includes('turno'))
  )
}

/**
 * Calcula la nómina y proyección exacta de facturación Cingular HR para una sucursal y semana(s)
 */
export async function calculateCingularPayrollReport(
  companyIdOrParams: number | {
    ronosCompanyId?: number
    companyId?: number
    weekIds?: (number | string)[]
    periodId?: string | number | (number | string)[]
    isBiWeekly?: boolean
    biWeekly?: boolean
    useLiveRates?: boolean
    syncSimplify?: boolean
  },
  rawWeekIds?: (number | string)[] | string | number,
  isBiWeeklyParam = true
): Promise<CingularInvoiceSummaryReport> {
  let ronosCompanyId = 34
  let rawWeeks: (number | string)[] = []
  let isBiWeekly = isBiWeeklyParam

  if (typeof companyIdOrParams === 'object' && companyIdOrParams !== null) {
    ronosCompanyId = Number(companyIdOrParams.ronosCompanyId || companyIdOrParams.companyId || 34)
    const pWeeks = companyIdOrParams.weekIds || companyIdOrParams.periodId
    if (Array.isArray(pWeeks)) {
      rawWeeks = pWeeks
    } else if (typeof pWeeks === 'string') {
      rawWeeks = pWeeks.split(',').map(s => s.trim())
    } else if (typeof pWeeks === 'number') {
      rawWeeks = [pWeeks]
    }
    isBiWeekly = companyIdOrParams.isBiWeekly ?? companyIdOrParams.biWeekly ?? true
  } else {
    ronosCompanyId = Number(companyIdOrParams || 34)
    rawWeeks = Array.isArray(rawWeekIds) ? rawWeekIds : typeof rawWeekIds === 'string' ? rawWeekIds.split(',').map(s => s.trim()) : typeof rawWeekIds === 'number' ? [rawWeekIds] : []
    isBiWeekly = isBiWeeklyParam
  }

  const weekIds: number[] = rawWeeks
    .map(w => Number(w))
    .filter(n => !isNaN(n) && n > 0)

  const storeMeta = RONOS_STORES_MAP.find(s => s.ronosCompanyId === ronosCompanyId) || {
    tegStoreId: 0,
    tegCode: 'UNKNOWN',
    tegName: 'Desconocida',
    ronosCompanyId,
    ronosName: `Store #${ronosCompanyId}`
  }

  // 1. Obtener rango de fechas de las semanas
  const { data: wWeeks } = await supabaseAdmin
    .from('ronos_work_weeks')
    .select('start_date, end_date')
    .in('week_id', weekIds)
    .order('start_date', { ascending: true })

  const periodStartDate = Array.isArray(wWeeks) && wWeeks[0]?.start_date ? String(wWeeks[0].start_date).substring(0, 10) : ''
  const periodEndDate = Array.isArray(wWeeks) && wWeeks.length > 0 && wWeeks[wWeeks.length - 1]?.end_date
    ? String(wWeeks[wWeeks.length - 1].end_date).substring(0, 10)
    : ''

  // 2. Obtener tarjetas de tiempo de Supabase
  let { data: timecards, error: tErr } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('*')
    .eq('company_id', ronosCompanyId)
    .in('week_id', weekIds)

  if (tErr) {
    console.error('Error fetching timecards for Cingular payroll calculation:', tErr.message)
  }

  // Si faltan semanas en la caché de Supabase, sincronizarlas automáticamente en tiempo real
  const cachedWeekIds = new Set((timecards || []).filter(Boolean).map(tc => tc?.week_id).filter((id): id is number => typeof id === 'number' && !isNaN(id)))
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

  if (Array.isArray(toastEmps) && toastEmps.length > 0) {
    toastEmps.forEach(te => {
      if (!te) return
      const fName = String(te.first_name || '').trim().toLowerCase().replace(/\s+/g, ' ')
      const lName = String(te.last_name || '').trim().toLowerCase().replace(/\s+/g, ' ')
      const normalizedName = `${fName} ${lName}`.trim().replace(/\s+/g, ' ')
      if (Array.isArray(te.wage_data) && te.wage_data.length > 0) {
        const w = Number(te.wage_data[0]?.wage)
        if (w > 0) {
          wageMap.set(normalizedName, w)
          if (fName && lName) wageMap.set(`${fName}|${lName}`, w)
        }
      }
      if (Array.isArray(te.job_references) && te.job_references.length > 0) {
        const title = String(te.job_references[0]?.title || te.job_references[0]?.name || '')
        if (title) {
          titleMap.set(normalizedName, title)
          if (fName && lName) titleMap.set(`${fName}|${lName}`, title)
        }
      }
    })
  }

  // 2b. Detectar empleados que Cingular factura en otra entidad/tienda
  // Hay dos fuentes:
  //  A) CINGULAR_EMPLOYEE_EXCLUSIONS: Empleados verificados manualmente que Cingular no incluye
  //     en la factura de esta tienda (ej: los factura bajo otra razón social o sucursal)
  //  B) ronos_employee_mappings: Empleados mapeados a otra tienda en nuestro sistema
  const transferredOutUserIds = new Set<number>()

  // Fuente A: Exclusiones verificadas por nombre (Cingular los factura en otra entidad)
  const storeExclusions = CINGULAR_EMPLOYEE_EXCLUSIONS[ronosCompanyId] || []

  // Fuente B: Mapeos en otras tiendas desde ronos_employee_mappings
  const { data: allMappings } = await supabaseAdmin
    .from('ronos_employee_mappings')
    .select('ronos_employee_user_id, ronos_company_id, ronos_full_name')

  if (Array.isArray(allMappings) && allMappings.length > 0) {
    const thisStoreUserIds = new Set((timecards || []).map(tc => tc?.employee_user_id).filter(Boolean))
    for (const m of allMappings) {
      if (!m) continue
      const uid = m.ronos_employee_user_id
      if (!uid) continue
      if (m.ronos_company_id !== ronosCompanyId && thisStoreUserIds.has(uid)) {
        transferredOutUserIds.add(uid)
      }
    }
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
    if (!card) return
    const uId = card.employee_user_id
    if (!uId) return
    const cardName = String(card.full_name || `${card.first_name || ''} ${card.last_name || ''}`).toLowerCase()
    // Omitir tarjeta/cuenta técnica de control de tableta (PIN 1111 o placeholders 'manager default' / 'manager [tienda]')
    if (String(card.pin || '') === '1111' || cardName.includes('manager default') || cardName.startsWith('manager ')) return
    // Fix #1a: Omitir empleados transferidos por UID (detectados vía ronos_employee_mappings)
    if (transferredOutUserIds.has(uId)) return
    // Fix #1b: Omitir empleados excluidos por nombre (Cingular los factura en otra entidad)
    if (storeExclusions.some(excl => cardName.includes(excl))) return

    let agg = empAggregation.get(uId)
    if (!agg) {
      agg = {
        rawCards: [],
        fullName: String(card.full_name || `${card.first_name || ''} ${card.last_name || ''}`.trim()),
        firstName: String(card.first_name || ''),
        lastName: String(card.last_name || ''),
        pin: String(card.pin || ''),
        jobTitle: String(card.job_title || ''),
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
    agg.totalHours += safeNum(card.total_weekly_hours)
    agg.regularHours += safeNum(card.regular_hours)
    agg.overtimeHours += safeNum(card.overtime_hours)
    agg.doubleTimeHours += safeNum(card.double_time_hours)
    agg.mealPenalties += safeNum(card.meal_penalty_count)
    agg.sickHours += safeNum(card.sick_hours)
    agg.vacationHours += safeNum(card.vacation_hours)
    agg.holidayHours += safeNum(card.holiday_hours)
  })

  // 4. Calcular importes exactos empleado por empleado
  const employeeItems: CingularEmployeePayrollItem[] = []

  empAggregation.forEach((agg, uId) => {
    const normName = String(agg?.fullName || '').toLowerCase().trim().replace(/\s+/g, ' ')
    const detectedTitle = String(titleMap.get(normName) || agg?.jobTitle || 'Crew')

    // Determinar Pay Rate & Bill Rate (Prioridad: Simplify HR Live Rates -> Registros Verificados Cingular -> Toast Wage Data -> Default)
    let payRate = 0
    let billRate = 0
    let otBillRate = 0

    // 1. Buscar en tarifas maestras verificadas de Cingular (calibradas contra invoice real)
    // Fix #3: Primero buscar coincidencia exacta para evitar falsos positivos
    const exactOverride = CINGULAR_RATE_OVERRIDES[normName]
    if (exactOverride) {
      payRate = exactOverride.payRate
      billRate = exactOverride.billRate
      otBillRate = exactOverride.otBillRate || 0
    }
    // Si no hay exacta, buscar coincidencia parcial con longitud mínima de 8 caracteres
    if (payRate <= 0) {
      for (const [key, val] of Object.entries(CINGULAR_RATE_OVERRIDES)) {
        if (key.length < 8) continue // Evitar matches con nombres muy cortos (ej: "jose")
        if (normName.includes(key) || key.includes(normName)) {
          payRate = val.payRate
          billRate = val.billRate
          otBillRate = val.otBillRate || 0
          break
        }
      }
    }

    // 2. Buscar en Simplify HR OS (Tarifas Reales del PEO — fallback para tiendas sin override)
    if (payRate <= 0) {
      const simplifyRate = getSimplifyHrRateForEmployee(normName) || (agg.pin ? getSimplifyHrRateForEmployee(agg.pin) : null)
      if (simplifyRate && simplifyRate.payRate > 0) {
        payRate = simplifyRate.payRate
        billRate = simplifyRate.billRate
      }
    }

    // 3. Buscar en Toast Wage Data
    if (payRate <= 0) {
      const fName = String(agg.firstName || '').toLowerCase().trim()
      const lName = String(agg.lastName || '').toLowerCase().trim()
      payRate = wageMap.get(normName) || (fName && lName ? wageMap.get(`${fName}|${lName}`) : 0) || 0
    }

    // 4. Determinar clasificación Salaried vs Hourly con arquitectura multicapa
    const salaried = isEmployeeSalaried(detectedTitle, agg.fullName, payRate)

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
      const baseSalHrs = isBiWeekly ? (weekIds.length === 1 ? 40.0 : 80.0) : 40.0
      const totalPto = agg.sickHours + agg.vacationHours + agg.holidayHours
      sickHrs = Number(safeNum(agg.sickHours).toFixed(2))
      vacHrs = Number(safeNum(agg.vacationHours).toFixed(2))
      holHrs = Number(safeNum(agg.holidayHours).toFixed(2))

      if (totalPto > 0) {
        // Obligación legal de California (LC § 246): Desglose de PTO en el talón de pago (Paystub)
        // La tarifa horaria equivalente se redondea a 2 decimales hacia arriba ($37.925 -> $37.93)
        const roundedHourlyPay = Number(safeNum(payRate).toFixed(2))
        const roundedHourlyBill = Number(safeNum(billRate).toFixed(2))
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
        if (!card) return
        let cReg = Number(safeNum(card.regular_hours).toFixed(2))
        const cOt = Number(safeNum(card.overtime_hours).toFixed(2))
        const cDt = Number(safeNum(card.double_time_hours).toFixed(2))
        const cMeal = Number(safeNum(card.meal_penalty_count).toFixed(2))
        const cSick = Number(safeNum(card.sick_hours).toFixed(2))
        const cVac = Number(safeNum(card.vacation_hours).toFixed(2))
        const cHol = Number(safeNum(card.holiday_hours).toFixed(2))

        // Fix #2: Cuando un empleado tiene horas de Sick Pay >= horas regulares y no tiene OT/DT,
        // Cingular trata el Sick Pay como reemplazo de las horas regulares (no las suma).
        // Observado en invoice TEGA-0009: Jenifer tenía 11.26 hrs regulares + 16 hrs sick en RONOS,
        // pero Cingular solo facturó las 16 hrs de sick, omitiendo las 11.26 regulares.
        // Regla: Si sick >= regular Y no hay OT ni DT, las regulares son cubiertas por el sick.
        if (cSick > 0 && cSick >= cReg && cOt === 0 && cDt === 0) {
          cReg = 0
        }

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
      regHrs = Number(safeNum(regHrs).toFixed(2))
      otHrs = Number(safeNum(otHrs).toFixed(2))
      dtHrs = Number(safeNum(dtHrs).toFixed(2))
      mealHrs = Number(safeNum(mealHrs).toFixed(2))
      sickHrs = Number(safeNum(sickHrs).toFixed(2))
      vacHrs = Number(safeNum(vacHrs).toFixed(2))
      holHrs = Number(safeNum(holHrs).toFixed(2))
      grossReg = Number(safeNum(grossReg).toFixed(2))
      grossOt = Number(safeNum(grossOt).toFixed(2))
      grossDt = Number(safeNum(grossDt).toFixed(2))
      grossOther = Number(safeNum(grossOther).toFixed(2))
      totPay = Number(safeNum(totPay).toFixed(2))
      invReg = Number(safeNum(invReg).toFixed(2))
      invOt = Number(safeNum(invOt).toFixed(2))
      invDt = Number(safeNum(invDt).toFixed(2))
      invOther = Number(safeNum(invOther).toFixed(2))
      totBill = Number(safeNum(totBill).toFixed(2))
    }

    const totalCalculatedHours = salHrs + regHrs + otHrs + dtHrs + mealHrs + sickHrs + vacHrs + holHrs

    // Omitir colaboradores inactivos sin horas en el periodo
    if (totalCalculatedHours <= 0 && !salaried) return

    const cingularFee = Number((totBill - totPay).toFixed(2))
    const markupPct = totPay > 0 ? Number(((totBill / totPay - 1) * 100).toFixed(2)) : 0

    // Determinar estado de auditoría y notas descriptivas
    let auditStatus: 'exact' | 'saving' | 'variance' | 'pto' = 'exact'
    let auditBadgeText = 'Cuadre Exacto'
    let auditNote = `Tarifa de contrato Simplify HR: $${safeNum(payRate).toFixed(2)}/hr (Factura: $${safeNum(billRate).toFixed(2)}/hr)`
    let varianceAmt = 0

    if (normName === 'wilmer martinez' && Math.abs(billRate - payRate) < 0.05) {
      auditStatus = 'saving'
      const contractualBill = Number((totPay * CINGULAR_HOURLY_MARKUP_FACTOR).toFixed(2))
      varianceAmt = Number((contractualBill - totBill).toFixed(2))
      auditBadgeText = 'Ahorro PEO (0% Markup)'
      auditNote = `Cingular facturó con 0% markup base ($${safeNum(billRate).toFixed(2)} bill). Ahorro para TEG: $${safeNum(varianceAmt).toFixed(2)}`
    } else if (normName.includes('benjamin nunez') || normName.includes('benjamin nuñez')) {
      auditStatus = 'variance'
      auditBadgeText = 'Salario GM PEO'
      auditNote = `Salario en Simplify HR ($71,292/yr) vs Facturado ($72,571/yr)`
    } else if (sickHrs > 0 || vacHrs > 0) {
      auditStatus = 'pto'
      const ptoHrs = Number(safeNum(sickHrs + vacHrs).toFixed(1))
      auditBadgeText = `Permiso (${ptoHrs}h)`
      auditNote = `Incluye ${sickHrs > 0 ? `${sickHrs}h Enfermedad (Sick) ` : ''}${vacHrs > 0 ? `${vacHrs}h Vacaciones (PTO)` : ''}`
    }

    employeeItems.push({
      employeeId: agg.pin || String(uId),
      employeeUserId: uId,
      firstName: agg.firstName,
      lastName: agg.lastName,
      fullName: agg.fullName,
      jobTitle: detectedTitle,
      isSalaried: salaried,
      siteName: `TEG - ${storeMeta?.tegName || 'Desconocida'}`,
      payRate: Number(safeNum(payRate).toFixed(2)),
      billRate: Number(safeNum(billRate).toFixed(2)),
      regularHours: regHrs,
      salaryHours: salHrs,
      overtimeHours: otHrs,
      doubleTimeHours: dtHrs,
      mealPenaltyHours: mealHrs,
      sickHours: sickHrs,
      vacationHours: vacHrs,
      holidayHours: holHrs,
      totalHours: Number(safeNum(totalCalculatedHours).toFixed(2)),
      grossRegularPay: Number(safeNum(grossReg).toFixed(2)),
      grossOvertimePay: Number(safeNum(grossOt).toFixed(2)),
      grossDoubleTimePay: Number(safeNum(grossDt).toFixed(2)),
      grossOtherPay: Number(safeNum(grossOther).toFixed(2)),
      totalGrossPay: totPay,
      invoicedRegularCost: Number(safeNum(invReg).toFixed(2)),
      invoicedOvertimeCost: Number(safeNum(invOt).toFixed(2)),
      invoicedDoubleTimeCost: Number(safeNum(invDt).toFixed(2)),
      invoicedOtherCost: Number(safeNum(invOther).toFixed(2)),
      totalInvoicedAmount: totBill,
      cingularFeeAmount: cingularFee,
      markupPercentage: markupPct,
      auditStatus,
      auditBadgeText,
      auditNote,
      varianceAmount: varianceAmt
    })
  })

  // Ordenar alfabéticamente
  employeeItems.sort((a, b) => String(a?.fullName || '').localeCompare(String(b?.fullName || ''), 'es', { sensitivity: 'base' }))

  // 5. Totales generales del reporte
  const totalEmployees = employeeItems.length
  const salariedCount = employeeItems.filter(e => e.isSalaried).length
  const hourlyCount = employeeItems.filter(e => !e.isSalaried).length

  const sumGrossPay = employeeItems.reduce((acc, e) => acc + safeNum(e?.totalGrossPay), 0)
  const sumInvoiced = employeeItems.reduce((acc, e) => acc + safeNum(e?.totalInvoicedAmount), 0)
  const sumCingularFee = employeeItems.reduce((acc, e) => acc + safeNum(e?.cingularFeeAmount), 0)

  const sumTotalHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.totalHours), 0)
  const sumRegHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.regularHours), 0)
  const sumSalHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.salaryHours), 0)
  const sumOtHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.overtimeHours), 0)
  const sumDtHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.doubleTimeHours), 0)
  const sumMealHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.mealPenaltyHours), 0)
  const sumSickHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.sickHours), 0)
  const sumVacHours = employeeItems.reduce((acc, e) => acc + safeNum(e?.vacationHours), 0)

  const effectiveMarkup = sumGrossPay > 0 ? Number(safeNum((sumInvoiced / sumGrossPay - 1) * 100).toFixed(2)) : 0

  const exactMatchesCount = employeeItems.filter(e => e.auditStatus === 'exact' || e.auditStatus === 'pto').length
  const auditAlertsCount = employeeItems.filter(e => e.auditStatus === 'saving' || e.auditStatus === 'variance').length
  const auditSavingsAmount = employeeItems.filter(e => e.auditStatus === 'saving').reduce((acc, e) => acc + safeNum(e?.varianceAmount), 0)
  const reconciliationPercentage = totalEmployees > 0 ? Number(safeNum((exactMatchesCount / totalEmployees) * 100).toFixed(1)) : 100

  return {
    storeId: storeMeta.tegStoreId,
    storeCode: storeMeta.tegCode,
    storeName: storeMeta.tegName,
    ronosCompanyId,
    periodStartDate,
    periodEndDate,
    isBiWeekly,
    totalEmployees,
    salariedCount,
    hourlyCount,
    totalHours: Number(safeNum(sumTotalHours).toFixed(2)),
    totalRegularHours: Number(safeNum(sumRegHours).toFixed(2)),
    totalSalaryHours: Number(safeNum(sumSalHours).toFixed(2)),
    totalOvertimeHours: Number(safeNum(sumOtHours).toFixed(2)),
    totalDoubleTimeHours: Number(safeNum(sumDtHours).toFixed(2)),
    totalMealPenaltyHours: Number(safeNum(sumMealHours).toFixed(2)),
    totalSickHours: Number(safeNum(sumSickHours).toFixed(2)),
    totalVacationHours: Number(safeNum(sumVacHours).toFixed(2)),
    totalGrossPay: Number(safeNum(sumGrossPay).toFixed(2)),
    totalInvoicedAmount: Number(safeNum(sumInvoiced).toFixed(2)),
    totalCingularFee: Number(safeNum(sumCingularFee).toFixed(2)),
    effectiveMarkupPercentage: effectiveMarkup,
    exactMatchesCount,
    auditAlertsCount,
    auditSavingsAmount: Number(safeNum(auditSavingsAmount).toFixed(2)),
    reconciliationPercentage,
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
    'JOB TITLE',
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
    'VAC',
    'HOLIDAY',
    'AUDIT STATUS',
    'AUDIT NOTE'
  ]

  const employees = Array.isArray(report?.employees) ? report.employees : []
  const rows = employees.map(e => [
    `"${e.employeeId}"`,
    `"${e.firstName}"`,
    `"${e.lastName}"`,
    `"${e.siteName}"`,
    `"${e.jobTitle || 'Team Member'}"`,
    `"${e.isSalaried ? 'SALARIED (EXEMPT)' : 'HOURLY (NON-EXEMPT)'}"`,
    safeNum(e?.payRate).toFixed(2),
    safeNum(e?.totalGrossPay).toFixed(2),
    safeNum(e?.billRate).toFixed(2),
    safeNum(e?.totalInvoicedAmount).toFixed(2),
    safeNum(e?.cingularFeeAmount).toFixed(2),
    safeNum(e?.totalHours).toFixed(2),
    safeNum(e?.regularHours).toFixed(2),
    safeNum(e?.salaryHours).toFixed(2),
    safeNum(e?.overtimeHours).toFixed(2),
    safeNum(e?.doubleTimeHours).toFixed(2),
    safeNum(e?.mealPenaltyHours).toFixed(2),
    safeNum(e?.sickHours).toFixed(2),
    safeNum(e?.vacationHours).toFixed(2),
    safeNum(e?.holidayHours).toFixed(2),
    `"${e.auditBadgeText || 'Normal'}"`,
    `"${(e.auditNote || '').replace(/"/g, '""')}"`
  ])

  const totalsRow = [
    '"TOTALS"',
    '""',
    '""',
    `"${report?.storeName || ''}"`,
    '""',
    `"${safeNum(report?.salariedCount)} Salaried / ${safeNum(report?.hourlyCount)} Hourly"`,
    '""',
    safeNum(report?.totalGrossPay).toFixed(2),
    '""',
    safeNum(report?.totalInvoicedAmount).toFixed(2),
    safeNum(report?.totalCingularFee).toFixed(2),
    safeNum(report?.totalHours).toFixed(2),
    safeNum(report?.totalRegularHours).toFixed(2),
    safeNum(report?.totalSalaryHours).toFixed(2),
    safeNum(report?.totalOvertimeHours).toFixed(2),
    safeNum(report?.totalDoubleTimeHours).toFixed(2),
    safeNum(report?.totalMealPenaltyHours).toFixed(2),
    safeNum(report?.totalSickHours).toFixed(2),
    safeNum(report?.totalVacationHours).toFixed(2),
    safeNum(report?.totalHolidayHours).toFixed(2),
    '""',
    '""'
  ]

  return [headers.join(','), ...rows.map(r => r.join(',')), totalsRow.join(',')].join('\n')
}
