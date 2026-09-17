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
import {
  getSimplifyHrRateForEmployee,
  ensureSimplifyRatesLoaded,
  RONOS_TO_SIMPLIFY_SITE_MAP,
  getSitePaystubs,
  SimplifyHrPaystub
} from './simplifyhr-api'

export const CINGULAR_HOURLY_MARKUP_FACTOR = 1.26 // 26.00% markup oficial Cingular HR (Confirmado por Raquel)
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
  // Soporte Multi-Lote / Facturas Suplementarias (Finiquitos vs Regular vs Consolidado)
  invoiceMode?: 'regular' | 'supplemental' | 'consolidated'
  supplementalsCount?: number
  supplementalsList?: SupplementalInvoiceInfo[]
  employees: CingularEmployeePayrollItem[]
}

// Registro oficial de tarifas de facturación de Cingular HR (Master Rates)
export const CINGULAR_RATE_OVERRIDES: Record<string, { payRate: number; billRate: number; otBillRate?: number; otPayRate?: number; vacationHours?: number; overtimeHours?: number }> = {
  'ana diaz': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'axel zamora': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'carolina sarabia': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'damaris vargas': { payRate: 19.40, billRate: 24.44, otBillRate: 36.67 },
  'esmeralda nicolas': { payRate: 17.90, billRate: 22.55, otBillRate: 33.83 },
  'freddie gurrusquieta': { payRate: 19.90, billRate: 25.07, otBillRate: 37.61 },
  'fredy leonardo tzalam pop': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'gilberto zepeda aguilar': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'gilberto aguilar': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'jesse julian alatorre quezada': { payRate: 21.87, billRate: 27.56, otBillRate: 41.33 },
  'jesse quezada': { payRate: 21.87, billRate: 27.56, otBillRate: 41.33 },
  'jesus alberto felipe miguel': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'jorge loaiza': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'jovana garcia': { payRate: 39.90, billRate: 49.68, otBillRate: 49.68 },
  'julian orozco bravo': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'julian bravo': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'marcos zamora ortiz': { payRate: 17.81, billRate: 22.44, otBillRate: 33.65 },
  'maria rivera': { payRate: 22.40, billRate: 28.22, otBillRate: 42.34 },
  'maria d jimenez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'misael aguilar estrada': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'misael aguilar': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'rafael lopez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'robinson adriano orozco': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'robinson orozco': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'rolando miguel zetina': { payRate: 17.90, billRate: 22.55, otBillRate: 33.83 },
  'rolando miguel': { payRate: 17.90, billRate: 22.55, otBillRate: 33.83 },
  'santos hernandez': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'senia yasmini del cid martinez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'senia martinez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'sueam martinez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },

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
  'karla heredia': { payRate: 19.65, billRate: 24.76, otBillRate: 37.13, otPayRate: 29.48 },
  'kevin campos': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'mario sanchez': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'paola castaneda': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'salvador hernandez': { payRate: 20.40, billRate: 25.70, otBillRate: 38.56 },
  'salvador velazquez': { payRate: 20.40, billRate: 25.70, otBillRate: 38.56 },

  // Sucursal Downey (TEG - Downey #16 / Company ID: 32 / TEGD-0008)
  'jesus olivares': { payRate: 33.80, billRate: 42.08 }, // General Manager ($70,304/yr -> $33.80/hr / $2,704.00 gross / $3,366.40 billed)
  'adelina lopez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'carlos morales': { payRate: 19.40, billRate: 24.44, otBillRate: 36.67 },
  'daniela castro gamboa': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'daniela castro': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'gabriel vargas': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'gabriela rodriguez': { payRate: 18.40, billRate: 23.18, otBillRate: 34.78 },
  'jorge sifuentes': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'jose luis hernandez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'jose hernandez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'juan ruiz': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'leonardo jose guillen orozco': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'leonardo orozco': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'libni sarai santizo reyes': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'libni sarai santizo': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'libni santizo': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'luis antonio gutierrez': { payRate: 18.40, billRate: 23.18, otBillRate: 34.78 },
  'luis gutierrez': { payRate: 18.40, billRate: 23.18, otBillRate: 34.78 },
  'margarita gutierrez chairez': { payRate: 19.90, billRate: 25.07, otBillRate: 37.61 },
  'margarita chairez': { payRate: 19.90, billRate: 25.07, otBillRate: 37.61 },
  'marisol velasco': { payRate: 18.90, billRate: 23.81, otBillRate: 35.72 },
  'marvin hernandez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'miguel andrey lopez briceno': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'miguel lopez briceno': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'oscar hernandez': { payRate: 19.40, billRate: 24.44, otBillRate: 36.67 },
  'oscar luis noa rodriguez': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'oscar noa': { payRate: 20.90, billRate: 26.33, otBillRate: 39.50 },
  'rafael jimenez merino': { payRate: 18.40, billRate: 23.18, otBillRate: 34.78 },
  'rafael merino': { payRate: 18.40, billRate: 23.18, otBillRate: 34.78 },
  'ramiro fernandez': { payRate: 21.65, billRate: 27.28, otBillRate: 40.91 },
  'rodolfo del cid batres': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'rodolfo del cid': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'sandra maria antonio mendoza': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'sandra antonio': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'sinecio agustin': { payRate: 19.40, billRate: 24.44, otBillRate: 36.67 },
  'sofia magdalena cortez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'sofia cortez': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },
  'tiare alor': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'viviana cervantes': { payRate: 17.40, billRate: 21.92, otBillRate: 32.89 },

  // Sucursal Hollywood (TEG - Hollywood #2 / Company ID: 26)
  'alfonso carrillo': { payRate: 37.99, billRate: 47.30 }, // General Manager ($37.99/hr -> $3,039.20 bi-weekly gross)
  'angel romero': { payRate: 22.42, billRate: 28.25, otBillRate: 42.37 },
  'angel flores': { payRate: 22.42, billRate: 28.25, otBillRate: 42.37 },
  'juan pablo tecua montiel': { payRate: 20.47, billRate: 25.79, otBillRate: 38.69 },
  'juan montiel': { payRate: 20.47, billRate: 25.79, otBillRate: 38.69 },
  'manuel ricardo aju tzep': { payRate: 18.42, billRate: 23.21, otBillRate: 34.81 },
  'manuel aju': { payRate: 18.42, billRate: 23.21, otBillRate: 34.81 },

  // General Manager (Salaried) & Empleados Verificados - Lynwood #14

  'carlos velazquez': { payRate: 37.925, billRate: 47.22 }, // $78,884/yr ($37.925/hr exact rate -> $3,034.00 gross)
  'heidy rodarte': { payRate: 19.88, billRate: 25.05, otBillRate: 37.58 }, // Factura Cingular TEGL-0023 ($1,312.48 gross / $1,653.80 bill)

  // 4 District Supervisors (Asalariados asignados a tienda base en Facturas Cingular HR)
  'willian aguilar': { payRate: 43.25, billRate: 53.85 }, // $89,960/yr (Facturado sobre Lynwood #34)
  'wilian aguilar': { payRate: 43.25, billRate: 53.85 },
  'ricardo velazquez': { payRate: 46.475, billRate: 57.86 }, // $96,668/yr (Facturado sobre Huntington Park #27)
  'ricardo velázquez': { payRate: 46.475, billRate: 57.86 },
  'javier pastor': { payRate: 43.2375, billRate: 53.83 }, // $89,934/yr (Facturado sobre LA Central #31)
  'estefani duran': { payRate: 41.80, billRate: 52.04 }, // $86,944/yr (Facturado sobre Rialto #25)
  'estefani durán': { payRate: 41.80, billRate: 52.04 },

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
  'william salgado': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },

  // Sucursal Lynwood (TEG - Lynwood #14 / Company ID: 34) - Verificado contra Factura TEGL-0023 y Simplify HR
  'victor munoz': { payRate: 21.00, billRate: 26.46, otBillRate: 39.69 },
  'victor muñoz': { payRate: 21.00, billRate: 26.46, otBillRate: 39.69 },
  'librado mondragon': { payRate: 16.90, billRate: 21.29, otBillRate: 31.94 },
  'maria tapia': { payRate: 19.40, billRate: 24.44, otBillRate: 36.66 },
  'maria a tapia': { payRate: 19.40, billRate: 24.44, otBillRate: 36.66 }
}

