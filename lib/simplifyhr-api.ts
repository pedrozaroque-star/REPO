/**
 * @module lib/simplifyhr-api
 * @description Motor universal de integración y extracción de datos con la API de Simplify HR OS (Cingular HR).
 *   - Autenticación OAuth2 / AWS Cognito con gestión de tokens y caché de sesión en memoria.
 *   - Extracción de empleados activos e inactivos por sucursal (Site) y departamento.
 *   - Extracción completa de compensaciones, salarios por hora (Hourly Rate), salarios anuales (Salary),
 *     tarifas de horas extras (OT Rate), estatus de exención (Exempt/NonExempt) e historial de aumentos.
 *   - Mapeo relacional con las tiendas de Tacos Gavilan y el sistema de reloj checador RONOS.
 *
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día siguiente.
 *   - Toda tarifa por hora (Hourly) menor al salario mínimo de California ($16.00-$20.00 según rol/QSR)
 *     debe ser monitoreada para auditoría de cumplimiento.
 *   - El sistema vincula las sucursales de Tacos Gavilan con los identificadores de Site y Department en Simplify HR.
 *
 * @dataFlow
 *   Simplify HR OS API (prod.simplifyhros.com) -> simplifyhr-api -> Normalización de Compensaciones -> Supabase / Reportes / UI.
 *
 * @notes
 *   - Utiliza credenciales corporativas (Carlos.Velazquez@tacosgavilan.com).
 *   - Token Cognito IdToken con expiración controlada.
 *   - Implementa ejecución en lotes concurrentes (concurrency batching) para optimizar tiempos de extracción.
 */

export interface SimplifyHrAuthSession {
  idToken: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  email: string
  memberId?: string
  siteId?: string
}

export interface SimplifyHrCompensationChange {
  effectiveDate: string
  payRate: number
  paySchedule: string
  payType: 'Hourly' | 'Yearly' | string
  overtimeStatus: 'NonExempt' | 'Exempt' | string
  otPayRate: number | null
  createdByUserEmail?: string
  createdDate?: string
  comment?: string
  status?: string
  changeReason?: string
  approverEmail?: string
  approverComment?: string
}

export interface SimplifyHrJobHistoryEntry {
  effectiveDate: string
  jobPosition: string
  title: string
  employmentStatus: string
  siteId: string
  departmentId?: string
  siteName?: string
  departmentName?: string
  positionId?: string
  positionName?: string
  comment?: string
  createdByUserEmail?: string
  createdDate?: string
}

export interface SimplifyHrDirectDepositInfo {
  bankName: string
  bankAccountType: 'Checking' | 'Savings' | string
  routingNumber: string
  accountNumber: string
  percentage: number
  allocationType: string
  payrollBillingId?: string
}

export interface SimplifyHrEmployeeRecord {
  id: string
  employeeID: string
  assignmentId?: string
  userId: string
  firstName: string
  lastName: string
  fullName: string
  status: 'Active' | 'Inactive' | string
  employmentStatus: 'FullTime' | 'PartTime' | string
  jobPosition: string
  title: string
  siteId: string
  siteName: string
  departmentId: string
  departmentName: string
  positionId?: string
  payRate: number
  payType: 'Hourly' | 'Yearly' | string
  paySchedule: string
  overtimeStatus: 'NonExempt' | 'Exempt' | string
  otPayRate: number | null
  hireDate?: string
  dob?: string
  emailAddress?: string
  notificationEmail?: string
  mobilePhone?: string
  last4ssn?: string
  isRonosSynced?: boolean
  compensationHistory: SimplifyHrCompensationChange[]
  jobHistory: SimplifyHrJobHistoryEntry[]
  directDeposit: SimplifyHrDirectDepositInfo[]
  // Campos nuevos descubiertos en exploración del API
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    zipCode?: string
    display?: string
  }
  ssn?: string // Masked: "XXX-XX-1234"
  createdDate?: string
  modifiedDate?: string
  createdBy?: string // Email de quien creó el registro (ej: "jennifer@cingularhr.com")
  emergencyContact?: Array<{
    name?: string
    relationship?: string
    phoneNumber?: string
    email?: string
  }>
  totalYearlyHours?: Array<{ year?: number; hours?: number }>
  timeOff?: Array<{
    type?: string
    startDate?: string
    endDate?: string
    hours?: number
    status?: string
  }>
  availableTimeOff?: Array<{
    type?: string // 'Unpaid', 'Sick', 'Vacation', etc.
    usedHours?: number
    availableHours?: number
    totalHours?: number
  }>
  noOfPendingTimeOffRequest?: number
  timeOffPolicies?: Array<{ id?: string; name?: string; type?: string }>
  timeOffPoliciesType?: string
  versionKey?: number
}

