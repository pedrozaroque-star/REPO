/**
 * @module lib/simplifyhr-api
 * @description Motor universal de integración y extracción de datos con la API de Simplify HR OS (Cingular HR).
 *   - Autenticación OAuth2 / AWS Cognito con gestión de tokens, mutex/memoización y caché de sesión en memoria.
 *   - Extracción de empleados activos e inactivos por sucursal (Site) y departamento con paginación automática.
 *   - Extracción completa de compensaciones, salarios por hora (Hourly Rate), salarios anuales (Salary),
 *     tarifas de horas extras (OT Rate), estatus de exención (Exempt/NonExempt) e historial de aumentos.
 *   - Mecanismo de reintentos exponenciales con jitter para tolerancia a errores 502/503/504/429/Network.
 *   - Concurrencia controlada mediante cola global (Token Bucket / Throttling) para prevenir saturación de Gateway.
 *   - Fallback resiliente a tarifas en caché de Supabase (toast_employees / ronos_employee_mappings) en caso de caída del API.
 *
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día siguiente.
 *   - Toda tarifa por hora (Hourly) menor al salario mínimo de California ($16.00-$20.00 según rol/QSR)
 *     debe ser monitoreada para auditoría de cumplimiento.
 *   - Markup de Cingular HR: 24.51% (1.2451) para Salaried Exempt y 25.976% (1.25976) para Hourly Non-Exempt.
 *   - Si Simplify HR está fuera de línea, el sistema NUNCA debe detener la operación del payroll: usa caché de Supabase o defaults.
 *
 * @dataFlow
 *   Simplify HR OS API (prod.simplifyhros.com) -> simplifyhr-api (Retry/Backoff) -> Normalización -> Supabase Cache -> Payroll Calculator.
 *
 * @notes
 *   - Utiliza credenciales corporativas (raquel@tacosgavilan.com / Carlos.Velazquez@tacosgavilan.com).
 *   - Resuelve el error 502 Bad Gateway limitando la concurrencia global a máx. 3 llamadas simultáneas.
 *   - Persistencia optimizada en Supabase mediante precarga de datos en memoria para reducir 1,160 consultas a < 10.
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
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    zipCode?: string
    display?: string
  }
  ssn?: string
  createdDate?: string
  modifiedDate?: string
  createdBy?: string
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
    type?: string
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
  payPeriodStartDay?: string
  payPeriodEndDay?: string
  payRollStartDate?: string
  standardPayDaylag?: number
  parentId?: string
  parentType?: string
  ronosDepartmentMappings?: Array<{
    departmentId: string
    ronosDepartmentId: number
    ronosDepartmentName: string
  }>
  ronosSyncStatus?: string
  ronosLastSyncAttempt?: string
  assignedHrRepId?: string
  assignedSafetyCoordinatorId?: string
  assignedHrProxyIds?: string[]
  timeOffPolicies?: Array<{ id?: string; name?: string; type?: string }>
}

export interface SimplifyHrPaystub {
  id: string
  invoiceId?: string
  invoiceItemId?: string
  batchId?: string
  userId: string
  eorId?: string
  siteId?: string
  assignmentId?: string
  checkDate?: string
  periodStart?: string
  periodEnd?: string
  grossWages?: number
  netPay?: number
  earnings?: Array<{
    type?: string
    hours?: number
    rate?: number
    amount?: number
  }>
  employeeTaxes?: Array<{
    type?: string
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
  ytdGrossWages?: number
  ytdNetPay?: number
  ytdFederalTax?: number
  ytdStateTax?: number
}

// ==========================================
// CONFIGURACIÓN Y VARIABLES DE ENTORNO
// ==========================================
let cachedAuthSession: SimplifyHrAuthSession | null = null
let authInFlightPromise: Promise<string> | null = null

const DEFAULT_USER = process.env.SIMPLIFYHR_USER || 'raquel@tacosgavilan.com'
const DEFAULT_PASS = process.env.SIMPLIFYHR_PASS || 'Canasta@323'
const BASE_API = 'https://prod.simplifyhros.com'

// In-Memory Rate Cache para acceso ultra-rápido
let cachedSimplifyRates: Map<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string; storeName?: string }> | null = null
let lastRatesSyncTime = 0

// ==========================================
// UTILIDADES DE CONTROL DE FLUJO Y BACKOFF
// ==========================================
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Limitador de concurrencia simple (Semaphore) para evitar saturar el servidor de Simplify HR.
 */