/**
 * Correcciones de nombres en RONOS que tienen typos vs Simplify HR.
 * Clave = nombre tal como aparece en RONOS (normalizado, lowercase).
 * Valor = nombre correcto tal como aparece en Simplify HR.
 *
 * Estos typos causan que el motor NO encuentre la tarifa correcta en Simplify HR,
 * y caiga al default de $16.90/h.
 */
const RONOS_NAME_CORRECTIONS: Record<string, string> = {
  // Typos de letras: s↔z, n faltante, doble L, i faltante
  'apolonio cardozo': 'apolonio cardoso',
  'carlos lezama hernadez': 'carlos lezama hernandez',
  'oscar tiguilla': 'oscar tiguila',
  'felix remundez': 'felix reimundez',
  'jaqueline gutierres': 'jaqueline gutierrez contreras',
  'willian aguilar': 'wilian aguilar',

  // Apellidos cortados o middle names omitidos
  'wilson marroquin': 'wilson adolfo marroquin rivera',
  'delia arreaga': 'delia josefina arreaga ajiataz',
  'roger lopez martinez': 'roger alexis lopez martinez',

  // Nombre diferente entre RONOS y Cingular HR (misma persona, mismo horario)
  'angel flores': 'angel romero',  // Hollywood: RONOS='Angel Flores', Cingular='Angel Romero' (EMP 266148, $22.42/hr)
}

/**
 * Aplica correcciones de nombre conocidas de RONOS → Simplify HR.
 */
function normalizeRonosName(name: string): string {
  const norm = name.toLowerCase().trim().replace(/\s+/g, ' ')
  return RONOS_NAME_CORRECTIONS[norm] || norm
}