export interface SimplifyHrSiteInfo {
  id: string
  name: string
  regionName: string
  numEmployees: number
  companyId: string
  companyName: string
  paySchedule: string
  eor?: { id: string; name: string }
  ronosCompanyId?: number
  referenceSiteId?: string
  departments: Array<{ id: string; name: string; description?: string }>
  // Campos nuevos descubiertos en exploración del API
  siteManagers?: Array<{
    firstName: string
    lastName: string
    emailAddress?: string
    workPhoneNumber?: string
    workPhoneExt?: string
  }>
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    zipCode?: string
    display?: string
  }
  phoneNumber?: string
  phoneNumberExt?: string | null
  payPeriodStartDay?: string   // "Monday"
  payPeriodEndDay?: string     // "Sunday"
  payRollStartDate?: string    // ISO date
  standardPayDaylag?: number   // Days lag for pay (e.g. 5)
  parentId?: string
  parentType?: string          // "Region"
  ronosDepartmentMappings?: Array<{
    departmentId: string
    ronosDepartmentId: number
    ronosDepartmentName: string
  }>
  ronosSyncStatus?: string     // "synced"
  ronosLastSyncAttempt?: string
  assignedHrRepId?: string
  assignedSafetyCoordinatorId?: string
  assignedHrProxyIds?: string[]
  timeOffPolicies?: Array<{ id?: string; name?: string; type?: string }>
}

export interface SimplifyHrPaystub {
  id: string
  invoiceId?: string          // ID de la factura de Cingular — permite cruzar con invoices
  invoiceItemId?: string
  batchId?: string
  userId: string
  eorId?: string              // Employer of Record entity ID
  siteId?: string
  assignmentId?: string
  checkDate?: string
  periodStart?: string
  periodEnd?: string
  grossWages?: number         // Salario bruto del periodo
  netPay?: number             // Pago neto (post-tax)
  earnings?: Array<{
    type?: string              // 'Regular', 'Overtime', 'Salary', 'Sick Pay', 'Mileage Non-Tax'
    hours?: number
    rate?: number
    amount?: number
  }>
  employeeTaxes?: Array<{
    type?: string              // 'FIT', 'FICA', 'SIT', 'SDI'
    amount?: number
  }>
  employerTaxes?: Array<{
    type?: string
    amount?: number
  }>
  deductions?: Array<{
    type?: string
    amount?: number
  }>
  ytdGrossWages?: number      // Acumulado anual - Bruto
  ytdNetPay?: number          // Acumulado anual - Neto
  ytdFederalTax?: number
  ytdStateTax?: number
}

/**
 * Obtiene los recibos de nómina (paystubs) de un empleado por su userId.
 * Incluye el invoiceId de Cingular para cruce con facturas.
 */
export async function getEmployeePaystubs(userId: string, limit = 10): Promise<SimplifyHrPaystub[]> {
  try {
    const result = await callSimplifyHrApi<any>('payroll/paystubs', {
      params: { userId, limit }
    })
    // El API retorna { paystubs: [...] } o directamente un array
    const stubs = Array.isArray(result) ? result : (result?.paystubs || [])
    return stubs
  } catch (err: any) {
    console.warn(`No se pudieron obtener paystubs para userId=${userId}: ${err.message}`)
    return []
  }
}

/**
 * Obtiene el detalle completo de un recibo de nómina (paystub) por su ID.
 * Incluye: grossWages, netPay, earnings, taxes, deductions, YTD accumulators.
 */
export async function getPaystubDetail(paystubId: string): Promise<SimplifyHrPaystub | null> {
  try {
    return await callSimplifyHrApi<SimplifyHrPaystub>(`payroll/paystubs/${paystubId}`)
  } catch (err: any) {
    console.warn(`No se pudo obtener detalle del paystub ${paystubId}: ${err.message}`)
    return null
  }
}