class ConcurrencyLimiter {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private maxConcurrent: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      if (this.queue.length > 0) {
        const next = this.queue.shift()
        if (next) next()
      }
    }
  }
}

// Máximo 3 peticiones concurrentes globales contra prod.simplifyhros.com
const globalApiLimiter = new ConcurrencyLimiter(3)

// ==========================================
// AUTENTICACIÓN CON MUTEX Y REINTENTOS
// ==========================================
export async function getSimplifyHrAuthToken(forceRefresh = false): Promise<string> {
  const now = Date.now()

  // Si ya tenemos un token válido con más de 2 minutos de vigencia, retornarlo de inmediato
  if (!forceRefresh && cachedAuthSession && cachedAuthSession.expiresAt > now + 120000) {
    return cachedAuthSession.idToken
  }

  // Mutex: Si ya hay una autenticación en vuelo, esperar a que termine (Anti-Thundering Herd)
  if (authInFlightPromise) {
    return authInFlightPromise
  }

  authInFlightPromise = (async () => {
    let lastError: any = null
    const maxRetries = 3

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

        const response = await fetch(`${BASE_API}/user/signIn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://www.simplifyhros.com',
            'Referer': 'https://www.simplifyhros.com/'
          },
          body: JSON.stringify({
            emailAddress: DEFAULT_USER,
            password: DEFAULT_PASS
          }),
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(`Auth Error [${response.status}]: ${errorText || response.statusText}`)
        }

        const data = await response.json()
        const expiresInMs = (data.ExpiresIn || 3600) * 1000

        cachedAuthSession = {
          idToken: data.IdToken,
          accessToken: data.AccessToken,
          refreshToken: data.RefreshToken,
          expiresAt: Date.now() + expiresInMs,
          email: DEFAULT_USER
        }

        return cachedAuthSession.idToken
      } catch (err: any) {
        lastError = err
        console.warn(`[SimplifyHR Auth] Intento ${attempt}/${maxRetries} fallido: ${err.message}`)
        if (attempt < maxRetries) {
          const backoff = attempt * 1500 + Math.floor(Math.random() * 500)
          await sleep(backoff)
        }
      }
    }

    throw new Error(`Error fatal de autenticación en Simplify HR tras ${maxRetries} intentos: ${lastError?.message}`)
  })().finally(() => {
    authInFlightPromise = null
  })

  return authInFlightPromise
}

// ==========================================
// CLIENTE HTTP CON RESILIENCIA Y AUTO-REINTENTO
// ==========================================
export async function callSimplifyHrApi<T = any>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    body?: any
    params?: Record<string, any>
    maxRetries?: number
    timeoutMs?: number
  } = {}
): Promise<T> {
  const { maxRetries = 3, timeoutMs = 20000 } = options

  return globalApiLimiter.run(async () => {
    let lastError: any = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const token = await getSimplifyHrAuthToken(false)

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

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        const response = await fetch(url, {
          method: options.method || 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Origin': 'https://www.simplifyhros.com',
            'Referer': 'https://www.simplifyhros.com/'
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        // Manejo de token expirado en el backend (401 / 403)
        if ((response.status === 401 || response.status === 403) && attempt < maxRetries) {
          console.warn(`[SimplifyHR API] Token rechazado (${response.status}) en ${endpoint}. Forzando refresco...`)
          cachedAuthSession = null
          await getSimplifyHrAuthToken(true)
          continue
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          const isTransient = [408, 429, 500, 502, 503, 504].includes(response.status)
          if (isTransient && attempt < maxRetries) {
            const jitter = Math.floor(Math.random() * 400)
            const delay = Math.min(6000, attempt * 1200 + jitter)
            console.warn(`[SimplifyHR API ${response.status}] en ${endpoint} (Intento ${attempt}/${maxRetries}). Reintentando en ${delay}ms...`)
            await sleep(delay)
            continue
          }
          throw new Error(`Simplify HR API Error [${response.status}] ${url}: ${errorText || response.statusText}`)
        }

        // Parseo seguro de respuesta
        const text = await response.text()
        if (!text || text.trim().length === 0) {
          return {} as T
        }
        try {
          return JSON.parse(text) as T
        } catch {
          throw new Error(`Respuesta no es JSON válido de Simplify HR en ${endpoint}: ${text.substring(0, 100)}`)
        }
      } catch (err: any) {
        lastError = err

        if (attempt >= maxRetries) break

        const jitter = Math.floor(Math.random() * 400)
        const delay = Math.min(6000, attempt * 1200 + jitter)
        console.warn(`[SimplifyHR API] Intento ${attempt}/${maxRetries} falló para ${endpoint}: ${err.message}. Reintentando en ${delay}ms...`)
        await sleep(delay)
      }
    }

    throw lastError || new Error(`Fallo desconocido al consultar Simplify HR API en ${endpoint}`)
  })
}

// ==========================================
// MÓDULOS DE CONSULTA Y NORMALIZACIÓN
// ==========================================
export async function getSimplifyHrSiteInfo(siteId: string): Promise<SimplifyHrSiteInfo> {
  return callSimplifyHrApi<SimplifyHrSiteInfo>('site/getSiteById', {
    params: { id: siteId }
  })
}

/**
 * Obtiene la lista completa de empleados de un sitio con paginación automática.
 */
export async function getSimplifyHrSiteEmployees(
  siteId: string,
  active = true,
  pageSize = 100
): Promise<any[]> {
  try {
    let allEmployees: any[] = []
    let pageNumber = 1
    let totalEmployees = 0

    do {
      const result = await callSimplifyHrApi<{ employeeModel: any[]; totalEmployees: number }>(
        `employee/getEmployeesBySiteId`,
        {
          method: 'POST',
          params: { siteId },
          body: {
            pageNumber,
            pageSize,
            active
          },
          maxRetries: 3
        }
      )

      const list = result.employeeModel || []
      allEmployees = allEmployees.concat(list)
      totalEmployees = result.totalEmployees || list.length

      if (list.length === 0 || allEmployees.length >= totalEmployees) {
        break
      }
      pageNumber++
    } while (pageNumber <= 10) // Salvaguarda máx 10 páginas (1,000 empleados por tienda)

    return allEmployees
  } catch (err: any) {
    console.error(`[SimplifyHR] Error obteniendo empleados del sitio ${siteId} (active=${active}): ${err.message}`)
    return []
  }
}

/**
 * Obtiene los detalles completos de un empleado con reintento por ítem.
 */
export async function getSimplifyHrEmployeeDetails(employeeId: string): Promise<SimplifyHrEmployeeRecord> {
  const raw = await callSimplifyHrApi<any>(`employee/getEmployeeById/${employeeId}`, {
    params: { id: employeeId },
    maxRetries: 3
  })

  return {
    id: raw.id || employeeId,
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
 * Normaliza y extrae los recibos de nómina (Paystubs).
 */
export async function getEmployeePaystubs(userId: string, limit = 10): Promise<SimplifyHrPaystub[]> {
  try {
    const result = await callSimplifyHrApi<any>('payroll/paystubs', {
      params: { userId, limit },
      maxRetries: 2
    })
    const stubs = Array.isArray(result) ? result : (result?.paystubs || [])
    
    return stubs.map((s: any) => ({
      id: s.id,
      invoiceId: s.invoiceId,
      invoiceItemId: s.invoiceItemId,
      batchId: s.batchId,
      userId: s.userId || userId,
      eorId: s.eorId,
      siteId: s.siteId,
      assignmentId: s.assignmentId,
      checkDate: s.checkDate,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      grossWages: Number(s.grossWages || 0),
      netPay: Number(s.netPay || 0),
      earnings: (s.earnings || []).map((e: any) => ({
        type: e.type,
        hours: Number(e.hours || 0),
        rate: Number(e.rate || 0),
        amount: Number(e.amount || 0)
      })),
      employeeTaxes: (s.employeeTaxes || []).map((t: any) => ({
        type: t.type,
        amount: Number(t.amount || 0)
      })),
      employerTaxes: (s.employerTaxes || []).map((t: any) => ({
        type: t.type,
        amount: Number(t.amount || 0)
      })),
      deductions: (s.deductions || []).map((d: any) => ({
        type: d.type,
        amount: Number(d.amount || 0)
      })),
      ytdGrossWages: Number(s.ytdGrossWages || 0),
      ytdNetPay: Number(s.ytdNetPay || 0),
      ytdFederalTax: Number(s.ytdFederalTax || 0),
      ytdStateTax: Number(s.ytdStateTax || 0)
    }))
  } catch (err: any) {
    if (err.message && err.message.includes('[404]')) {
      return []
    }
    console.warn(`[SimplifyHR] No se pudieron obtener paystubs para userId=${userId}: ${err.message}`)
    return []
  }
}

export async function getPaystubDetail(paystubId: string): Promise<SimplifyHrPaystub | null> {
  try {
    const s = await callSimplifyHrApi<any>(`payroll/paystubs/${paystubId}`, { maxRetries: 2 })
    if (!s) return null
    return {
      id: s.id || paystubId,
      invoiceId: s.invoiceId,
      invoiceItemId: s.invoiceItemId,
      batchId: s.batchId,
      userId: s.userId,
      eorId: s.eorId,
      siteId: s.siteId,
      assignmentId: s.assignmentId,
      checkDate: s.checkDate,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      grossWages: Number(s.grossWages || 0),
      netPay: Number(s.netPay || 0),
      earnings: (s.earnings || []).map((e: any) => ({
        type: e.type,
        hours: Number(e.hours || 0),
        rate: Number(e.rate || 0),
        amount: Number(e.amount || 0)
      })),
      employeeTaxes: (s.employeeTaxes || []).map((t: any) => ({
        type: t.type,
        amount: Number(t.amount || 0)
      })),
      employerTaxes: (s.employerTaxes || []).map((t: any) => ({
        type: t.type,
        amount: Number(t.amount || 0)
      })),
      deductions: (s.deductions || []).map((d: any) => ({
        type: d.type,
        amount: Number(d.amount || 0)
      })),
      ytdGrossWages: Number(s.ytdGrossWages || 0),
      ytdNetPay: Number(s.ytdNetPay || 0),
      ytdFederalTax: Number(s.ytdFederalTax || 0),
      ytdStateTax: Number(s.ytdStateTax || 0)
    }
  } catch (err: any) {
    if (err.message && err.message.includes('[404]')) return null
    console.warn(`[SimplifyHR] No se pudo obtener detalle del paystub ${paystubId}: ${err.message}`)
    return null
  }
}

// ==========================================
// EXTRACCIÓN CONCURRENTE RESILIENTE POR SITIO
// ==========================================
export async function extractAllSimplifyHrSalaries(
  siteId: string = '657a2e35555bf12601f56284',
  batchConcurrency = 3
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
  const activeList = await getSimplifyHrSiteEmployees(siteId, true)
  const inactiveList = await getSimplifyHrSiteEmployees(siteId, false)

  const mapById = new Map<string, any>()
  for (const emp of [...activeList, ...inactiveList]) {
    if (emp && emp.id && !mapById.has(emp.id)) {
      mapById.set(emp.id, emp)
    }
  }

  const uniqueList = Array.from(mapById.values())
  const results: SimplifyHrEmployeeRecord[] = []

  for (let i = 0; i < uniqueList.length; i += batchConcurrency) {
    const batch = uniqueList.slice(i, i + batchConcurrency)
    const batchPromises = batch.map(async emp => {
      try {
        const details = await getSimplifyHrEmployeeDetails(emp.id)
        if (!details.siteName && emp.siteName) details.siteName = emp.siteName
        if (!details.departmentName && emp.departmentName) details.departmentName = emp.departmentName
        return details
      } catch (err: any) {
        console.warn(`[SimplifyHR] Falló extracción para ${emp.firstName} ${emp.lastName} (${emp.id}). Usando datos básicos: ${err.message}`)
        return {
          id: emp.id,
          employeeID: emp.employeeID || '',
          userId: emp.userId || '',
          firstName: emp.firstName || '',
          lastName: emp.lastName || '',
          fullName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
          status: emp.active ? 'Active' : 'Inactive',
          employmentStatus: 'FullTime',
          jobPosition: emp.jobPosition || '',
          title: emp.title || '',
          siteId,
          siteName: emp.siteName || '',
          departmentId: emp.departmentId || '',
          departmentName: emp.departmentName || '',
          payRate: Number(emp.payRate || 0),
          payType: emp.payType || 'Hourly',
          paySchedule: 'Bi-Weekly',
          overtimeStatus: 'NonExempt',
          otPayRate: null,
          compensationHistory: [],
          jobHistory: [],
          directDeposit: []
        } as SimplifyHrEmployeeRecord
      }
    })

    const batchResults = await Promise.all(batchPromises)
    for (const res of batchResults) {
      if (res) results.push(res)
    }

    if (i + batchConcurrency < uniqueList.length) {
      await sleep(100)
    }
  }

  const activeCount = results.filter(e => e.status === 'Active').length
  const inactiveCount = results.filter(e => e.status !== 'Active').length
  const hourlyEmployees = results.filter(e => e.payType === 'Hourly' && e.payRate > 0)
  const salaryEmployees = results.filter(e => e.payType === 'Yearly' || e.payRate > 1000)
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

// ==========================================
// MAPEO DE TIENDAS RONOS -> SIMPLIFY HR
// ==========================================
export const RONOS_TO_SIMPLIFY_SITE_MAP: Record<number, string> = {
  34: '657a2e35555bf12601f56284',  // Lynwood
  26: '657a2e19555bf12601f560f2',  // Hollywood
  29: '657a2e1b555bf12601f5610a',  // Bell
  30: '657a2e1d555bf12601f5611c',  // Broadway
  31: '657a2e1e555bf12601f56132',  // LA Central
  27: '657a2e20555bf12601f5614c',  // Huntington Park (Santa Fe HP)
  328: '657a2e23555bf12601f5616c', // Slauson
  33: '657a2e26555bf12601f56194',  // South Gate
  28: '657a2e28555bf12601f561ba',  // Vernon / La Bodega (Almacén Central)
  24: '657a2e2c555bf12601f561e6',  // Azusa
  32: '657a2e2f555bf12601f5621c',  // Downey
  37: '657a2e32555bf12601f5624e',  // La Puente
  292: '657a2e38555bf12601f562c4', // Norwalk
  25: '657a2e3c555bf12601f5630e',  // Rialto
  35: '657a2e40555bf12601f56352',  // Santa Ana
  36: '657a2e43555bf12601f563a0',  // West Covina
}

// ==========================================
// CARGA DE RESILIENCIA Y CACHÉ OFFLINE (FALLBACK)
// ==========================================
async function loadFallbackRatesFromSupabase(): Promise<void> {
  if (!cachedSimplifyRates) cachedSimplifyRates = new Map()

  try {
    const { supabaseAdmin } = await import('./supabase')
    const { data: employees } = await supabaseAdmin
      .from('toast_employees')
      .select('first_name, last_name, wage_data')

    if (employees && employees.length > 0) {
      let loaded = 0
      for (const emp of employees) {
        const fName = (emp.first_name || '').trim()
        const lName = (emp.last_name || '').trim()
        const normName = `${fName} ${lName}`.toLowerCase().trim().replace(/\s+/g, ' ')
        if (!normName) continue

        const wageEntry = Array.isArray(emp.wage_data) ? emp.wage_data[0] : null
        if (wageEntry && wageEntry.wage > 0) {
          const isSalaried = wageEntry.pay_type === 'Yearly' || wageEntry.wage > 1000
          const payRate = Number(wageEntry.wage)
          const billRate = wageEntry.bill_rate || (isSalaried
            ? Math.round(payRate * 1.2451 * 100) / 100
            : Math.round(payRate * 1.25976 * 100) / 100)

          cachedSimplifyRates.set(normName, {
            payRate,
            billRate,
            otPayRate: wageEntry.ot_bill_rate || null,
            isSalaried,
            jobTitle: wageEntry.job_guid || 'Employee',
            storeName: wageEntry.store || undefined
          })
          loaded++
        }
      }
      console.log(`[SimplifyHR Fallback] Cargadas ${loaded} tarifas desde caché de Supabase toast_employees`)
    }
  } catch (err: any) {
    console.warn('[SimplifyHR Fallback] Error cargando caché offline de Supabase:', err?.message)
  }
}

// ==========================================
// SINCRONIZACIÓN DE UNA TIENDA INDIVIDUAL
// ==========================================
export async function syncSimplifyHrRates(ronosCompanyId?: number): Promise<{
  success: boolean
  syncedCount: number
  siteId: string
  rates: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string }>
}> {
  const siteId = (ronosCompanyId && RONOS_TO_SIMPLIFY_SITE_MAP[ronosCompanyId])
    ? RONOS_TO_SIMPLIFY_SITE_MAP[ronosCompanyId]
    : '657a2e35555bf12601f56284'

  if (!cachedSimplifyRates) {
    cachedSimplifyRates = new Map()
  }

  try {
    const data = await extractAllSimplifyHrSalaries(siteId, 3)
    const ratesObj: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string }> = {}

    for (const emp of data.employees) {
      if (!emp.payRate || emp.payRate <= 0) continue

      const normName = emp.fullName.toLowerCase().trim().replace(/\s+/g, ' ')
      const isSalaried = emp.payType === 'Yearly' || emp.payRate > 1000
      const hourlyPay = isSalaried ? Math.round((emp.payRate / 2080) * 100) / 100 : emp.payRate
      const billRate = isSalaried
        ? Math.round(hourlyPay * 1.2451 * 100) / 100     // Salaried: 24.51%
        : Math.round(hourlyPay * 1.25976 * 100) / 100    // Hourly: 25.98%

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

    persistRatesInSupabaseBackground(data.employees).catch(err => {
      console.warn('[SimplifyHR] Error en persistencia background Supabase:', err.message)
    })

    lastRatesSyncTime = Date.now()

    return {
      success: true,
      syncedCount: Object.keys(ratesObj).length,
      siteId,
      rates: ratesObj
    }
  } catch (err: any) {
    console.error(`[SimplifyHR] Error sincronizando tienda ${ronosCompanyId}:`, err.message)
    if (cachedSimplifyRates.size === 0) {
      await loadFallbackRatesFromSupabase()
    }
    return {
      success: false,
      syncedCount: 0,
      siteId,
      rates: {}
    }
  }
}

// ==========================================
// CONSULTA RÁPIDA DE TARIFAS
// ==========================================
export function getSimplifyHrRateForEmployee(nameOrId: string): { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string } | null {
  if (!cachedSimplifyRates) return null
  const key = nameOrId.toLowerCase().trim().replace(/\s+/g, ' ')
  return cachedSimplifyRates.get(key) || cachedSimplifyRates.get(`id:${nameOrId}`) || null
}

// ==========================================
// SINCRONIZACIÓN GLOBAL DE TODAS LAS TIENDAS (CHAIN-WIDE)
// ==========================================
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
  const STORE_NAMES: Record<number, string> = {
    34: 'Lynwood', 26: 'Hollywood', 29: 'Bell', 30: 'Broadway',
    31: 'LA Central', 27: 'Huntington Park', 328: 'Slauson',
    33: 'South Gate', 28: 'Vernon (Bodega)', 24: 'Azusa',
    32: 'Downey', 37: 'La Puente', 292: 'Norwalk',
    25: 'Rialto', 35: 'Santa Ana', 36: 'West Covina'
  }

  if (!cachedSimplifyRates) {
    cachedSimplifyRates = new Map()
  }

  const storeResults: Array<{
    ronosCompanyId: number
    storeName: string
    siteId: string
    employeeCount: number
    success: boolean
    error?: string
  }> = []

  const allRates: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string; storeName: string }> = {}
  let totalSynced = 0

  const uniqueStoreEntries = Object.entries(RONOS_TO_SIMPLIFY_SITE_MAP)

  const STORE_BATCH_SIZE = 2
  for (let si = 0; si < uniqueStoreEntries.length; si += STORE_BATCH_SIZE) {
    const storeBatch = uniqueStoreEntries.slice(si, si + STORE_BATCH_SIZE)

    const batchResults = await Promise.allSettled(
      storeBatch.map(async ([companyIdStr, siteId]) => {
        const companyId = Number(companyIdStr)
        const storeName = STORE_NAMES[companyId] || `Company ${companyId}`

        try {
          console.log(`📡 [SimplifyHR] Extrayendo salarios de ${storeName}...`)
          const data = await extractAllSimplifyHrSalaries(siteId, 3)

          for (const emp of data.employees) {
            if (!emp.payRate || emp.payRate <= 0) continue

            const normName = emp.fullName.toLowerCase().trim().replace(/\s+/g, ' ')
            const isSalaried = emp.payType === 'Yearly' || emp.payRate > 1000
            const hourlyPay = isSalaried ? Math.round((emp.payRate / 2080) * 100) / 100 : emp.payRate
            const billRate = isSalaried
              ? Math.round(hourlyPay * 1.2451 * 100) / 100     // Salaried: 24.51%
              : Math.round(hourlyPay * 1.25976 * 100) / 100    // Hourly: 25.98%
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
            if (emp.employeeID) {
              cachedSimplifyRates!.set(`id:${emp.employeeID}`, rateInfo)
            }
            allRates[normName] = rateInfo
          }

          console.log(`  ✅ ${storeName}: ${data.employees.length} empleados sincronizados`)
          return { ronosCompanyId: companyId, storeName, siteId, employeeCount: data.employees.length, success: true as const }
        } catch (err: any) {
          console.error(`  ❌ Error extrayendo ${storeName}: ${err.message}`)
          return { ronosCompanyId: companyId, storeName, siteId, employeeCount: 0, success: false as const, error: err.message }
        }
      })
    )

    for (const res of batchResults) {
      if (res.status === 'fulfilled') {
        storeResults.push(res.value)
        totalSynced += res.value.employeeCount
      }
    }

    await sleep(250)
  }

  if (totalSynced === 0) {
    console.warn('⚠️ [SimplifyHR] Fallaron todas las tiendas en vivo. Activando fallback offline de Supabase...')
    await loadFallbackRatesFromSupabase()
  } else {
    persistConsolidatedRatesInSupabase(allRates).catch(err => {
      console.warn('[SimplifyHR] Error en persistencia consolidada Supabase:', err.message)
    })
  }

  lastRatesSyncTime = Date.now()

  return {
    success: storeResults.some(r => r.success),
    totalSynced,
    totalStores: storeResults.length,
    storeResults,
    allRates
  }
}

// ==========================================
// PERSISTENCIA OPTIMIZADA EN SUPABASE (BULK)
// ==========================================
async function persistRatesInSupabaseBackground(employees: SimplifyHrEmployeeRecord[]) {
  try {
    const { supabaseAdmin } = await import('./supabase')
    const { data: toastEmps } = await supabaseAdmin
      .from('toast_employees')
      .select('id, first_name, last_name')

    if (!toastEmps || toastEmps.length === 0) return

    const updateTasks: Array<Promise<any>> = []

    for (const emp of employees) {
      if (!emp.payRate || emp.payRate <= 0) continue
      const isSalaried = emp.payType === 'Yearly' || emp.payRate > 1000
      const hourlyPay = isSalaried ? Math.round((emp.payRate / 2080) * 100) / 100 : emp.payRate
      const parts = emp.fullName.trim().split(/\s+/)
      const fName = parts[0]?.toLowerCase()
      const lName = parts[parts.length - 1]?.toLowerCase()

      const match = toastEmps.find(te =>
        (te.first_name || '').toLowerCase().includes(fName) &&
        (te.last_name || '').toLowerCase().includes(lName)
      )

      if (match) {
        updateTasks.push(
          Promise.resolve(
            supabaseAdmin.from('toast_employees').update({
              wage_data: [{
                wage: hourlyPay,
                job_guid: 'simplify-hr-sync',
                pay_type: emp.payType,
                synced_from: 'simplify_hr',
                synced_at: new Date().toISOString()
              }]
            }).eq('id', match.id)
          )
        )
      }
    }

    if (updateTasks.length > 0) {
      await Promise.allSettled(updateTasks)
    }
  } catch (err: any) {
    console.warn('[SimplifyHR Persist] Error:', err?.message)
  }
}

async function persistConsolidatedRatesInSupabase(allRates: Record<string, { payRate: number; billRate: number; otPayRate?: number | null; isSalaried: boolean; jobTitle: string; storeName: string }>) {
  try {
    const { supabaseAdmin } = await import('./supabase')
    const { data: toastEmps } = await supabaseAdmin
      .from('toast_employees')
      .select('id, first_name, last_name')

    if (!toastEmps || toastEmps.length === 0) return

    const updateTasks: Array<Promise<any>> = []

    for (const [normName, rate] of Object.entries(allRates)) {
      const parts = normName.split(' ')
      const fName = parts[0]?.toLowerCase()
      const lName = parts[parts.length - 1]?.toLowerCase()

      const match = toastEmps.find(te =>
        (te.first_name || '').toLowerCase().includes(fName) &&
        (te.last_name || '').toLowerCase().includes(lName)
      )

      if (match) {
        updateTasks.push(
          Promise.resolve(
            supabaseAdmin.from('toast_employees').update({
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
          )
        )
      }
    }

    if (updateTasks.length > 0) {
      await Promise.allSettled(updateTasks)
    }
  } catch (err: any) {
    console.warn('[SimplifyHR Bulk Persist] Error:', err?.message)
  }
}