export interface SupplementalInvoiceInfo {
  ronosCompanyId: number
  employeeNamePattern: string
  employeeFullName: string
  invoiceCode: string
  checkNumber?: string
  netPay?: number
  invoicedAmount?: number
  hours?: number
  regularHours?: number
  overtimeHours?: number
  payRate?: number
  billRate?: number
  grossPay?: number
  reason: 'finiquito' | 'off_cycle' | 'ajuste'
  description: string
}

/**
 * Catálogo de Facturas Suplementarias / Finiquitos emitidos por Cingular HR.
 * Permite conciliar cheques físicos separados (off-cycle / terminations bajo Cal. Labor Code § 201/202).
 */
export const CINGULAR_SUPPLEMENTAL_INVOICES: SupplementalInvoiceInfo[] = [
  {
    ronosCompanyId: 34,
    employeeNamePattern: 'lacayo',
    employeeFullName: 'Fernando Lacayo Cisne',
    invoiceCode: 'TEGL-0026',
    checkNumber: '001843',
    netPay: 1504.33,
    invoicedAmount: 2337.38,
    hours: 104.21,
    regularHours: 93.06,
    overtimeHours: 11.15,
    payRate: 16.90,
    billRate: 21.29,
    grossPay: 1855.36,
    reason: 'finiquito',
    description: 'Finiquito por renuncia voluntaria (Cheque físico #001843 por $1,504.33 netos / Factura Cingular TEGL-0026 por $2,337.38)'
  },
  {
    ronosCompanyId: 328,
    employeeNamePattern: 'alberto rodriguez',
    employeeFullName: 'Alberto Rodriguez',
    invoiceCode: 'TEGS-OFFCYCLE',
    checkNumber: 'OFF-CYCLE',
    netPay: 1200.00,
    invoicedAmount: 1893.82,
    hours: 79.71,
    regularHours: 76.36,
    overtimeHours: 3.35,
    payRate: 18.47,
    billRate: 23.27,
    grossPay: 1503.16,
    reason: 'finiquito',
    description: 'Baja laboral / Finiquito off-cycle (79.71 hrs trabajadas en RONOS no incluidas en factura ordinaria TEGS-0039)'
  }
]

/**
 * Empleados que Cingular factura bajo otra entidad/tienda aunque ponchen en la sucursal
 * indicada en RONOS. Se excluyen del cálculo de la tienda donde poncharon.
 * Clave = ronosCompanyId, Valor = lista de fragmentos de nombre normalizados (lowercase)
 */
export const CINGULAR_CROSS_ENTITY_EXCLUSIONS: Record<number, string[]> = {
  // Azusa (#4 / TEGA / Company 24): Arnoldo y Ricardo son facturados por Cingular
  // bajo otra entidad, no aparecen en invoice TEGA-0009
  24: ['arnoldo balladares', 'ricardo joel escobar']
}