// In-Memory Token Cache
let cachedAuthSession: SimplifyHrAuthSession | null = null

const DEFAULT_USER = process.env.SIMPLIFYHR_USER || 'raquel@tacosgavilan.com'
const DEFAULT_PASS = process.env.SIMPLIFYHR_PASS || 'Canasta@323'
const BASE_API = 'https://prod.simplifyhros.com'

/**
 * Autentica contra Simplify HR OS y obtiene el IdToken necesario para las peticiones API
 */
export async function getSimplifyHrAuthToken(forceRefresh = false): Promise<string> {
  const now = Date.now()
  if (!forceRefresh && cachedAuthSession && cachedAuthSession.expiresAt > now + 60000) {
    return cachedAuthSession.idToken
  }

  const username = DEFAULT_USER
  const password = DEFAULT_PASS

  const response = await fetch(`${BASE_API}/user/signIn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.simplifyhros.com',
      'Referer': 'https://www.simplifyhros.com/'
    },
    body: JSON.stringify({
      emailAddress: username,
      password: password
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error en autenticación Simplify HR OS (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const expiresInMs = (data.ExpiresIn || 3600) * 1000

  cachedAuthSession = {
    idToken: data.IdToken,
    accessToken: data.AccessToken,
    refreshToken: data.RefreshToken,
    expiresAt: now + expiresInMs,
    email: username
  }

  return cachedAuthSession.idToken
}

/**
 * Realiza una llamada HTTP autenticada a la API de Simplify HR OS
 */
export async function callSimplifyHrApi<T = any>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    body?: any
    params?: Record<string, any>
  } = {}
): Promise<T> {
  const token = await getSimplifyHrAuthToken()

  let url = endpoint.startsWith('http') ? endpoint : `${BASE_API}/${endpoint.replace(/^\//, '')}`
  if (options.params) {
    const queryParams = new URLSearchParams()
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null) {
        queryParams.append(k, String(v))
      }
    }
    const qs = queryParams.toString()
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs
    }
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Origin': 'https://www.simplifyhros.com',
      'Referer': 'https://www.simplifyhros.com/'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Simplify HR API Error [${response.status}] ${url}: ${errorText}`)
  }

  return response.json()
}

/**
 * Obtiene la información del sitio/sucursal por ID
 */
export async function getSimplifyHrSiteInfo(siteId: string): Promise<SimplifyHrSiteInfo> {
  return callSimplifyHrApi<SimplifyHrSiteInfo>('site/getSiteById', {
    params: { id: siteId }
  })
}

/**
 * Obtiene la lista de empleados de un sitio (activos o inactivos)
 */
export async function getSimplifyHrSiteEmployees(
  siteId: string,
  active = true,
  pageSize = 200
): Promise<any[]> {
  const result = await callSimplifyHrApi<{ employeeModel: any[]; totalEmployees: number }>(
    `employee/getEmployeesBySiteId`,
    {
      method: 'POST',
      params: { siteId },
      body: {
        pageNumber: 1,
        pageSize,
        active
      }
    }
  )
  return result.employeeModel || []
}

/**
 * Obtiene los detalles completos de un empleado por ID (incluyendo salario, aumentos y depósito directo)
 */
export async function getSimplifyHrEmployeeDetails(employeeId: string): Promise<SimplifyHrEmployeeRecord> {
  const raw = await callSimplifyHrApi<any>(`employee/getEmployeeById/${employeeId}`, {
    params: { id: employeeId }
  })

  return {
    id: raw.id,
    employeeID: raw.employeeID || '',
    assignmentId: raw.assignmentId || '',
    userId: raw.userId || '',
    firstName: raw.firstName || '',
    lastName: raw.lastName || '',
    fullName: `${raw.firstName || ''} ${raw.lastName || ''}`.trim(),
    status: raw.status || 'Active',
    employmentStatus: raw.employmentStatus || 'FullTime',
    jobPosition: raw.jobPosition || '',
    title: raw.title || '',
    siteId: raw.siteId || '',
    siteName: raw.jobHistory?.[0]?.siteName || '',
    departmentId: raw.departmentId || '',
    departmentName: raw.jobHistory?.[0]?.departmentName || '',
    positionId: raw.positionId || '',
    payRate: Number(raw.payRate || 0),
    payType: raw.payType || 'Hourly',
    paySchedule: raw.paySchedule || 'Bi-Weekly',
    overtimeStatus: raw.overtimeStatus || 'NonExempt',
    otPayRate: raw.otPayRate ? Number(raw.otPayRate) : null,
    hireDate: raw.hireDate,
    dob: raw.dob,
    emailAddress: raw.emailAddress,
    notificationEmail: raw.notificationEmail,
    mobilePhone: raw.mobilePhone,
    last4ssn: raw.last4ssn,
    isRonosSynced: raw.isRonosSynced ?? true,
    compensationHistory: raw.compensationHistory || [],
    jobHistory: raw.jobHistory || [],
    directDeposit: raw.directDeposit || [],
    // Campos nuevos — dirección, SSN, auditoría, contactos de emergencia, PTO
    address: raw.address || undefined,
    ssn: raw.ssn || undefined,
    createdDate: raw.createdDate || undefined,
    modifiedDate: raw.modifiedDate || undefined,
    createdBy: raw.createdBy || undefined,
    emergencyContact: raw.emergencyContact || [],
    totalYearlyHours: raw.totalYearlyHours || [],
    timeOff: raw.timeOff || [],
    availableTimeOff: raw.availableTimeOff || [],
    noOfPendingTimeOffRequest: raw.noOfPendingTimeOffRequest ?? 0,
    timeOffPolicies: raw.timeOffPolicies || [],
    timeOffPoliciesType: raw.timeOffPoliciesType || undefined,
    versionKey: raw.versionKey ?? undefined
  }
}

/**
 * Extrae todos los salarios y compensaciones de un sitio (activos e inactivos) con procesamiento concurrente en lotes
 */
export async function extractAllSimplifyHrSalaries(
  siteId: string = '657a2e35555bf12601f56284',
  batchConcurrency = 5
): Promise<{
  siteId: string
  totalEmployees: number
  activeCount: number
  inactiveCount: number
  hourlyCount: number
  salaryCount: number
  averageHourlyRate: number
  employees: SimplifyHrEmployeeRecord[]
}> {
  // 1. Obtener empleados activos e inactivos
  const [activeList, inactiveList] = await Promise.all([
    getSimplifyHrSiteEmployees(siteId, true),
    getSimplifyHrSiteEmployees(siteId, false)
  ])

  // Unificar y deduplicar por ID
  const mapById = new Map<string, any>()
  for (const emp of [...activeList, ...inactiveList]) {
    if (emp && emp.id && !mapById.has(emp.id)) {
      mapById.set(emp.id, emp)
    }
  }

  const uniqueList = Array.from(mapById.values())
  const results: SimplifyHrEmployeeRecord[] = []

  // 2. Extraer detalles en lotes concurrentes
  for (let i = 0; i < uniqueList.length; i += batchConcurrency) {
    const batch = uniqueList.slice(i, i + batchConcurrency)
    const batchPromises = batch.map(async emp => {
      try {
        const details = await getSimplifyHrEmployeeDetails(emp.id)
        if (!details.siteName && emp.siteName) details.siteName = emp.siteName
        if (!details.departmentName && emp.departmentName) details.departmentName = emp.departmentName
        return details
      } catch (err: any) {
        console.error(`Error extrayendo datos para empleado ${emp.firstName} ${emp.lastName} (${emp.id}):`, err.message)
        return null
      }
    })

    const batchResults = await Promise.all(batchPromises)
    for (const res of batchResults) {
      if (res) results.push(res)
    }
  }

  // Métricas
  const activeCount = results.filter(e => e.status === 'Active').length
  const inactiveCount = results.filter(e => e.status !== 'Active').length
  const hourlyEmployees = results.filter(e => e.payType === 'Hourly' && e.payRate > 0)
  const salaryEmployees = results.filter(e => e.payType === 'Yearly')
  const avgHourly = hourlyEmployees.length > 0
    ? Number((hourlyEmployees.reduce((acc, curr) => acc + curr.payRate, 0) / hourlyEmployees.length).toFixed(2))
    : 0

  return {
    siteId,
    totalEmployees: results.length,
    activeCount,
    inactiveCount,
    hourlyCount: hourlyEmployees.length,
    salaryCount: salaryEmployees.length,
    averageHourlyRate: avgHourly,
    employees: results.sort((a, b) => a.fullName.localeCompare(b.fullName))
  }
}

/**
 * Mapeo de Company ID de RONOS a Site ID de Simplify HR OS
 */
export const RONOS_TO_SIMPLIFY_SITE_MAP: Record<number, string> = {
  34: '657a2e35555bf12601f56284',  // Lynwood
  26: '657a2e19555bf12601f560f2',  // Hollywood
  29: '657a2e1b555bf12601f5610a',  // Bell
  30: '657a2e1d555bf12601f5611c',  // Broadway
  31: '657a2e1e555bf12601f56132',  // LA Central
  27: '657a2e20555bf12601f5614c',  // Huntington Park (Santa Fe HP en Simplify HR)
  328: '657a2e23555bf12601f5616c', // Slauson
  33: '657a2e26555bf12601f56194',  // South Gate
  290: '657a2e28555bf12601f561ba', // Vernon / La Bodega (Almacén Central)
  24: '657a2e2c555bf12601f561e6',  // Azusa
  32: '657a2e2f555bf12601f5621c',  // Downey
  37: '657a2e32555bf12601f5624e',  // La Puente
  292: '657a2e38555bf12601f562c4', // Norwalk
  25: '657a2e3c555bf12601f5630e',  // Rialto
  35: '657a2e40555bf12601f56352',  // Santa Ana
  36: '657a2e43555bf12601f563a0',  // West Covina
}

// In-Memory Rate Cache para acceso ultra-rápido en tiempo de cálculo
let cachedSimplifyRates: Map<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string }> | null = null
let lastRatesSyncTime = 0

/**
 * Sincroniza y extrae las tarifas de Simplify HR OS para una tienda o todos los sitios disponibles
 */
export async function syncSimplifyHrRates(ronosCompanyId?: number): Promise<{
  success: boolean
  syncedCount: number
  siteId: string
  rates: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string }>
}> {
  try {
    const siteId = (ronosCompanyId && RONOS_TO_SIMPLIFY_SITE_MAP[ronosCompanyId])
      ? RONOS_TO_SIMPLIFY_SITE_MAP[ronosCompanyId]
      : '657a2e35555bf12601f56284'

    const data = await extractAllSimplifyHrSalaries(siteId, 5)
    
    if (!cachedSimplifyRates) {
      cachedSimplifyRates = new Map()
    }

    const ratesObj: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string }> = {}

    for (const emp of data.employees) {
      const normName = emp.fullName.toLowerCase().trim().replace(/\s+/g, ' ')
      const isSalaried = emp.payType === 'Yearly' || emp.payRate > 1000
      const hourlyPay = isSalaried ? Math.round((emp.payRate / 2080) * 100) / 100 : emp.payRate
      const billRate = Math.round(hourlyPay * 1.25976 * 100) / 100

      const rateInfo = {
        payRate: hourlyPay,
        billRate,
        otPayRate: emp.otPayRate,
        isSalaried,
        jobTitle: emp.title || emp.jobPosition || 'Employee'
      }

      cachedSimplifyRates.set(normName, rateInfo)
      if (emp.employeeID) {
        cachedSimplifyRates.set(`id:${emp.employeeID}`, rateInfo)
      }
      ratesObj[normName] = rateInfo
    }

    // Persistir salarios en Supabase (toast_employees y ronos_employee_mappings) en segundo plano
    try {
      const { supabaseAdmin } = await import('./supabase')
      for (const emp of data.employees) {
        const isSalaried = emp.payType === 'Yearly' || emp.payRate > 1000
        const hourlyPay = isSalaried ? Math.round((emp.payRate / 2080) * 100) / 100 : emp.payRate
        const parts = emp.fullName.trim().split(/\s+/)
        const fName = parts[0]
        const lName = parts.slice(1).join(' ')

        // 1. Actualizar en toast_employees
        const { data: existingToast } = await supabaseAdmin
          .from('toast_employees')
          .select('id, first_name, last_name, wage_data')
          .ilike('first_name', `%${fName}%`)
          .ilike('last_name', `%${parts[parts.length - 1]}%`)
          .limit(2)

        if (existingToast && existingToast.length > 0) {
          for (const te of existingToast) {
            const newWageData = [
              {
                wage: hourlyPay,
                job_guid: 'simplify-hr-sync',
                pay_type: emp.payType,
                synced_from: 'simplify_hr',
                synced_at: new Date().toISOString()
              }
            ]
            await supabaseAdmin.from('toast_employees').update({ wage_data: newWageData }).eq('id', te.id)
          }
        }

        // 2. Actualizar en ronos_employee_mappings
        const { data: existingMap } = await supabaseAdmin
          .from('ronos_employee_mappings')
          .select('id, notes')
          .ilike('ronos_full_name', `%${fName}%`)
          .ilike('ronos_full_name', `%${parts[parts.length - 1]}%`)
          .limit(2)

        if (existingMap && existingMap.length > 0) {
          for (const mapRow of existingMap) {
            const notesObj = {
              simplify_pay_rate: hourlyPay,
              simplify_bill_rate: Math.round(hourlyPay * 1.25976 * 100) / 100,
              is_salaried: isSalaried,
              job_title: emp.title || emp.jobPosition || 'Employee',
              synced_at: new Date().toISOString()
            }
            await supabaseAdmin.from('ronos_employee_mappings').update({ notes: JSON.stringify(notesObj) }).eq('id', mapRow.id)
          }
        }
      }
    } catch (dbErr: any) {
      console.warn('Advertencia al persistir salarios en Supabase:', dbErr?.message)
    }

    lastRatesSyncTime = Date.now()

    return {
      success: true,
      syncedCount: data.employees.length,
      siteId,
      rates: ratesObj
    }
  } catch (err: any) {
    console.error('Error sincronizando tarifas de Simplify HR:', err.message)
    return {
      success: false,
      syncedCount: 0,
      siteId: '',
      rates: {}
    }
  }
}

/**
 * Consulta la tarifa en vivo o en caché de Simplify HR para un empleado
 */
export function getSimplifyHrRateForEmployee(nameOrId: string): { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string } | null {
  if (!cachedSimplifyRates) return null
  const key = nameOrId.toLowerCase().trim().replace(/\s+/g, ' ')
  return cachedSimplifyRates.get(key) || cachedSimplifyRates.get(`id:${nameOrId}`) || null
}

/**
 * Sincroniza las tarifas de TODAS las 16 tiendas de Tacos Gavilan desde Simplify HR OS
 * usando las credenciales corporativas de Raquel (shr_hrproxy).
 * Extrae los salarios reales, calcula las tarifas de facturación Cingular, y persiste todo en Supabase.
 * 
 * @returns Resumen de la sincronización con conteos por tienda y totales
 */
export async function syncAllStoresSimplifyHrRates(): Promise<{
  success: boolean
  totalSynced: number
  totalStores: number
  storeResults: Array<{
    ronosCompanyId: number
    storeName: string
    siteId: string
    employeeCount: number
    success: boolean
    error?: string
  }>
  allRates: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string; storeName: string }>
}> {
  const storeResults: Array<{
    ronosCompanyId: number
    storeName: string
    siteId: string
    employeeCount: number
    success: boolean
    error?: string
  }> = []

  const allRates: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string; storeName: string }> = {}

  // Mapeo de RONOS company IDs a nombres legibles
  const STORE_NAMES: Record<number, string> = {
    34: 'Lynwood', 26: 'Hollywood', 29: 'Bell', 30: 'Broadway',
    31: 'LA Central', 27: 'Huntington Park', 328: 'Slauson',
    33: 'South Gate', 290: 'Vernon (Bodega)', 24: 'Azusa',
    32: 'Downey', 37: 'La Puente', 292: 'Norwalk',
    25: 'Rialto', 35: 'Santa Ana', 36: 'West Covina'
  }

   if (!cachedSimplifyRates) {
    cachedSimplifyRates = new Map()
  }

  let totalSynced = 0
  const storeEntries = Object.entries(RONOS_TO_SIMPLIFY_SITE_MAP)

  // Procesar tiendas en paralelo (4 tiendas simultáneas, cada una con 15 llamadas concurrentes)
  const STORE_BATCH_SIZE = 4
  for (let si = 0; si < storeEntries.length; si += STORE_BATCH_SIZE) {
    const storeBatch = storeEntries.slice(si, si + STORE_BATCH_SIZE)

    const batchResults = await Promise.allSettled(
      storeBatch.map(async ([companyIdStr, siteId]) => {
        const companyId = Number(companyIdStr)
        const storeName = STORE_NAMES[companyId] || `Company ${companyId}`

        try {
          console.log(`📡 Extrayendo salarios de ${storeName}...`)
          const data = await extractAllSimplifyHrSalaries(siteId, 15) // 15 llamadas concurrentes por tienda

          for (const emp of data.employees) {
            if (!emp.payRate || emp.payRate <= 0) continue

            const normName = emp.fullName.toLowerCase().trim().replace(/\s+/g, ' ')
            const isSalaried = emp.payType === 'Yearly' || emp.payRate > 1000
            const hourlyPay = isSalaried ? Math.round((emp.payRate / 2080) * 100) / 100 : emp.payRate
            const billRate = Math.round(hourlyPay * 1.25976 * 100) / 100
            const otBillRate = isSalaried ? billRate : Math.round(hourlyPay * 1.5 * 1.25976 * 100) / 100

            const rateInfo = {
              payRate: hourlyPay,
              billRate,
              otPayRate: emp.otPayRate || (isSalaried ? null : hourlyPay * 1.5),
              isSalaried,
              jobTitle: emp.title || emp.jobPosition || 'Employee',
              storeName
            }

            cachedSimplifyRates!.set(normName, rateInfo)
            allRates[normName] = rateInfo
          }

          console.log(`  ✅ ${storeName}: ${data.employees.length} empleados (${data.hourlyCount} hourly, ${data.salaryCount} salaried)`)
          return { ronosCompanyId: companyId, storeName, siteId, employeeCount: data.employees.length, success: true as const }
        } catch (err: any) {
          console.error(`  ❌ Error en ${storeName}: ${err.message}`)
          return { ronosCompanyId: companyId, storeName, siteId, employeeCount: 0, success: false as const, error: err.message }
        }
      })
    )

    // Recolectar resultados del batch
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        storeResults.push(result.value)
        totalSynced += result.value.employeeCount
      } else {
        console.error('Store batch error:', result.reason)
      }
    }
  }

  // Persistir en Supabase — actualizar toast_employees y ronos_employee_mappings
  try {
    const { supabaseAdmin } = await import('./supabase')
    let persistedCount = 0

    for (const [normName, rate] of Object.entries(allRates)) {
      const parts = normName.split(' ')
      const fName = parts[0]
      const lName = parts[parts.length - 1]

      // Buscar en toast_employees por nombre
      const { data: matches } = await supabaseAdmin
        .from('toast_employees')
        .select('id')
        .ilike('first_name', `%${fName}%`)
        .ilike('last_name', `%${lName}%`)
        .limit(3)

      if (matches && matches.length > 0) {
        for (const match of matches) {
          await supabaseAdmin.from('toast_employees').update({
            wage_data: [{
              wage: rate.payRate,
              job_guid: 'simplify-hr-sync',
              pay_type: rate.isSalaried ? 'Yearly' : 'Hourly',
              bill_rate: rate.billRate,
              ot_bill_rate: rate.otPayRate ? Math.round(rate.otPayRate * 1.25976 * 100) / 100 : null,
              synced_from: 'simplify_hr_raquel',
              synced_at: new Date().toISOString(),
              store: rate.storeName
            }]
          }).eq('id', match.id)
          persistedCount++
        }
      }
    }

    console.log(`\n💾 Persistidos ${persistedCount} registros de toast_employees en Supabase`)
  } catch (dbErr: any) {
    console.warn('⚠️ Error persistiendo en Supabase:', dbErr?.message)
  }

  lastRatesSyncTime = Date.now()

  return {
    success: storeResults.every(r => r.success),
    totalSynced,
    totalStores: storeResults.length,
    storeResults,
    allRates
  }
}
