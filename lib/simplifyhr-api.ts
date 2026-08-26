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
}

// In-Memory Token Cache
let cachedAuthSession: SimplifyHrAuthSession | null = null

const DEFAULT_USER = process.env.SIMPLIFYHR_USER || 'Carlos.Velazquez@tacosgavilan.com'
const DEFAULT_PASS = process.env.SIMPLIFYHR_PASS || '100Prechivas.com'
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
    directDeposit: raw.directDeposit || []
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