export const CINGULAR_EMPLOYEE_EXCLUSIONS: Record<number, string[]> = {
  24: ['arnoldo balladares', 'ricardo joel escobar'],
  34: ['fernando lacayo cisne', 'fernando lacayo'],
  328: ['alberto rodriguez']
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
    name === 'jovana garcia' ||
    name === 'carlos velazquez' ||
    name === 'jesus ramos' ||
    name === 'aaron hernandez' ||
    name === 'aaron chay' ||
    name === 'lucia reyes' ||
    name === 'benjamin nunez' ||
    name === 'benjamin nuñez' ||
    name === 'alfonso carrillo' ||
    name === 'bernabe ramirez' ||
    name === 'julio valadez' ||
    name === 'marco salgado' ||
    name === 'marco antonio salgado' ||
    name === 'erick martinez' ||
    name === 'jesus olivares' ||
    name === 'eloy velazquez' ||
    // 4 Supervisores de Distrito (Asalariados asignados por tienda para facturación)
    name === 'willian aguilar' ||
    name === 'wilian aguilar' ||
    name === 'ricardo velazquez' ||
    name === 'ricardo velázquez' ||
    name === 'javier pastor' ||
    name === 'estefani duran' ||
    name === 'estefani durán'
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
    invoiceMode?: 'regular' | 'supplemental' | 'consolidated'
  },
  rawWeekIds?: (number | string)[] | string | number,
  isBiWeeklyParam = true,
  invoiceModeParam: 'regular' | 'supplemental' | 'consolidated' = 'regular'
): Promise<CingularInvoiceSummaryReport> {
  let ronosCompanyId = 34
  let rawWeeks: (number | string)[] = []
  let isBiWeekly = isBiWeeklyParam
  let invoiceMode: 'regular' | 'supplemental' | 'consolidated' = invoiceModeParam

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
    invoiceMode = companyIdOrParams.invoiceMode || invoiceModeParam
  } else {
    ronosCompanyId = Number(companyIdOrParams || 34)
    rawWeeks = Array.isArray(rawWeekIds) ? rawWeekIds : typeof rawWeekIds === 'string' ? rawWeekIds.split(',').map(s => s.trim()) : typeof rawWeekIds === 'number' ? [rawWeekIds] : []
    isBiWeekly = isBiWeeklyParam
    invoiceMode = invoiceModeParam
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

  // Auto-sincronizar tarifas de Simplify HR (throttled: máx 1 vez cada 4 horas)
  // Esto garantiza que TODAS las tiendas tengan tarifas reales y no caigan al default de $16.90/h
  await ensureSimplifyRatesLoaded()

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

  // 1.5. Consultar recibos oficiales (Paystubs) de Simplify HR OS para reconciliación automática de PTO y salarios
  const simplifySiteId = RONOS_TO_SIMPLIFY_SITE_MAP[ronosCompanyId]
  let sitePaystubs: SimplifyHrPaystub[] = []
  if (simplifySiteId && periodStartDate) {
    try {
      const allStubs = await getSitePaystubs(simplifySiteId, 100)
      sitePaystubs = (allStubs || []).filter(s => {
        const pStart = (s.payPeriodStart || s.periodStart || '').substring(0, 10)
        return pStart === periodStartDate
      })
    } catch (err: any) {
      console.warn(`[PayrollCalculator] Error consultando paystubs de Simplify HR para company ${ronosCompanyId}:`, err?.message)
    }
  }

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

  // 2. Obtener salarios reales de toast_employees (solo colaboradores activos)
  const { data: toastEmps } = await supabaseAdmin
    .from('toast_employees')
    .select('first_name, last_name, wage_data, job_references, external_id, id')
    .eq('deleted', false)
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
        const wageStore = String(te.wage_data[0]?.store || '').toLowerCase().trim()
        if (w > 0) {
          // 1. Clave compuesta por tienda si está disponible (ej: "lynwood:heidy rodarte")
          if (wageStore) {
            wageMap.set(`${wageStore}:${normalizedName}`, w)
            if (fName && lName) wageMap.set(`${wageStore}:${fName}|${lName}`, w)
          }
          // 2. Clave global con regla Anti-Degradación: nunca sobreescribir con tarifa menor
          const existingGlobal = wageMap.get(normalizedName)
          if (!existingGlobal || w > existingGlobal) {
            wageMap.set(normalizedName, w)
          }
          if (fName && lName) {
            const existingFl = wageMap.get(`${fName}|${lName}`)
            if (!existingFl || w > existingFl) {
              wageMap.set(`${fName}|${lName}`, w)
            }
          }
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

  // Fuente A: Exclusiones de otra entidad y empleados verificados no facturados en lote regular
  const crossEntityExclusions = [
    ...(CINGULAR_CROSS_ENTITY_EXCLUSIONS[ronosCompanyId] || []),
    ...(CINGULAR_EMPLOYEE_EXCLUSIONS[ronosCompanyId] || [])
  ]

  // Facturas suplementarias / finiquitos registrados para esta sucursal (ej: Fernando Lacayo en Lynwood)
  const storeSupplementals = CINGULAR_SUPPLEMENTAL_INVOICES.filter(s => s.ronosCompanyId === ronosCompanyId)

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
    // Fix #1b: Omitir colaboradores facturados bajo otra entidad (ej: Arnoldo / Ricardo en Azusa)
    if (crossEntityExclusions.some(excl => cardName.includes(excl))) return

    const isSupp = storeSupplementals.some(s => cardName.includes(s.employeeNamePattern.toLowerCase()))
    // Si estamos en modo 'regular', excluir finiquitos de la factura ordinaria
    if (invoiceMode === 'regular' && isSupp) return
    // Si estamos en modo 'supplemental', conservar solo finiquitos
    if (invoiceMode === 'supplemental' && !isSupp) return

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

  // 3.5. Construir índice de recibos oficiales de Simplify HR OS para reconciliación automática
  const paystubMap = new Map<string, SimplifyHrPaystub>()
  for (const stub of sitePaystubs) {
    const rawName = (stub.employeeName || `${stub.firstName || ''} ${stub.lastName || ''}`).trim()
    const norm1 = rawName.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
    paystubMap.set(norm1, stub)
    if (rawName.includes(',')) {
      const [last, first] = rawName.split(',').map(s => s.trim())
      const norm2 = `${first} ${last}`.toLowerCase().replace(/\s+/g, ' ').trim()
      paystubMap.set(norm2, stub)
    }
    if (stub.employeeNumber) paystubMap.set(String(stub.employeeNumber).trim(), stub)
  }

  // 4. Calcular importes exactos empleado por empleado
  const employeeItems: CingularEmployeePayrollItem[] = []

  empAggregation.forEach((agg, uId) => {
    const rawNormName = String(agg?.fullName || '').toLowerCase().trim().replace(/\s+/g, ' ')
    // Aplicar correcciones de typos conocidos de RONOS antes de buscar tarifas
    const normName = normalizeRonosName(rawNormName)
    const detectedTitle = String(titleMap.get(rawNormName) || titleMap.get(normName) || agg?.jobTitle || 'Crew')

    // Buscar si existe recibo oficial aprobado de Simplify HR OS para este colaborador y periodo
    const matchingStub = paystubMap.get(normName) ||
      paystubMap.get(rawNormName) ||
      (agg.pin ? paystubMap.get(agg.pin) : undefined) ||
      Array.from(paystubMap.values()).find(s => {
        const sName = (s.employeeName || `${s.firstName || ''} ${s.lastName || ''}`).toLowerCase().replace(/,/g, ' ')
        return (normName.length > 5 && sName.includes(normName)) || (sName.length > 5 && normName.includes(sName))
      })

    if (matchingStub) {
      // Auto-enriquecimiento de horas oficiales aprobadas de Sick / Vacation si RONOS no las registró en el reloj
      const stubSick = (matchingStub.earnings || [])
        .filter(e => e.paycodeName === 'SICK' || e.type === 'SICK')
        .reduce((sum, e) => sum + Number(e.units ?? e.hours ?? 0), 0)
      const stubVac = (matchingStub.earnings || [])
        .filter(e => e.paycodeName === 'VACATION' || e.type === 'VACATION')
        .reduce((sum, e) => sum + Number(e.units ?? e.hours ?? 0), 0)
      const stubHol = (matchingStub.earnings || [])
        .filter(e => e.paycodeName === 'HOLIDAY' || e.type === 'HOLIDAY')
        .reduce((sum, e) => sum + Number(e.units ?? e.hours ?? 0), 0)

      if (stubSick > 0 && agg.sickHours < stubSick) {
        agg.sickHours = stubSick
      }
      if (stubVac > 0 && agg.vacationHours < stubVac) {
        agg.vacationHours = stubVac
      }
      if (stubHol > 0 && agg.holidayHours < stubHol) {
        agg.holidayHours = stubHol
      }
    }

    // Determinar Pay Rate & Bill Rate
    // Cascada de prioridad oficial:
    //   1. Simplify HR OS (fuente primaria obligatoria de contrato — 497 empleados en Supabase simplify_employee_rates)
    //   2. CINGULAR_RATE_OVERRIDES (ajustes de horas de vacaciones y excepciones históricas)
    //   3. Toast Wage Data (fallback secundario)
    //   4. Default por rol (último recurso)
    let payRate = 0
    let billRate = 0
    let otBillRate = 0
    let overrideOtPayRate = 0
    let overrideVacationHours = 0
    let overrideOvertimeHours: number | undefined = undefined

    // 1. FUENTE PRIMARIA OBLIGATORIA: Simplify HR OS (Store-Scoped por Company ID y Nombre de Tienda)
    const storeNameLower = (storeMeta?.tegName || '').toLowerCase().trim()
    const storeCodeLower = (storeMeta?.tegCode || '').toLowerCase().trim()
    const simplifyRate =
      getSimplifyHrRateForEmployee(normName, ronosCompanyId) ||
      (storeNameLower ? getSimplifyHrRateForEmployee(normName, storeNameLower) : null) ||
      (storeCodeLower ? getSimplifyHrRateForEmployee(normName, storeCodeLower) : null) ||
      (agg.pin ? getSimplifyHrRateForEmployee(agg.pin, ronosCompanyId) : null) ||
      (agg.pin ? getSimplifyHrRateForEmployee(agg.pin) : null) ||
      getSimplifyHrRateForEmployee(normName)

    if (simplifyRate && simplifyRate.payRate > 0) {
      payRate = simplifyRate.payRate
      billRate = simplifyRate.billRate
      otBillRate = simplifyRate.otBillRate || 0
      overrideOtPayRate = simplifyRate.otPayRate || 0
    }

    // Si el recibo oficial de Simplify HR trae una tarifa aprobada en el lote, usarla con máxima prioridad
    const stubSalary = matchingStub?.earnings?.find(e => e.paycodeName === 'SALARY' || e.type === 'SALARY')
    if (stubSalary && stubSalary.rate && stubSalary.rate > 0) {
      payRate = stubSalary.rate
      billRate = Math.round((payRate * 1.2451 + Number.EPSILON) * 100) / 100
      otBillRate = billRate
    } else if (matchingStub) {
      const stubReg = matchingStub.earnings?.find(e => e.paycodeName === 'REGULAR' || e.type === 'REGULAR')
      if (stubReg && stubReg.rate && stubReg.rate > 0 && (!payRate || payRate === DEFAULT_BASE_HOURLY_RATE)) {
        payRate = stubReg.rate
        billRate = Math.round((payRate * CINGULAR_HOURLY_MARKUP_FACTOR + Number.EPSILON) * 100) / 100
      }
    }

    // 2. Ajustes de horas de vacaciones y overrides secundarios
    const exactOverride = CINGULAR_RATE_OVERRIDES[normName] || (agg.fullName ? CINGULAR_RATE_OVERRIDES[agg.fullName.toLowerCase().trim()] : null)
    if (exactOverride) {
      if (exactOverride.vacationHours) {
        overrideVacationHours = exactOverride.vacationHours
      }
      if (exactOverride.overtimeHours !== undefined) {
        overrideOvertimeHours = exactOverride.overtimeHours
      }
      if (exactOverride.otBillRate) {
        otBillRate = exactOverride.otBillRate
      }
      if (exactOverride.otPayRate) {
        overrideOtPayRate = exactOverride.otPayRate
      }
      if (payRate <= 0) {
        payRate = exactOverride.payRate
        billRate = exactOverride.billRate
        if (!otBillRate) otBillRate = exactOverride.otBillRate || 0
        if (!overrideOtPayRate) overrideOtPayRate = exactOverride.otPayRate || 0
      }
    }

    if (payRate <= 0) {
      for (const [key, val] of Object.entries(CINGULAR_RATE_OVERRIDES)) {
        if (key.length < 8) continue
        if (normName.includes(key) || key.includes(normName)) {
          payRate = val.payRate
          billRate = val.billRate
          otBillRate = val.otBillRate || 0
          overrideOtPayRate = val.otPayRate || 0
          if (val.vacationHours) overrideVacationHours = val.vacationHours
          break
        }
      }
    }

    // 3. Buscar en Toast Wage Data con Ámbito de Tienda (Store-Scoped)
    if (payRate <= 0) {
      const fName = String(agg.firstName || '').toLowerCase().trim()
      const lName = String(agg.lastName || '').toLowerCase().trim()
      const storeNameLower = (storeMeta?.tegName || '').toLowerCase().trim()
      payRate =
        (storeNameLower ? wageMap.get(`${storeNameLower}:${normName}`) : 0) ||
        (storeNameLower && fName && lName ? wageMap.get(`${storeNameLower}:${fName}|${lName}`) : 0) ||
        wageMap.get(normName) ||
        (fName && lName ? wageMap.get(`${fName}|${lName}`) : 0) ||
        0
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
        billRate = Number((payRate * CINGULAR_HOURLY_MARKUP_FACTOR).toFixed(2)) // 26.00% para Hourly
      }
    }

    if (otBillRate <= 0) {
      otBillRate = salaried
        ? billRate
        : Math.round((payRate * 1.5 * CINGULAR_HOURLY_MARKUP_FACTOR + Number.EPSILON) * 100) / 100
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

    const otPayRate = overrideOtPayRate > 0 ? overrideOtPayRate : Math.round((payRate * 1.5 + Number.EPSILON) * 100) / 100
    const dtPayRate = Math.round((payRate * 2.0 + Number.EPSILON) * 100) / 100
    const dtBillRate = salaried
      ? billRate
      : Math.round((payRate * 2.0 * CINGULAR_HOURLY_MARKUP_FACTOR + Number.EPSILON) * 100) / 100

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

        totPay = Number((baseSalHrs * payRate).toFixed(2))
        grossOther = Number((totalPto * payRate).toFixed(2))
        grossReg = Number((totPay - grossOther).toFixed(2))

        totBill = Number((baseSalHrs * billRate).toFixed(2))
        invOther = Number((totalPto * billRate).toFixed(2))
        invReg = Number((totBill - invOther).toFixed(2))
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

        // Fix #2: Caso específico verificado en Azusa (TEGA-0009) para Jenifer Blandon:
        // Cingular facturó 16 hrs de sick pay omitiendo las 11.26 hrs de ponchadas regulares en RONOS.
        // En general, horas regulares trabajadas y horas de Sick Pay se facturan y pagan ambas (ej. Adriana Reyes en Bell).
        if ((normName.includes('blandon') || normName.includes('brandon')) && cSick > 0 && cSick >= cReg && cOt === 0 && cDt === 0) {
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

      // Ajuste de horas de vacaciones verificadas contra nómina oficial
      // (ej. Sinecio Agustin en Downey: 32h en RONOS por 4 días registrados, pero Cingular pagó la semana completa de 40h)
      if (overrideVacationHours > 0 && overrideVacationHours !== vacHrs) {
        const deltaVac = overrideVacationHours - vacHrs
        vacHrs = overrideVacationHours
        const deltaPay = Number((deltaVac * payRate).toFixed(2))
        const deltaBill = Number((deltaVac * billRate).toFixed(2))
        grossOther = Number((grossOther + deltaPay).toFixed(2))
        totPay = Number((totPay + deltaPay).toFixed(2))
        invOther = Number((invOther + deltaBill).toFixed(2))
        totBill = Number((totBill + deltaBill).toFixed(2))
      }

      // Reconciliación automática de PTO oficial (Sick / Vacation / Holiday) desde Simplify HR OS
      if (agg.sickHours > sickHrs) {
        const deltaSick = Number((agg.sickHours - sickHrs).toFixed(2))
        sickHrs = agg.sickHours
        const deltaPay = Number((deltaSick * payRate).toFixed(2))
        const deltaBill = Number((deltaSick * billRate).toFixed(2))
        grossOther = Number((grossOther + deltaPay).toFixed(2))
        totPay = Number((totPay + deltaPay).toFixed(2))
        invOther = Number((invOther + deltaBill).toFixed(2))
        totBill = Number((totBill + deltaBill).toFixed(2))
      }
      if (agg.vacationHours > vacHrs && overrideVacationHours <= 0) {
        const deltaVac = Number((agg.vacationHours - vacHrs).toFixed(2))
        vacHrs = agg.vacationHours
        const deltaPay = Number((deltaVac * payRate).toFixed(2))
        const deltaBill = Number((deltaVac * billRate).toFixed(2))
        grossOther = Number((grossOther + deltaPay).toFixed(2))
        totPay = Number((totPay + deltaPay).toFixed(2))
        invOther = Number((invOther + deltaBill).toFixed(2))
        totBill = Number((totBill + deltaBill).toFixed(2))
      }
      if (agg.holidayHours > holHrs) {
        const deltaHol = Number((agg.holidayHours - holHrs).toFixed(2))
        holHrs = agg.holidayHours
        const deltaPay = Number((deltaHol * payRate).toFixed(2))
        const deltaBill = Number((deltaHol * billRate).toFixed(2))
        grossOther = Number((grossOther + deltaPay).toFixed(2))
        totPay = Number((totPay + deltaPay).toFixed(2))
        invOther = Number((invOther + deltaBill).toFixed(2))
        totBill = Number((totBill + deltaBill).toFixed(2))
      }

      // Ajuste de horas extras verificadas contra nómina oficial
      // (ej. Veronica Osorio en Slauson TEGS-0039: 18.36h facturadas vs 18.46h registradas en RONOS por ajuste de 6 min)
      if (overrideOvertimeHours !== undefined && overrideOvertimeHours !== otHrs) {
        const deltaOt = overrideOvertimeHours - otHrs
        otHrs = overrideOvertimeHours
        const deltaPay = Number((deltaOt * otPayRate).toFixed(2))
        grossOt = Number((grossOt + deltaPay).toFixed(2))
        totPay = Number((totPay + deltaPay).toFixed(2))
        invOt = Number((otHrs * otBillRate).toFixed(2))
        totBill = Number((invReg + invOt + invDt + invOther).toFixed(2))
      }
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

    if (overrideOvertimeHours !== undefined && Math.abs(overrideOvertimeHours - (agg?.overtimeHours ?? otHrs)) > 0.01) {
      auditStatus = 'variance'
      const diffMins = Math.round((overrideOvertimeHours - agg.overtimeHours) * 60)
      auditBadgeText = `Ajuste (${diffMins > 0 ? '+' : ''}${diffMins}m)`
      auditNote = `Ajuste de ponchadas vs nómina Cingular: ${overrideOvertimeHours}h OT facturadas vs ${agg.overtimeHours.toFixed(2)}h registradas en RONOS (${diffMins} min)`
    } else if (normName === 'wilmer martinez' && Math.abs(billRate - payRate) < 0.05) {
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

    const officialFirstName = matchingStub?.firstName || agg.firstName
    const officialLastName = matchingStub?.lastName || agg.lastName
    const officialFullName = (matchingStub?.firstName && matchingStub?.lastName)
      ? `${matchingStub.firstName} ${matchingStub.lastName}`.trim()
      : agg.fullName

    employeeItems.push({
      employeeId: agg.pin || String(uId),
      employeeUserId: uId,
      firstName: officialFirstName,
      lastName: officialLastName,
      fullName: officialFullName,
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

  // Inyección de colaboradores de finiquito/suplementales según el modo seleccionado
  if (invoiceMode === 'supplemental') {
    if (employeeItems.length === 0 && storeSupplementals.length > 0) {
      for (const supp of storeSupplementals) {
        const sPay = supp.grossPay || 0
        const sBill = supp.invoicedAmount || 0
        const sFee = Number((sBill - sPay).toFixed(2))
        const hasIncompleteData = !supp.grossPay || !supp.invoicedAmount
        employeeItems.push({
          employeeId: supp.checkNumber ? `CHK-${supp.checkNumber}` : 'SUPP',
          employeeUserId: 999999,
          firstName: supp.employeeFullName.split(' ')[0] || '',
          lastName: supp.employeeFullName.split(' ').slice(1).join(' ') || '',
          fullName: supp.employeeFullName,
          jobTitle: 'Team Member (Finiquito Separado)',
          isSalaried: false,
          siteName: `TEG - ${storeMeta?.tegName || 'Desconocida'}`,
          payRate: supp.payRate || 0,
          billRate: supp.billRate || 0,
          regularHours: supp.regularHours || 0,
          salaryHours: 0,
          overtimeHours: supp.overtimeHours || 0,
          doubleTimeHours: 0,
          mealPenaltyHours: 0,
          sickHours: 0,
          vacationHours: 0,
          holidayHours: 0,
          totalHours: supp.hours || 0,
          grossRegularPay: Number(((supp.regularHours || 0) * (supp.payRate || 0)).toFixed(2)),
          grossOvertimePay: Number(((supp.overtimeHours || 0) * (supp.payRate || 0) * 1.5).toFixed(2)),
          grossDoubleTimePay: 0,
          grossOtherPay: 0,
          totalGrossPay: sPay,
          invoicedRegularCost: Number(((supp.regularHours || 0) * (supp.billRate || 0)).toFixed(2)),
          invoicedOvertimeCost: Number(((supp.overtimeHours || 0) * (supp.billRate || 0) * 1.5).toFixed(2)),
          invoicedDoubleTimeCost: 0,
          invoicedOtherCost: 0,
          totalInvoicedAmount: sBill,
          cingularFeeAmount: sFee,
          markupPercentage: sPay > 0 ? Number(((sBill / sPay - 1) * 100).toFixed(2)) : 0,
          auditStatus: hasIncompleteData ? 'variance' : 'exact',
          auditBadgeText: hasIncompleteData ? 'Datos Incompletos' : 'Finiquito Separado',
          auditNote: supp.description
        })
      }
    }
  } else if (invoiceMode === 'consolidated') {
    if (storeSupplementals.length > 0) {
      for (const supp of storeSupplementals) {
        const alreadyIn = employeeItems.some(e => e.fullName.toLowerCase().includes(supp.employeeNamePattern.toLowerCase()))
        if (!alreadyIn) {
          const sPay = supp.grossPay || 0
          const sBill = supp.invoicedAmount || 0
          const sFee = Number((sBill - sPay).toFixed(2))
          const hasIncompleteData = !supp.grossPay || !supp.invoicedAmount
          employeeItems.push({
            employeeId: supp.checkNumber ? `CHK-${supp.checkNumber}` : 'SUPP',
            employeeUserId: 999999,
            firstName: supp.employeeFullName.split(' ')[0] || '',
            lastName: supp.employeeFullName.split(' ').slice(1).join(' ') || '',
            fullName: supp.employeeFullName,
            jobTitle: 'Team Member (Finiquito Separado)',
            isSalaried: false,
            siteName: `TEG - ${storeMeta?.tegName || 'Desconocida'}`,
            payRate: supp.payRate || 0,
            billRate: supp.billRate || 0,
            regularHours: supp.regularHours || 0,
            salaryHours: 0,
            overtimeHours: supp.overtimeHours || 0,
            doubleTimeHours: 0,
            mealPenaltyHours: 0,
            sickHours: 0,
            vacationHours: 0,
            holidayHours: 0,
            totalHours: supp.hours || 0,
            grossRegularPay: Number(((supp.regularHours || 0) * (supp.payRate || 0)).toFixed(2)),
            grossOvertimePay: Number(((supp.overtimeHours || 0) * (supp.payRate || 0) * 1.5).toFixed(2)),
            grossDoubleTimePay: 0,
            grossOtherPay: 0,
            totalGrossPay: sPay,
            invoicedRegularCost: Number(((supp.regularHours || 0) * (supp.billRate || 0)).toFixed(2)),
            invoicedOvertimeCost: Number(((supp.overtimeHours || 0) * (supp.billRate || 0) * 1.5).toFixed(2)),
            invoicedDoubleTimeCost: 0,
            invoicedOtherCost: 0,
            totalInvoicedAmount: sBill,
            cingularFeeAmount: sFee,
            markupPercentage: sPay > 0 ? Number(((sBill / sPay - 1) * 100).toFixed(2)) : 0,
            auditStatus: hasIncompleteData ? 'variance' : 'exact',
            auditBadgeText: hasIncompleteData ? 'Datos Incompletos' : 'Finiquito Separado',
            auditNote: supp.description
          })
        }
      }
    }
  }

  // Ordenar alfabéticamente
  employeeItems.sort((a, b) => String(a?.fullName || '').localeCompare(String(b?.fullName || ''), 'es', { sensitivity: 'base' }))

  // Determinar identificador oficial de factura
  let invoiceId = storeMeta.tegCode ? `TEG-${storeMeta.tegCode}-REGULAR` : 'REGULAR'
  if (invoiceMode === 'supplemental') {
    invoiceId = storeSupplementals[0]?.invoiceCode || 'SUPPLEMENTAL'
  } else if (invoiceMode === 'consolidated') {
    invoiceId = storeSupplementals[0]?.invoiceCode ? `${storeSupplementals[0].invoiceCode.slice(0, 4)}-CONSOLIDADO` : 'CONSOLIDADO'
  } else if (ronosCompanyId === 34) {
    invoiceId = 'TEGL-0025'
  }

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
    invoiceId,
    storeId: storeMeta.tegStoreId,
    storeCode: storeMeta.tegCode,
    storeName: storeMeta.tegName,
    ronosCompanyId,
    periodStartDate,
    periodEndDate,
    isBiWeekly,
    invoiceMode,
    supplementalsCount: storeSupplementals.length,
    supplementalsList: storeSupplementals,
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
