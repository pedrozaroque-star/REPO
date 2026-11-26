/**
 * @module lib/employee-wage-auditor
 * @description Motor automatizado de auditoría semanal en vivo de salarios por hora entre
 * Simplify HR OS (Cingular HR — fuente oficial de nómina) y Toast POS (`/labor/v1/employees` + `/labor/v1/jobs` + `punches`),
 * con despacho automático de alertas de corrección a cada Gerente de Tienda involucrado (`To`), copia a su Supervisor de Zona (`CC`),
 * y Resumen Ejecutivo Semanal Consolidado a Dirección Operativa (`carlos@tacosgavilan.com`).
 *
 * @businessRules
 * 1. Lectura 100% En Vivo (Prohibido usar cachés contaminados):
 *    - `toast_employees.wage_data` en Supabase es sobrescrita periódicamente por sincronizaciones de Simplify HR,
 *      y `simplify_employee_rates` conserva bajas históricas sin correos. Por ello, este motor consulta SIEMPRE en vivo:
 *      a) Simplify HR OS (`extractAllSimplifyHrSalaries(siteId, 6, false)`) por cada una de las 15 sucursales activas.
 *      b) Toast POS Labor API (`GET /labor/v1/jobs` y `GET /labor/v1/employees?pageSize=500`) con `Toast-Restaurant-External-ID`.
 *      c) Ponchadas reales de los últimos 30 días en Supabase (`punches`) para identificar qué puesto(s) trabaja realmente cada empleado.
 * 2. Exclusión Estricta de Asalariados y Cuentas de Sistema:
 *    - Excluye empleados asalariados/exentos en Simplify HR (`payType === 'Yearly'`, `overtimeStatus === 'Exempt'`, `payRate <= 0` o `payRate > 200`).
 *    - Excluye puestos `SALARY` (`wageFrequency === 'SALARY'` / `Super User`) y cuentas bot en Toast POS (`@toasttab.com`, `@tryotter.com`, `Kiosk`, `Online Ordering`, `TDS Driver`, etc.).
 * 3. Cascada de Cruce de Identidad 1-a-1 por Sucursal + Salvaguarda Multi-Tienda:
 *    - Paso 1: Correo en Toast (`email`) ↔ `notificationEmail` o `emailAddress` de Simplify HR.
 *    - Paso 2: Nombre completo normalizado exacto (`firstName + lastName` / `chosenName + lastName`) y contención única de tokens compuestos (`Chris Garcia` ↔ `Chris Elian Garcia morales`).
 *    - Paso 3: Mapeo confirmado en `ronos_employee_mappings`.
 *    - Paso 4: Coincidencia difusa por tokens (`Levenshtein <= 2` en apellido con mismo primer nombre dentro de la misma tienda).
 *    - Salvaguarda Multi-Tienda: Empleados activos con ponchadas en los últimos 30 días prestados desde otra sucursal de Simplify HR.
 * 4. Evaluación Exacta de Tarifa por Puesto Horario (`HOURLY`):
 *    - Tarifa efectiva en Toast por puesto: `effectiveToastWage = overrideWage ?? job.defaultWage ?? null` (respetando `defaultWage` configurados en tiendas como LA Central, Azusa, Slauson, Downey).
 *    - Clasifica como `MISSING_TOAST_WAGE` cuando el puesto trabajado/activo no tiene tarifa (`null` o `<= 0`) y como `WAGE_MISMATCH` cuando `|effectiveToastWage - simplifyRate| >= $0.01`.
 * 5. Idempotencia y Modo Simulación (`dryRun`):
 *    - Persiste `lastDispatchedDateLA` en `integrations` (`service_name = 'employee_wage_audit_state'`) para evitar envíos duplicados el mismo día.
 *    - En `dryRun = true` ejecuta toda la auditoría en vivo y calcula el tamaño en bytes de los correos HTML pero envía `0` correos y realiza `0` escrituras en base de datos.
 *
 * @dataFlow
 *   `/api/cron/audit-employee-wages` -> `runEmployeeWageAudit`
 *   -> Pre-flight Auth (Simplify HR + Toast POS) -> 15 Tiendas Activas (`stores` + `RONOS_STORES_MAP` + `RONOS_TO_SIMPLIFY_SITE_MAP`)
 *   -> Cruce 1-a-1 & Evaluación de Salarios -> `sendSystemEmail` (`noreply@tacosgavilan.com`) -> `integrations`.
 *
 * @notes
 *   - Nombre oficial de marca aplicado estrictamente: **Tacos Gavilan** (moneda exclusiva: `USD`).
 *   - HTML 100% inline Gmail-safe (`<!DOCTYPE html>`) con peso garantizado `< 90 KB` para evitar recortes en Gmail.
 */

import { supabaseAdmin } from './supabase'
import { RONOS_STORES_MAP } from './ronos-api'
import {
  extractAllSimplifyHrSalaries,
  getSimplifyHrAuthToken,
  RONOS_TO_SIMPLIFY_SITE_MAP,
  type SimplifyHrEmployeeRecord,
} from './simplifyhr-api'
import { sendSystemEmail } from './system-mailer'
import { compareStoreNamesAlphabetically, formatStoreDisplayName, sortStoresAlphabetically } from './store-display'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

const INTEGRATION_STATE_KEY = 'employee_wage_audit_state'

export const WAGE_AUDIT_EXECUTIVE_TO = ['carlos@tacosgavilan.com']
export const WAGE_AUDIT_EXECUTIVE_CC: string[] = []

const POS_SYSTEM_EMAIL_DOMAINS = new Set(['toasttab.com', 'tryotter.com'])

const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'invalid',
  'localhost',
  'toasttab.com',
  'tryotter.com',
])

const POS_BOT_EXACT_NAMES = new Set([
  'default online ordering',
  'tds driver',
  'toast support',
  'online ordering',
  'kiosk kiosk',
  'kiosk',
  'gavilan sg',
  'doordash',
  'uber eats',
  'uber',
  'grubhub',
])

const EXCLUDED_LEADERSHIP_EMAILS = new Set([
  'carlos@tacosgavilan.com',
  'roque@tacosgavilan.com',
  'raquel@tacosgavilan.com',
  'roberto@tacosgavilan.com',
  'gonzalo@tacosgavilan.com',
  'noreply@tacosgavilan.com',
])

export type WageDiscrepancyType = 'MISSING_TOAST_WAGE' | 'WAGE_MISMATCH'

export type EmployeeIdentityMatchMethod =
  | 'email'
  | 'exact_name'
  | 'contained_name'
  | 'ronos_mapping'
  | 'fuzzy_token'
  | 'cross_store_loan'

export interface EmployeeWageAuditOptions {
  dryRun?: boolean
  force?: boolean
  storeId?: string | number | null
  testTo?: string | null
}

export interface LiveToastJobRecord {
  guid: string
  title: string
  deleted: boolean
  wageFrequency: string
  defaultWage: number | null
}

export interface LiveToastEmployeeWageOverride {
  jobGuid: string
  wage: number
}

export interface LiveToastEmployeeJobRef {
  guid: string
  title?: string
}

export interface LiveToastEmployeeRecord {
  guid: string
  v2EmployeeGuid?: string | null
  firstName: string
  lastName: string
  chosenName?: string | null
  email?: string | null
  phoneNumber?: string | null
  externalEmployeeId?: string | null
  deleted: boolean
  disabled: boolean
  jobReferences: LiveToastEmployeeJobRef[]
  wageOverrides: LiveToastEmployeeWageOverride[]
}

export interface EmployeeJobWageDiscrepancy {
  storeId: number
  storeCode: string
  storeName: string
  simplifyEmployeeId: string
  simplifyEmployeeNumber: string
  simplifyFullName: string
  simplifyJobTitle: string
  simplifyHourlyRate: number
  toastEmployeeGuid: string
  toastFullName: string
  toastEmail: string
  toastJobGuid: string
  toastJobTitle: string
  toastOverrideWage: number | null
  toastJobDefaultWage: number | null
  effectiveToastWage: number | null
   wageSource: 'override' | 'job_default' | 'missing'
  deltaUsd: number | null
  discrepancyType: WageDiscrepancyType
  discrepancyLabel: string
  punches30dInJob: number
  totalPunches30d: number
  matchMethod: EmployeeIdentityMatchMethod
  isCrossStoreLoan?: boolean
  homeStoreName?: string
  actionRequired: string
}

export interface StoreWageAuditSummary {
  storeId: number
  storeCode: string
  storeName: string
  storeExternalId: string
  ronosCompanyId: number
  simplifySiteId: string
  managerName: string
  managerEmail: string
  supervisorName: string
  supervisorEmail: string
  simplifyActiveHourlyCount: number
  simplifySalariedExcludedCount: number
  toastActiveEmployeesCount: number
  matchedHourlyEmployeesCount: number
  compliantEmployeesCount: number
  affectedEmployeesCount: number
  discrepanciesCount: number
  missingWageCount: number
  mismatchWageCount: number
  discrepancies: EmployeeJobWageDiscrepancy[]
  managerEmailSent: boolean
  managerEmailMessageId?: string
  managerEmailHtmlBytes: number
}

export interface EmployeeWageAuditReport {
  executedAt: string
  dateLA: string
  durationMs: number
  dryRun: boolean
  force: boolean
  skippedDuplicateSameDay: boolean
  filteredStoreId: string | number | null
  testTo: string | null
  totalStoresAudited: number
  totalSimplifyActiveHourly: number
  totalSimplifySalariedExcluded: number
  totalToastActiveEmployees: number
  totalMatchedHourlyEmployees: number
  totalCompliantEmployees: number
  totalAffectedEmployees: number
  totalDiscrepancies: number
  totalMissingWage: number
  totalMismatchWage: number
  affectedStoresCount: number
  cleanStoresCount: number
  cleanStores: string[]
  managerEmailsSent: number
  executiveEmailSent: boolean
  executiveEmailMessageId?: string
  executiveEmailHtmlBytes: number
  stores: StoreWageAuditSummary[]
}

interface StoredWageAuditState {
  lastDispatchedDateLA?: string
  lastRunAt?: string
  lastSummary?: {
    totalStoresAudited: number
    totalMatchedHourlyEmployees: number
    totalDiscrepancies: number
    affectedStoresCount: number
  }
}

let cachedToastToken: string | null = null
let cachedToastTokenExpiry = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getLosAngelesDateISO(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value || '2026'
  const m = parts.find((p) => p.type === 'month')?.value || '01'
  const day = parts.find((p) => p.type === 'day')?.value || '01'
  return `${y}-${m}-${day}`
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) {
    return '$0.00'
  }
  return `$${Number(amount).toFixed(2)}`
}

export function normalizePersonName(raw?: string | null): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanMatchableEmail(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null
  const clean = raw.trim().toLowerCase()
  if (!clean || !clean.includes('@')) return null
  const parts = clean.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  if (PLACEHOLDER_EMAIL_DOMAINS.has(parts[1])) return null
  if (EXCLUDED_LEADERSHIP_EMAILS.has(clean)) return null
  return clean
}

export function levenshteinDistance(a: string, b: string): number {
  const s = a.toLowerCase()
  const t = b.toLowerCase()
  if (s === t) return 0
  if (!s.length) return t.length
  if (!t.length) return s.length

  const v0 = new Array(t.length + 1).fill(0)
  const v1 = new Array(t.length + 1).fill(0)
  for (let i = 0; i <= t.length; i++) v0[i] = i

  for (let i = 0; i < s.length; i++) {
    v1[0] = i + 1
    for (let j = 0; j < t.length; j++) {
      const cost = s[i] === t[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= t.length; j++) v0[j] = v1[j]
  }
  return v1[t.length]
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = nextIndex++
      if (idx >= items.length) break
      results[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return results
}

async function fetchAllPaginated<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await buildQuery(offset, offset + pageSize - 1)
    if (error) throw new Error(`Supabase paginated query error: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

/**
 * Autenticación OAuth con Toast POS (con soporte de pre-flight fail-fast).
 */
export async function getToastLaborAuthToken(forceRefresh = false): Promise<string> {
  if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET) {
    throw new Error('Variables de entorno TOAST_CLIENT_ID o TOAST_CLIENT_SECRET no configuradas')
  }
  if (!forceRefresh && cachedToastToken && Date.now() < cachedToastTokenExpiry - 300_000) {
    return cachedToastToken
  }

  let lastErr: any = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: TOAST_CLIENT_ID,
          clientSecret: TOAST_CLIENT_SECRET,
          userAccessType: 'TOAST_MACHINE_CLIENT',
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Toast Auth HTTP ${res.status}: ${errText || res.statusText}`)
      }
      const data = await res.json()
      const token = data?.token?.accessToken
      if (!token) {
        throw new Error('Toast Auth no devolvió token.accessToken')
      }
      cachedToastToken = token
      cachedToastTokenExpiry = Date.now() + 3600 * 1000
      return token
    } catch (err: any) {
      lastErr = err
      if (attempt < 3) {
        await sleep(attempt * 1200)
      }
    }
  }
  throw new Error(`Error fatal autenticando en Toast POS API: ${lastErr?.message}`)
}

async function fetchToastStoreJson<T = any>(
  endpointPath: string,
  storeExternalId: string
): Promise<T> {
  let lastErr: any = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = await getToastLaborAuthToken(false)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(`${TOAST_API_HOST}${endpointPath}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Toast-Restaurant-External-ID': storeExternalId,
        },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (res.status === 401 && attempt < 3) {
        await getToastLaborAuthToken(true)
        continue
      }
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(attempt * 1500)
          continue
        }
        const text = await res.text().catch(() => '')
        throw new Error(`Toast API ${endpointPath} [${res.status}]: ${text || res.statusText}`)
      }
      return (await res.json()) as T
    } catch (err: any) {
      lastErr = err
      if (attempt < 3) {
        await sleep(attempt * 1500)
      }
    }
  }
  throw lastErr || new Error(`Fallo consultando Toast API ${endpointPath}`)
}

/**
 * Obtiene en vivo el catálogo de puestos (`/labor/v1/jobs`) de una sucursal en Toast POS,
 * preservando `defaultWage` y `wageFrequency`.
 */
export async function fetchLiveToastStoreJobs(
  storeExternalId: string
): Promise<Map<string, LiveToastJobRecord>> {
  const rawJobs = await fetchToastStoreJson<any[]>('/labor/v1/jobs', storeExternalId)
  const map = new Map<string, LiveToastJobRecord>()
  if (!Array.isArray(rawJobs)) return map

  for (const j of rawJobs) {
    if (!j?.guid) continue
    const rawDef = Number(j.defaultWage)
    const defaultWage = Number.isFinite(rawDef) && rawDef > 0 ? Number(rawDef.toFixed(2)) : null
    map.set(String(j.guid), {
      guid: String(j.guid),
      title: String(j.title || 'Puesto Toast').trim(),
      deleted: Boolean(j.deleted),
      wageFrequency: String(j.wageFrequency || 'HOURLY').toUpperCase(),
      defaultWage,
    })
  }
  return map
}

/**
 * Determina si una cuenta de Toast POS corresponde a un bot o usuario virtual de sistema.
 */
export function isToastBotOrSystemEmployee(emp: {
  firstName?: string | null
  lastName?: string | null
  chosenName?: string | null
  email?: string | null
  deleted?: boolean | null
  disabled?: boolean | null
}): boolean {
  if (emp.deleted || emp.disabled) return true

  const rawEmail = String(emp.email || '').trim().toLowerCase()
  if (rawEmail.includes('@')) {
    const domain = rawEmail.split('@')[1] || ''
    if (POS_SYSTEM_EMAIL_DOMAINS.has(domain)) return true
  }

  const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.replace(/\s+/g, ' ').trim()
  const normName = normalizePersonName(fullName)
  if (!normName) return true
  if (POS_BOT_EXACT_NAMES.has(normName)) return true
  if (
    /\b(kiosk|online ordering|tds driver|toast support|doordash|uber eats|grubhub|pos bot|system user)\b/i.test(
      normName
    )
  ) {
    return true
  }
  return false
}

/**
 * Obtiene en vivo los empleados activos (`/labor/v1/employees?pageSize=500`) de una sucursal en Toast POS.
 */
export async function fetchLiveToastStoreEmployees(
  storeExternalId: string
): Promise<LiveToastEmployeeRecord[]> {
  const rawList = await fetchToastStoreJson<any[]>(
    '/labor/v1/employees?pageSize=500',
    storeExternalId
  )
  if (!Array.isArray(rawList)) return []

  const active: LiveToastEmployeeRecord[] = []
  for (const emp of rawList) {
    if (!emp?.guid) continue
    if (
      isToastBotOrSystemEmployee({
        firstName: emp.firstName,
        lastName: emp.lastName,
        chosenName: emp.chosenName,
        email: emp.email,
        deleted: emp.deleted,
        disabled: emp.disabled,
      })
    ) {
      continue
    }

    const jobRefs: LiveToastEmployeeJobRef[] = []
    if (Array.isArray(emp.jobReferences)) {
      for (const jr of emp.jobReferences) {
        if (jr?.guid) {
          jobRefs.push({
            guid: String(jr.guid),
            title: jr.title ? String(jr.title).trim() : undefined,
          })
        }
      }
    }

    const wageOverrides: LiveToastEmployeeWageOverride[] = []
    if (Array.isArray(emp.wageOverrides)) {
      for (const wo of emp.wageOverrides) {
        const jobGuid = wo?.jobReference?.guid || wo?.jobGuid
        const wageNum = Number(wo?.wage)
        if (jobGuid && Number.isFinite(wageNum) && wageNum > 0) {
          wageOverrides.push({
            jobGuid: String(jobGuid),
            wage: Number(wageNum.toFixed(2)),
          })
        }
      }
    }

    active.push({
      guid: String(emp.guid),
      v2EmployeeGuid: emp.v2EmployeeGuid ? String(emp.v2EmployeeGuid) : null,
      firstName: String(emp.firstName || '').trim(),
      lastName: String(emp.lastName || '').trim(),
      chosenName: emp.chosenName ? String(emp.chosenName).trim() : null,
      email: emp.email ? String(emp.email).trim() : null,
      phoneNumber: emp.phoneNumber ? String(emp.phoneNumber).trim() : null,
      externalEmployeeId: emp.externalEmployeeId ? String(emp.externalEmployeeId).trim() : null,
      deleted: Boolean(emp.deleted),
      disabled: Boolean(emp.disabled),
      jobReferences: jobRefs,
      wageOverrides,
    })
  }

  return active
}

/**
 * Determina si un registro de Simplify HR es un colaborador activo por hora (`Hourly` / `NonExempt`)
 * elegible para auditoría salarial (excluyendo estrictamente Managers y Supervisores asalariados).
 */
export function isSimplifyEmployeeHourlyAuditTarget(emp: {
  status?: string | null
  payType?: string | null
  overtimeStatus?: string | null
  payRate?: number | null
  emailAddress?: string | null
  notificationEmail?: string | null
  title?: string | null
  jobPosition?: string | null
}): boolean {
  const status = String(emp.status || '').trim().toLowerCase()
  if (status !== 'active') return false

  const payType = String(emp.payType || '').trim().toLowerCase()
  if (payType === 'yearly' || payType === 'salary' || payType === 'salaried') return false
  if (payType !== 'hourly') return false

  const otStatus = String(emp.overtimeStatus || '').trim().toLowerCase()
  if (otStatus === 'exempt') return false

  const rate = Number(emp.payRate || 0)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 200) return false

  const email1 = String(emp.emailAddress || '').trim().toLowerCase()
  const email2 = String(emp.notificationEmail || '').trim().toLowerCase()
  if (EXCLUDED_LEADERSHIP_EMAILS.has(email1) || EXCLUDED_LEADERSHIP_EMAILS.has(email2)) {
    return false
  }

  return true
}

/**
 * Verifica si los tokens de un nombre más corto están contenidos en orden/conjunto dentro de un nombre compuesto,
 * exigiendo coincidencia del primer nombre (`Chris Garcia` <-> `Chris Elian Garcia morales`).
 */
export function isCompoundPersonNameContainment(nameA: string, nameB: string): boolean {
  const tokensA = normalizePersonName(nameA)
    .split(' ')
    .filter((t) => t.length >= 2)
  const tokensB = normalizePersonName(nameB)
    .split(' ')
    .filter((t) => t.length >= 2)

  if (tokensA.length < 2 || tokensB.length < 2) return false
  if (tokensA[0] !== tokensB[0]) return false

  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA]
  const longerSet = new Set(longer)
  return shorter.every((tok) => longerSet.has(tok))
}

/**
 * Verifica coincidencia difusa segura dentro de la misma tienda (`Cruz Victorino Castillo` <-> `Cruz Victoriano Castillo`).
 */
export function isFuzzySameStorePersonMatch(nameA: string, nameB: string): boolean {
  const tokensA = normalizePersonName(nameA)
    .split(' ')
    .filter((t) => t.length >= 2)
  const tokensB = normalizePersonName(nameB)
    .split(' ')
    .filter((t) => t.length >= 2)

  if (tokensA.length < 2 || tokensB.length < 2) return false

  const firstA = tokensA[0]
  const firstB = tokensB[0]
  const firstDist = levenshteinDistance(firstA, firstB)
  const firstMatches =
    firstA === firstB || (firstA.length >= 4 && firstB.length >= 4 && firstDist <= 1)
  if (!firstMatches) return false

  const lastTokensA = tokensA.slice(1)
  const lastTokensB = tokensB.slice(1)

  // Al menos un apellido principal debe coincidir exacto o con Levenshtein <= 2 (para longitud >= 5)
  let sharedStrongSurname = false
  let minSurnameDistance = 99

  for (const la of lastTokensA) {
    for (const lb of lastTokensB) {
      const dist = levenshteinDistance(la, lb)
      if (dist < minSurnameDistance) minSurnameDistance = dist
      if (la === lb || (la.length >= 5 && lb.length >= 5 && dist <= 2)) {
        sharedStrongSurname = true
      }
    }
  }

  if (!sharedStrongSurname) return false

  // Si ambos tienen 2+ apellidos o nombres intermedios, verificar que no sean dos hermanos distintos con el mismo apellido
  if (firstA !== firstB && minSurnameDistance > 0) return false
  return true
}

export interface MatchedStoreEmployeePair {
  simplifyEmp: SimplifyHrEmployeeRecord
  toastEmp: LiveToastEmployeeRecord
  matchMethod: EmployeeIdentityMatchMethod
  isCrossStoreLoan?: boolean
  homeStoreName?: string
}

/**
 * Ejecuta la cascada determinística 1-a-1 entre empleados activos por hora de Simplify HR y empleados activos de Toast POS.
 */
export function matchStoreEmployeesSimplifyToToast(params: {
  simplifyHourlyEmployees: SimplifyHrEmployeeRecord[]
  toastActiveEmployees: LiveToastEmployeeRecord[]
  confirmedRonosMappings?: Array<{
    ronos_full_name?: string | null
    toast_guid?: string | null
    is_confirmed?: boolean | null
    mapping_type?: string | null
  }>
}): {
  matchedPairs: MatchedStoreEmployeePair[]
  unmatchedSimplify: SimplifyHrEmployeeRecord[]
  unmatchedToast: LiveToastEmployeeRecord[]
} {
  const {
    simplifyHourlyEmployees,
    toastActiveEmployees,
    confirmedRonosMappings = [],
  } = params

  const matchedSimplifyIds = new Set<string>()
  const matchedToastGuids = new Set<string>()
  const matchedPairs: MatchedStoreEmployeePair[] = []

  const getToastCandidateNames = (t: LiveToastEmployeeRecord): string[] => {
    const official = `${t.firstName || ''} ${t.lastName || ''}`.replace(/\s+/g, ' ').trim()
    const names = [official]
    if (t.chosenName && t.chosenName.trim()) {
      const chosenFull = `${t.chosenName.trim()} ${t.lastName || ''}`.replace(/\s+/g, ' ').trim()
      if (chosenFull && chosenFull.toLowerCase() !== official.toLowerCase()) {
        names.push(chosenFull)
      }
    }
    return names.filter(Boolean)
  }

  // PASO 1: Coincidencia por Correo Electrónico (notificationEmail o emailAddress en Simplify <-> email en Toast)
  const toastByCleanEmail = new Map<string, LiveToastEmployeeRecord[]>()
  for (const te of toastActiveEmployees) {
    const clean = cleanMatchableEmail(te.email)
    if (!clean) continue
    const arr = toastByCleanEmail.get(clean) || []
    arr.push(te)
    toastByCleanEmail.set(clean, arr)
  }

  for (const se of simplifyHourlyEmployees) {
    if (matchedSimplifyIds.has(se.id)) continue
    const candidateEmails = [
      cleanMatchableEmail(se.notificationEmail),
      cleanMatchableEmail(se.emailAddress),
    ].filter((e): e is string => Boolean(e))

    for (const email of candidateEmails) {
      const toastMatches = (toastByCleanEmail.get(email) || []).filter(
        (t) => !matchedToastGuids.has(t.guid)
      )
      if (toastMatches.length === 1) {
        const te = toastMatches[0]
        matchedSimplifyIds.add(se.id)
        matchedToastGuids.add(te.guid)
        matchedPairs.push({ simplifyEmp: se, toastEmp: te, matchMethod: 'email' })
        break
      }
    }
  }

  // PASO 2A: Nombre Normalizado Exacto (firstName + lastName o chosenName + lastName)
  for (const se of simplifyHourlyEmployees) {
    if (matchedSimplifyIds.has(se.id)) continue
    const normSimp = normalizePersonName(se.fullName || `${se.firstName} ${se.lastName}`)
    if (!normSimp) continue

    const exactCandidates = toastActiveEmployees.filter((te) => {
      if (matchedToastGuids.has(te.guid)) return false
      return getToastCandidateNames(te).some((n) => normalizePersonName(n) === normSimp)
    })

    if (exactCandidates.length === 1) {
      const te = exactCandidates[0]
      matchedSimplifyIds.add(se.id)
      matchedToastGuids.add(te.guid)
      matchedPairs.push({ simplifyEmp: se, toastEmp: te, matchMethod: 'exact_name' })
    }
  }

  // PASO 2B: Contención Única de Nombres/Apellidos Compuestos en la misma sucursal
  for (const se of simplifyHourlyEmployees) {
    if (matchedSimplifyIds.has(se.id)) continue
    const simpName = se.fullName || `${se.firstName} ${se.lastName}`

    const containedCandidates = toastActiveEmployees.filter((te) => {
      if (matchedToastGuids.has(te.guid)) return false
      return getToastCandidateNames(te).some((n) => isCompoundPersonNameContainment(simpName, n))
    })

    if (containedCandidates.length === 1) {
      const te = containedCandidates[0]
      // Verificar que este empleado de Toast no sea también candidato único de otro empleado de Simplify sin emparejar
      const reverseMatches = simplifyHourlyEmployees.filter((otherSe) => {
        if (matchedSimplifyIds.has(otherSe.id)) return false
        const otherName = otherSe.fullName || `${otherSe.firstName} ${otherSe.lastName}`
        return getToastCandidateNames(te).some((n) => isCompoundPersonNameContainment(otherName, n))
      })

      if (reverseMatches.length === 1) {
        matchedSimplifyIds.add(se.id)
        matchedToastGuids.add(te.guid)
        matchedPairs.push({ simplifyEmp: se, toastEmp: te, matchMethod: 'contained_name' })
      }
    }
  }

  // PASO 3: Mapeos Confirmados en `ronos_employee_mappings`
  for (const mapping of confirmedRonosMappings) {
    if (!mapping?.is_confirmed || mapping.mapping_type === 'inactive') continue
    if (!mapping.toast_guid || !mapping.ronos_full_name) continue
    if (matchedToastGuids.has(mapping.toast_guid)) continue

    const te = toastActiveEmployees.find(
      (t) => !matchedToastGuids.has(t.guid) && t.guid === mapping.toast_guid
    )
    if (!te) continue

    const normRonos = normalizePersonName(mapping.ronos_full_name)
    const seMatches = simplifyHourlyEmployees.filter((se) => {
      if (matchedSimplifyIds.has(se.id)) return false
      const simpName = se.fullName || `${se.firstName} ${se.lastName}`
      return (
        normalizePersonName(simpName) === normRonos ||
        isCompoundPersonNameContainment(simpName, mapping.ronos_full_name!)
      )
    })

    if (seMatches.length === 1) {
      const se = seMatches[0]
      matchedSimplifyIds.add(se.id)
      matchedToastGuids.add(te.guid)
      matchedPairs.push({ simplifyEmp: se, toastEmp: te, matchMethod: 'ronos_mapping' })
    }
  }

  // PASO 4: Coincidencia Difusa por Tokens (Levenshtein <= 2 dentro de la misma tienda, candidato único)
  for (const se of simplifyHourlyEmployees) {
    if (matchedSimplifyIds.has(se.id)) continue
    const simpName = se.fullName || `${se.firstName} ${se.lastName}`

    const fuzzyCandidates = toastActiveEmployees.filter((te) => {
      if (matchedToastGuids.has(te.guid)) return false
      return getToastCandidateNames(te).some((n) => isFuzzySameStorePersonMatch(simpName, n))
    })

    if (fuzzyCandidates.length === 1) {
      const te = fuzzyCandidates[0]
      const reverseFuzzy = simplifyHourlyEmployees.filter((otherSe) => {
        if (matchedSimplifyIds.has(otherSe.id)) return false
        const otherName = otherSe.fullName || `${otherSe.firstName} ${otherSe.lastName}`
        return getToastCandidateNames(te).some((n) => isFuzzySameStorePersonMatch(otherName, n))
      })

      if (reverseFuzzy.length === 1) {
        matchedSimplifyIds.add(se.id)
        matchedToastGuids.add(te.guid)
        matchedPairs.push({ simplifyEmp: se, toastEmp: te, matchMethod: 'fuzzy_token' })
      }
    }
  }

  const unmatchedSimplify = simplifyHourlyEmployees.filter((se) => !matchedSimplifyIds.has(se.id))
  const unmatchedToast = toastActiveEmployees.filter((te) => !matchedToastGuids.has(te.guid))

  return { matchedPairs, unmatchedSimplify, unmatchedToast }
}

/**
 * Evalúa los puestos horarios (`HOURLY`) de un colaborador emparejado contra su tarifa oficial en Simplify HR.
 */
export function evaluateMatchedEmployeeJobWages(params: {
  storeId: number
  storeCode: string
  storeName: string
  pair: MatchedStoreEmployeePair
  jobsMap: Map<string, LiveToastJobRecord>
  punchesByJobGuid?: Map<string, number>
}): {
  evaluatedHourlyJobsCount: number
  discrepancies: EmployeeJobWageDiscrepancy[]
} {
  const { storeId, storeCode, storeName, pair, jobsMap, punchesByJobGuid = new Map() } = params
  const { simplifyEmp, toastEmp, matchMethod, isCrossStoreLoan, homeStoreName } = pair

  const simplifyRate = Number(Number(simplifyEmp.payRate || 0).toFixed(2))
  if (!Number.isFinite(simplifyRate) || simplifyRate <= 0) {
    return { evaluatedHourlyJobsCount: 0, discrepancies: [] }
  }

  const overrideByJobGuid = new Map<string, number>()
  for (const wo of toastEmp.wageOverrides || []) {
    if (wo.jobGuid && Number.isFinite(wo.wage) && wo.wage > 0) {
      overrideByJobGuid.set(wo.jobGuid, Number(wo.wage.toFixed(2)))
    }
  }

  let totalPunches30d = 0
  for (const count of punchesByJobGuid.values()) {
    totalPunches30d += count
  }

  const isSalaryJob = (jobGuid: string, fallbackTitle?: string): boolean => {
    const job = jobsMap.get(jobGuid)
    if (job) {
      if (job.deleted) return true
      if (job.wageFrequency === 'SALARY') return true
      if (/^super\s*user$/i.test(job.title)) return true
    }
    if (fallbackTitle && /^super\s*user$/i.test(fallbackTitle.trim())) return true
    return false
  }

  // Reunir todos los jobGuids candidatos (en jobReferences, en wageOverrides o con ponchadas últimos 30d)
  const candidateHourlyJobGuids = new Set<string>()
  const fallbackTitleByGuid = new Map<string, string>()

  for (const jr of toastEmp.jobReferences || []) {
    if (!jr?.guid) continue
    if (jr.title) fallbackTitleByGuid.set(jr.guid, jr.title)
    if (!isSalaryJob(jr.guid, jr.title)) {
      candidateHourlyJobGuids.add(jr.guid)
    }
  }

  for (const wo of toastEmp.wageOverrides || []) {
    if (!wo?.jobGuid) continue
    if (!isSalaryJob(wo.jobGuid)) {
      candidateHourlyJobGuids.add(wo.jobGuid)
    }
  }

  for (const [jobGuid, count] of punchesByJobGuid.entries()) {
    if (count > 0 && jobGuid && !isSalaryJob(jobGuid)) {
      candidateHourlyJobGuids.add(jobGuid)
    }
  }

  const simplifyFullName =
    simplifyEmp.fullName || `${simplifyEmp.firstName || ''} ${simplifyEmp.lastName || ''}`.trim()
  const toastFullName = `${toastEmp.firstName || ''} ${toastEmp.lastName || ''}`
    .replace(/\s+/g, ' ')
    .trim()
  const toastEmail = String(toastEmp.email || '').trim() || '(sin correo en Toast)'
  const simplifyJobTitle =
    String(simplifyEmp.jobPosition || simplifyEmp.title || 'Hourly').trim() || 'Hourly'

  const discrepancies: EmployeeJobWageDiscrepancy[] = []

  // Si el empleado no tiene ningún puesto HOURLY asignado en Toast
  if (candidateHourlyJobGuids.size === 0) {
    // Si únicamente tiene puesto SALARY en Toast, no es auditable como puesto horario
    const hasSalaryRef = (toastEmp.jobReferences || []).some((jr) =>
      isSalaryJob(jr.guid, jr.title)
    )
    if (hasSalaryRef) {
      return { evaluatedHourlyJobsCount: 0, discrepancies: [] }
    }

    discrepancies.push({
      storeId,
      storeCode,
      storeName,
      simplifyEmployeeId: simplifyEmp.id,
      simplifyEmployeeNumber: simplifyEmp.employeeID || '',
      simplifyFullName,
      simplifyJobTitle,
      simplifyHourlyRate: simplifyRate,
      toastEmployeeGuid: toastEmp.guid,
      toastFullName,
      toastEmail,
      toastJobGuid: 'unassigned',
      toastJobTitle: 'Sin puesto asignado en Toast POS',
      toastOverrideWage: null,
      toastJobDefaultWage: null,
      effectiveToastWage: null,
      wageSource: 'missing',
      deltaUsd: null,
      discrepancyType: 'MISSING_TOAST_WAGE',
      discrepancyLabel: 'SIN PUESTO / SIN TARIFA EN TOAST ($0.00)',
      punches30dInJob: 0,
      totalPunches30d,
      matchMethod,
      isCrossStoreLoan,
      homeStoreName,
      actionRequired: `Asignar su puesto en Toast Web (Jobs & Permissions) y capturar su tarifa oficial de ${formatUsd(simplifyRate)}/hr.`,
    })
    return { evaluatedHourlyJobsCount: 1, discrepancies }
  }

  interface CandidateJobEval {
    jobGuid: string
    jobTitle: string
    overrideWage: number | null
    defaultWage: number | null
    effectiveToastWage: number | null
    wageSource: 'override' | 'job_default' | 'missing'
    punches30dInJob: number
  }

  const candidateEvals: CandidateJobEval[] = []
  for (const jobGuid of candidateHourlyJobGuids) {
    const job = jobsMap.get(jobGuid)
    const jobTitle = job?.title || fallbackTitleByGuid.get(jobGuid) || 'Puesto Horario'
    const overrideWage = overrideByJobGuid.get(jobGuid) ?? null
    const defaultWage = job?.defaultWage ?? null
    const effectiveToastWage = overrideWage ?? defaultWage ?? null
    const wageSource: 'override' | 'job_default' | 'missing' =
      overrideWage !== null ? 'override' : defaultWage !== null ? 'job_default' : 'missing'
    const punches30dInJob = punchesByJobGuid.get(jobGuid) ?? 0

    candidateEvals.push({
      jobGuid,
      jobTitle,
      overrideWage,
      defaultWage,
      effectiveToastWage,
      wageSource,
      punches30dInJob,
    })
  }

  // Ordenar: primero los puestos con más ponchadas 30d, luego por título
  candidateEvals.sort((a, b) => {
    if (b.punches30dInJob !== a.punches30dInJob) return b.punches30dInJob - a.punches30dInJob
    return a.jobTitle.localeCompare(b.jobTitle)
  })

  const punchedJobs = candidateEvals.filter((c) => c.punches30dInJob > 0)
  const jobsToValidate: CandidateJobEval[] = []

  if (punchedJobs.length > 0) {
    // Caso A: Tiene ponchadas en los últimos 30 días en 1+ puestos HOURLY.
    // 1) Evaluar todos los puestos HOURLY ponchados en los últimos 30d.
    // 2) Evaluar cualquier otro puesto HOURLY asignado que tenga un overrideWage > 0 explícito distinto de simplifyRate.
    for (const c of candidateEvals) {
      if (c.punches30dInJob > 0) {
        jobsToValidate.push(c)
      } else if (
        c.overrideWage !== null &&
        c.overrideWage > 0 &&
        Math.abs(c.overrideWage - simplifyRate) >= 0.01
      ) {
        jobsToValidate.push(c)
      }
    }
  } else {
    // Caso B: 0 ponchadas en los últimos 30 días.
    const jobsWithExplicitOverride = candidateEvals.filter(
      (c) => c.overrideWage !== null && c.overrideWage > 0
    )
    const jobsWithAnyEffectiveWage = candidateEvals.filter(
      (c) => c.effectiveToastWage !== null && c.effectiveToastWage > 0
    )

    if (jobsWithExplicitOverride.length > 0) {
      // Si tiene override(s) explícito(s), validar esos overrides contra Simplify HR
      jobsToValidate.push(...jobsWithExplicitOverride)
    } else if (jobsWithAnyEffectiveWage.length > 0) {
      // Si no tiene override pero los puestos tienen defaultWage, validar el puesto principal
      jobsToValidate.push(jobsWithAnyEffectiveWage[0])
    } else {
      // Ningún puesto HOURLY asignado tiene tarifa -> reportar MISSING_TOAST_WAGE en su puesto principal
      jobsToValidate.push(candidateEvals[0])
    }
  }

  for (const jobEval of jobsToValidate) {
    const {
      jobGuid,
      jobTitle,
      overrideWage,
      defaultWage,
      effectiveToastWage,
      wageSource,
      punches30dInJob,
    } = jobEval

    if (effectiveToastWage === null || effectiveToastWage <= 0) {
      discrepancies.push({
        storeId,
        storeCode,
        storeName,
        simplifyEmployeeId: simplifyEmp.id,
        simplifyEmployeeNumber: simplifyEmp.employeeID || '',
        simplifyFullName,
        simplifyJobTitle,
        simplifyHourlyRate: simplifyRate,
        toastEmployeeGuid: toastEmp.guid,
        toastFullName,
        toastEmail,
        toastJobGuid: jobGuid,
        toastJobTitle: jobTitle,
        toastOverrideWage: overrideWage,
        toastJobDefaultWage: defaultWage,
        effectiveToastWage: null,
        wageSource,
        deltaUsd: null,
        discrepancyType: 'MISSING_TOAST_WAGE',
        discrepancyLabel: 'SIN TARIFA EN TOAST ($0.00)',
        punches30dInJob,
        totalPunches30d,
        matchMethod,
        isCrossStoreLoan,
        homeStoreName,
        actionRequired: `Capturar Wage Override de ${formatUsd(simplifyRate)}/hr en el puesto "${jobTitle}" en Toast Web.`,
      })
      continue
    }

    const delta = Number((effectiveToastWage - simplifyRate).toFixed(2))
    if (Math.abs(delta) >= 0.01) {
      const sign = delta > 0 ? '+' : '-'
      const absDeltaStr = `$${Math.abs(delta).toFixed(2)}`
      discrepancies.push({
        storeId,
        storeCode,
        storeName,
        simplifyEmployeeId: simplifyEmp.id,
        simplifyEmployeeNumber: simplifyEmp.employeeID || '',
        simplifyFullName,
        simplifyJobTitle,
        simplifyHourlyRate: simplifyRate,
        toastEmployeeGuid: toastEmp.guid,
        toastFullName,
        toastEmail,
        toastJobGuid: jobGuid,
        toastJobTitle: jobTitle,
        toastOverrideWage: overrideWage,
        toastJobDefaultWage: defaultWage,
        effectiveToastWage,
        wageSource,
        deltaUsd: delta,
        discrepancyType: 'WAGE_MISMATCH',
        discrepancyLabel: `DESFASE (${sign}${absDeltaStr}/hr vs Simplify)`,
        punches30dInJob,
        totalPunches30d,
        matchMethod,
        isCrossStoreLoan,
        homeStoreName,
        actionRequired: `Actualizar Wage Override en el puesto "${jobTitle}" de ${formatUsd(effectiveToastWage)}/hr a ${formatUsd(simplifyRate)}/hr en Toast Web.`,
      })
    }
  }

  return {
    evaluatedHourlyJobsCount: jobsToValidate.length,
    discrepancies,
  }
}

async function loadWageAuditState(): Promise<{
  rowId: string | null
  state: StoredWageAuditState
}> {
  try {
    const { data } = await supabaseAdmin
      .from('integrations')
      .select('id, access_token')
      .eq('service_name', INTEGRATION_STATE_KEY)
      .maybeSingle()

    if (!data) return { rowId: null, state: {} }
    const parsed = JSON.parse(data.access_token || '{}')
    return {
      rowId: data.id,
      state: {
        lastDispatchedDateLA: parsed.lastDispatchedDateLA,
        lastRunAt: parsed.lastRunAt,
        lastSummary: parsed.lastSummary,
      },
    }
  } catch {
    return { rowId: null, state: {} }
  }
}

async function saveWageAuditState(
  existingRowId: string | null,
  state: StoredWageAuditState
): Promise<void> {
  const payloadStr = JSON.stringify(state)
  const nowIso = new Date().toISOString()
  if (existingRowId) {
    const { error } = await supabaseAdmin
      .from('integrations')
      .update({
        access_token: payloadStr,
        updated_at: nowIso,
      })
      .eq('id', existingRowId)
    if (error) throw new Error(`Failed updating ${INTEGRATION_STATE_KEY}: ${error.message}`)
  } else {
    const { error } = await supabaseAdmin.from('integrations').insert({
      service_name: INTEGRATION_STATE_KEY,
      access_token: payloadStr,
      refresh_token: 'employee_wage_audit',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    })
    if (error) throw new Error(`Failed inserting ${INTEGRATION_STATE_KEY}: ${error.message}`)
  }
}

/**
 * Construye el correo HTML 100% inline Gmail-safe (`<!DOCTYPE html>`) para el Gerente de Tienda (con CC al Supervisor de Zona).
 */
export function buildStoreManagerWageAuditEmailHtml(
  storeSummary: StoreWageAuditSummary,
  dateLA: string
): string {
  const rowsHtml = storeSummary.discrepancies
    .map((d) => {
      const isMissing = d.discrepancyType === 'MISSING_TOAST_WAGE'
      const toastWageHtml = isMissing
        ? `<span style="display:inline-block;background-color:#fee2e2;color:#991b1b;font-weight:800;font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid #fecaca;">$0.00 (Sin tarifa)</span>`
        : `<span style="display:inline-block;background-color:#fef3c7;color:#92400e;font-weight:800;font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid #fde68a;">${escapeHtml(formatUsd(d.effectiveToastWage))} / hr</span><div style="font-size:10px;color:#64748b;margin-top:2px;">${d.wageSource === 'job_default' ? 'Tarifa default del puesto' : 'Wage Override en Toast'}</div>`

      const statusBadgeHtml = isMissing
        ? `<span style="display:inline-block;background-color:#dc2626;color:#ffffff;font-weight:800;font-size:10px;padding:3px 8px;border-radius:999px;">SIN TARIFA ($0.00)</span>`
        : `<span style="display:inline-block;background-color:#d97706;color:#ffffff;font-weight:800;font-size:10px;padding:3px 8px;border-radius:999px;">${escapeHtml(d.discrepancyLabel)}</span>`

      const punchLabel =
        d.punches30dInJob > 0
          ? `${d.punches30dInJob} ponchada${d.punches30dInJob === 1 ? '' : 's'} (30d)`
          : 'Sin ponchadas (30d)'

      const loanTag =
        d.isCrossStoreLoan && d.homeStoreName
          ? `<div style="font-size:10px;color:#1d4ed8;font-weight:700;margin-top:2px;">Prestado de: ${escapeHtml(formatStoreDisplayName(d.homeStoreName) || d.homeStoreName)}</div>`
          : ''

      return `
        <tr>
          <td valign="top" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:12px;">
            <div style="font-weight:800;color:#0f172a;">${escapeHtml(d.toastFullName)}</div>
            ${
              normalizePersonName(d.toastFullName) !== normalizePersonName(d.simplifyFullName)
                ? `<div style="font-size:11px;color:#475569;">Simplify HR: ${escapeHtml(d.simplifyFullName)}</div>`
                : ''
            }
            <div style="font-size:10px;color:#64748b;">${escapeHtml(d.toastEmail)}</div>
            ${loanTag}
          </td>
          <td valign="top" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:12px;">
            <div style="font-weight:700;color:#0f172a;">${escapeHtml(d.toastJobTitle)}</div>
            <div style="font-size:11px;color:#64748b;">${escapeHtml(punchLabel)}</div>
          </td>
          <td valign="top" align="center" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;">
            ${toastWageHtml}
          </td>
          <td valign="top" align="center" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;">
            <span style="display:inline-block;background-color:#dcfce7;color:#166534;font-weight:900;font-size:13px;padding:4px 10px;border-radius:6px;border:1px solid #86efac;">
              ${escapeHtml(formatUsd(d.simplifyHourlyRate))} / hr
            </span>
            <div style="font-size:10px;color:#15803d;font-weight:700;margin-top:2px;">Oficial Simplify HR</div>
          </td>
          <td valign="top" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#334155;">
            <div style="margin-bottom:4px;">${statusBadgeHtml}</div>
            <div style="color:#1e293b;line-height:1.35;">${escapeHtml(d.actionRequired)}</div>
          </td>
        </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Auditoría Semanal de Salarios (Simplify HR vs Toast POS) — Tacos Gavilan</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:20px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:780px;background-color:#ffffff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;">
          <tr>
            <td bgcolor="#0f172a" style="background-color:#0f172a;color:#ffffff;padding:20px 24px;">
              <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#86efac;margin-bottom:4px;">
                TACOS GAVILAN • AUDITORÍA SEMANAL DE SALARIOS (SIMPLIFY HR vs TOAST POS)
              </div>
              <h1 style="margin:0;font-size:20px;font-weight:800;color:#ffffff;">
                💲 Acción Requerida: Actualizar Salarios en Toast POS — ${escapeHtml(formatStoreDisplayName({ id: storeSummary.storeId, code: storeSummary.storeCode, name: storeSummary.storeName }) || storeSummary.storeName)}
              </h1>
              <div style="margin-top:6px;font-size:12px;color:#cbd5e1;">
                Fecha de Auditoría: <strong>${escapeHtml(dateLA)}</strong> • Gerente: <strong>${escapeHtml(storeSummary.managerName)}</strong> • CC Supervisor: <strong>${escapeHtml(storeSummary.supervisorName)}</strong>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px;">
              <p style="margin:0 0 12px 0;font-size:14px;color:#1e293b;line-height:1.55;">
                Hola <strong>${escapeHtml(storeSummary.managerName)}</strong>,
              </p>
              <p style="margin:0 0 16px 0;font-size:13.5px;color:#334155;line-height:1.6;">
                En el cruce semanal en vivo entre <strong>Simplify HR (Cingular HR — Nómina Oficial)</strong> y <strong>Toast POS</strong> de <strong>${escapeHtml(formatStoreDisplayName({ id: storeSummary.storeId, code: storeSummary.storeCode, name: storeSummary.storeName }) || storeSummary.storeName)}</strong>, se detectaron <strong>${storeSummary.discrepanciesCount} ${storeSummary.discrepanciesCount === 1 ? 'puesto con salario pendiente de actualizar' : 'puestos con salarios pendientes de actualizar'}</strong> (${storeSummary.affectedEmployeesCount} ${storeSummary.affectedEmployeesCount === 1 ? 'colaborador' : 'colaboradores'}). Mantener el salario por hora de Toast POS idéntico al de Simplify HR es indispensable para que el <strong>Planificador de Horarios (<code>/planificador</code>)</strong> calcule con exactitud el presupuesto y porcentaje de Labor (<em>Labor Cost %</em>) antes de publicar la semana.
              </p>

              <table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="margin:14px 0 18px 0;">
                <tr>
                  <td width="25%" bgcolor="#f8fafc" align="center" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 6px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#475569;">Activos por Hora</div>
                    <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:2px;">${storeSummary.matchedHourlyEmployeesCount}</div>
                  </td>
                  <td width="25%" bgcolor="#f0fdf4" align="center" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 6px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#166534;">Al Corriente</div>
                    <div style="font-size:20px;font-weight:800;color:#15803d;margin-top:2px;">${storeSummary.compliantEmployeesCount}</div>
                  </td>
                  <td width="25%" bgcolor="#fef2f2" align="center" style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 6px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#991b1b;">Sin Tarifa ($0)</div>
                    <div style="font-size:20px;font-weight:800;color:#dc2626;margin-top:2px;">${storeSummary.missingWageCount}</div>
                  </td>
                  <td width="25%" bgcolor="#fffbeb" align="center" style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 6px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#92400e;">Tarifa Desfasada</div>
                    <div style="font-size:20px;font-weight:800;color:#d97706;margin-top:2px;">${storeSummary.mismatchWageCount}</div>
                  </td>
                </tr>
              </table>

              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #cbd5e1;margin:16px 0;">
                <thead>
                  <tr bgcolor="#1e293b" style="background-color:#1e293b;color:#ffffff;font-size:11px;text-transform:uppercase;">
                    <th width="24%" align="left" style="padding:9px 8px;">Colaborador</th>
                    <th width="20%" align="left" style="padding:9px 8px;">Puesto en Toast POS (Ponchadas 30d)</th>
                    <th width="16%" align="center" style="padding:9px 8px;">Salario en Toast POS</th>
                    <th width="16%" align="center" style="padding:9px 8px;">Salario Real en Simplify HR</th>
                    <th width="24%" align="left" style="padding:9px 8px;">Diferencia / Estado</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>

              <div style="background-color:#f0fdf4;border:1px solid #86efac;border-left:5px solid #16a34a;border-radius:8px;padding:14px 16px;margin-top:18px;font-size:12.5px;color:#14532d;line-height:1.6;">
                <div style="font-weight:800;font-size:13px;text-transform:uppercase;color:#166534;margin-bottom:6px;">
                  🛠️ Pasos para actualizar el salario en Toast Web (Antes de publicar horarios):
                </div>
                <ol style="margin:0;padding-left:18px;">
                  <li style="margin-bottom:4px;">Ingresar a <strong>Toast Web</strong> (<code>toasttab.com</code>) &rarr; <strong>Employees</strong> &rarr; <strong>Employee Management</strong> &rarr; <strong>Employees</strong>.</li>
                  <li style="margin-bottom:4px;">Abrir el perfil de cada colaborador enlistado arriba y seleccionar la pestaña <strong>Jobs &amp; Permissions</strong>.</li>
                  <li style="margin-bottom:4px;">En la tabla de puestos asignados (<strong>Jobs</strong>), ubicar el puesto indicado y escribir en <strong>Wage Override</strong> exactamente el <strong>Salario Real en Simplify HR</strong> (columna verde).</li>
                  <li style="margin-bottom:4px;">Presionar <strong>Save</strong> y publicar los cambios (<strong>Publish</strong>) en Toast Web.</li>
                  <li>Entrar al Planificador (<a href="https://tacosgavilan.vercel.app/planificador" style="color:#15803d;font-weight:700;">tacosgavilan.vercel.app/planificador</a>) y hacer clic en <strong>"Sincronizar Empleados"</strong>.</li>
                </ol>
              </div>

              <div style="background-color:#fff7ed;border:1px solid #fdba74;border-left:5px solid #ea580c;border-radius:8px;padding:12px 16px;margin-top:14px;font-size:12px;color:#431407;line-height:1.55;">
                <strong>📌 Seguimiento del Supervisor de Zona (${escapeHtml(storeSummary.supervisorName)} — en CC):</strong> Verificar junto con el Gerente de Tienda que estos salarios queden actualizados en Toast Web hoy mismo antes de autorizar y publicar la programación semanal en <code>/planificador</code>.
              </div>

              <div style="border-top:1px solid #e2e8f0;margin-top:18px;padding-top:12px;font-size:11.5px;color:#64748b;text-align:center;">
                <strong>Sistema de Monitoreo</strong> • Tacos Gavilan
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Construye el Resumen Ejecutivo Semanal Consolidado (`<!DOCTYPE html>`, `< 90 KB` Gmail-safe inline).
 */
export function buildExecutiveWageAuditSummaryEmailHtml(report: EmployeeWageAuditReport): string {
  const allClean = report.totalDiscrepancies === 0
  const headerBg = allClean ? '#15803d' : '#0f172a'
  const orderedStores = sortStoresAlphabetically(report.stores, (s) => s.storeName, { pinSpecialFirst: false })
  const orderedCleanStores = sortStoresAlphabetically(
    report.cleanStores.map((st) => formatStoreDisplayName(st) || st),
    undefined,
    { pinSpecialFirst: false }
  )

  const storeSummaryRowsHtml = orderedStores
    .map((s) => {
      const badge =
        s.discrepanciesCount === 0
          ? `<span style="display:inline-block;background-color:#dcfce7;color:#166534;font-weight:800;font-size:10px;padding:2px 8px;border-radius:999px;">100% OK</span>`
          : `<span style="display:inline-block;background-color:#fee2e2;color:#991b1b;font-weight:800;font-size:10px;padding:2px 8px;border-radius:999px;">${s.discrepanciesCount} PEND.</span>`

      return `
        <tr>
          <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;font-size:11.5px;">${escapeHtml(formatStoreDisplayName({ id: s.storeId, code: s.storeCode, name: s.storeName }) || s.storeName)}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:11px;">${escapeHtml(s.managerName)}<div style="font-size:10px;color:#64748b;">CC: ${escapeHtml(s.supervisorName)}</div></td>
          <td align="center" style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-size:11.5px;color:#0f172a;font-weight:700;">${s.matchedHourlyEmployeesCount}</td>
          <td align="center" style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-size:11.5px;color:#15803d;font-weight:700;">${s.compliantEmployeesCount}</td>
          <td align="center" style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-size:11.5px;color:${s.missingWageCount > 0 ? '#dc2626' : '#64748b'};font-weight:700;">${s.missingWageCount}</td>
          <td align="center" style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-size:11.5px;color:${s.mismatchWageCount > 0 ? '#d97706' : '#64748b'};font-weight:700;">${s.mismatchWageCount}</td>
          <td align="center" style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${badge}</td>
        </tr>`
    })
    .join('')

  const detailRowsHtml = orderedStores
    .flatMap((s) => {
      const cleanRowStore = formatStoreDisplayName({ id: s.storeId, code: s.storeCode, name: s.storeName }) || s.storeName
      return s.discrepancies.map((d) => {
        const isMissing = d.discrepancyType === 'MISSING_TOAST_WAGE'
        const toastStr = isMissing ? '$0.00 (Sin tarifa)' : `${formatUsd(d.effectiveToastWage)}/hr`
        const toastColor = isMissing ? '#dc2626' : '#b45309'
        return `
          <tr>
            <td style="padding:6px 7px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;font-size:11px;">${escapeHtml(cleanRowStore)}</td>
            <td style="padding:6px 7px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:11px;"><strong>${escapeHtml(d.toastFullName)}</strong></td>
            <td style="padding:6px 7px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:11px;">${escapeHtml(d.toastJobTitle)} (${d.punches30dInJob}p)</td>
            <td align="center" style="padding:6px 7px;border-bottom:1px solid #e2e8f0;color:${toastColor};font-weight:800;font-size:11px;">${escapeHtml(toastStr)}</td>
            <td align="center" style="padding:6px 7px;border-bottom:1px solid #e2e8f0;color:#15803d;font-weight:800;font-size:11px;">${escapeHtml(formatUsd(d.simplifyHourlyRate))}/hr</td>
            <td style="padding:6px 7px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:10.5px;">${escapeHtml(d.discrepancyLabel)}</td>
          </tr>`
      })
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resumen Ejecutivo Semanal de Salarios (Simplify HR vs Toast POS) — Tacos Gavilan</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:18px 8px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:860px;background-color:#ffffff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;">
          <tr>
            <td bgcolor="${headerBg}" style="background-color:${headerBg};color:#ffffff;padding:20px 24px;">
              <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#86efac;margin-bottom:4px;">
                TACOS GAVILAN • AUDITORÍA SEMANAL DE SALARIOS (SIMPLIFY HR vs TOAST POS)
              </div>
              <h1 style="margin:0;font-size:19px;font-weight:800;color:#ffffff;">
                ${
                  allClean
                    ? '✅ 100% de Salarios por Hora Sincronizados entre Simplify HR y Toast POS'
                    : `💲 Resumen Ejecutivo Semanal: ${report.totalDiscrepancies} Discrepancias Salariales en ${report.affectedStoresCount} Sucursales`
                }
              </h1>
              <div style="margin-top:5px;font-size:12px;color:#cbd5e1;">
                Fecha: <strong>${escapeHtml(report.dateLA)}</strong> • Tiendas Auditadas: <strong>${report.totalStoresAudited}</strong> • Tiempo de Ejecución: <strong>${(report.durationMs / 1000).toFixed(1)}s</strong>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 22px;">
              <table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="margin-bottom:16px;">
                <tr>
                  <td width="20%" bgcolor="#f8fafc" align="center" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 4px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#475569;">Emp. por Hora</div>
                    <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:2px;">${report.totalMatchedHourlyEmployees}</div>
                  </td>
                  <td width="20%" bgcolor="#f0fdf4" align="center" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 4px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#166534;">Al Corriente</div>
                    <div style="font-size:20px;font-weight:800;color:#15803d;margin-top:2px;">${report.totalCompliantEmployees}</div>
                  </td>
                  <td width="20%" bgcolor="#fef2f2" align="center" style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 4px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#991b1b;">Sin Tarifa ($0)</div>
                    <div style="font-size:20px;font-weight:800;color:#dc2626;margin-top:2px;">${report.totalMissingWage}</div>
                  </td>
                  <td width="20%" bgcolor="#fffbeb" align="center" style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 4px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#92400e;">Desfasados</div>
                    <div style="font-size:20px;font-weight:800;color:#d97706;margin-top:2px;">${report.totalMismatchWage}</div>
                  </td>
                  <td width="20%" bgcolor="#eff6ff" align="center" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 4px;">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#1e40af;">Tiendas Afectadas</div>
                    <div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-top:2px;">${report.affectedStoresCount}/${report.totalStoresAudited}</div>
                  </td>
                </tr>
              </table>

              <h3 style="margin:14px 0 8px 0;font-size:13px;text-transform:uppercase;color:#1e293b;">
                📊 Estado por Sucursal (${report.totalStoresAudited} Restaurantes)
              </h3>
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #cbd5e1;margin-bottom:18px;">
                <thead>
                  <tr bgcolor="#1e293b" style="background-color:#1e293b;color:#ffffff;font-size:10.5px;text-transform:uppercase;">
                    <th align="left" style="padding:7px 8px;">Sucursal</th>
                    <th align="left" style="padding:7px 8px;">Gerente / Supervisor</th>
                    <th align="center" style="padding:7px 8px;">Hourly</th>
                    <th align="center" style="padding:7px 8px;">OK</th>
                    <th align="center" style="padding:7px 8px;">Sin Tarifa ($0)</th>
                    <th align="center" style="padding:7px 8px;">Desfasados</th>
                    <th align="center" style="padding:7px 8px;">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeSummaryRowsHtml}
                </tbody>
              </table>

              ${
                allClean
                  ? `<div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;color:#14532d;font-size:13px;">
                      Todas las sucursales auditadas tienen el 100% de sus colaboradores por hora con tarifas en Toast POS idénticas a Simplify HR.
                     </div>`
                  : `<h3 style="margin:16px 0 8px 0;font-size:13px;text-transform:uppercase;color:#991b1b;">
                      🔎 Detalle de Discrepancias Detectadas (${report.totalDiscrepancies})
                     </h3>
                     <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #cbd5e1;">
                       <thead>
                         <tr bgcolor="#334155" style="background-color:#334155;color:#ffffff;font-size:10.5px;text-transform:uppercase;">
                           <th align="left" style="padding:7px;">Sucursal</th>
                           <th align="left" style="padding:7px;">Colaborador</th>
                           <th align="left" style="padding:7px;">Puesto Toast (30d)</th>
                           <th align="center" style="padding:7px;">Toast POS</th>
                           <th align="center" style="padding:7px;">Simplify HR</th>
                           <th align="left" style="padding:7px;">Diferencia / Estado</th>
                         </tr>
                       </thead>
                       <tbody>
                         ${detailRowsHtml}
                       </tbody>
                     </table>`
              }

              <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#64748b;">
                <strong>Sucursales al 100% (${orderedCleanStores.length}):</strong> ${escapeHtml(orderedCleanStores.join(', ') || 'Ninguna')}<br/>
                <strong>Exclusión de Asalariados:</strong> ${report.totalSimplifySalariedExcluded} Managers/Supervisores asalariados excluidos automáticamente del reporte.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Ejecuta la auditoría semanal en vivo de salarios por hora entre Simplify HR OS y Toast POS.
 */
export async function runEmployeeWageAudit(
  options: EmployeeWageAuditOptions = {}
): Promise<EmployeeWageAuditReport> {
  const startedAtMs = Date.now()
  const now = new Date()
  const dateLA = getLosAngelesDateISO(now)

  const dryRun = Boolean(options.dryRun)
  const force = Boolean(options.force)
  const rawStoreFilter =
    options.storeId !== undefined && options.storeId !== null && String(options.storeId).trim() !== ''
      ? String(options.storeId).trim()
      : null
  const testTo = options.testTo && String(options.testTo).trim() ? String(options.testTo).trim() : null

  // 1. Verificar idempotencia cuando es corrida automática de cadena completa
  const { rowId: existingStateId, state: storedState } = await loadWageAuditState()
  if (
    !dryRun &&
    !force &&
    !testTo &&
    !rawStoreFilter &&
    storedState.lastDispatchedDateLA === dateLA
  ) {
    return {
      executedAt: now.toISOString(),
      dateLA,
      durationMs: Date.now() - startedAtMs,
      dryRun: false,
      force: false,
      skippedDuplicateSameDay: true,
      filteredStoreId: null,
      testTo: null,
      totalStoresAudited: 0,
      totalSimplifyActiveHourly: 0,
      totalSimplifySalariedExcluded: 0,
      totalToastActiveEmployees: 0,
      totalMatchedHourlyEmployees: 0,
      totalCompliantEmployees: 0,
      totalAffectedEmployees: 0,
      totalDiscrepancies: 0,
      totalMissingWage: 0,
      totalMismatchWage: 0,
      affectedStoresCount: 0,
      cleanStoresCount: 0,
      cleanStores: [],
      managerEmailsSent: 0,
      executiveEmailSent: false,
      executiveEmailHtmlBytes: 0,
      stores: [],
    }
  }

  // 2. Pre-flight Fail-Fast: validar tokens de Simplify HR y Toast POS antes de auditar
  await Promise.all([getSimplifyHrAuthToken(force), getToastLaborAuthToken(force)])

  // 3. Consultar tiendas activas, usuarios (Managers/Supervisores) y mapeos manuales en Supabase
  const [
    { data: storesData, error: storesErr },
    { data: usersData, error: usersErr },
    { data: ronosMappingsData, error: mappingsErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('stores')
      .select('id, code, name, external_id, supervisor_id, is_active')
      .eq('is_active', true)
      .order('id'),
    supabaseAdmin
      .from('users')
      .select('id, full_name, email, role, is_active, store_id, store_scope'),
    supabaseAdmin
      .from('ronos_employee_mappings')
      .select('ronos_company_id, ronos_full_name, toast_guid, is_confirmed, mapping_type')
      .eq('is_confirmed', true),
  ])

  if (storesErr) throw new Error(`Error consultando stores: ${storesErr.message}`)
  if (usersErr) throw new Error(`Error consultando users: ${usersErr.message}`)
  if (mappingsErr) {
    console.warn(`[WageAudit] Advertencia consultando ronos_employee_mappings: ${mappingsErr.message}`)
  }

  const allUsers = usersData || []
  const allMappings = ronosMappingsData || []

  // Filtrar las 15 tiendas activas con Toast POS (`external_id` válido y mapeadas a Simplify HR)
  let targetStores = (storesData || []).filter((s: any) => Boolean(s.external_id))
  if (rawStoreFilter) {
    const normFilter = rawStoreFilter.toLowerCase()
    targetStores = targetStores.filter(
      (s: any) =>
        String(s.id) === rawStoreFilter ||
        String(s.code || '').toLowerCase() === normFilter ||
        String(s.external_id || '').toLowerCase() === normFilter
    )
    if (targetStores.length === 0) {
      throw new Error(`No se encontró ninguna sucursal activa para store_id="${rawStoreFilter}"`)
    }
  }

  // 4. Consultar ponchadas reales de los últimos 30 días en `punches` EN PARALELO con la extracción en vivo Simplify HR + Toast POS
  const thirtyDaysAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const cutoff30dISO = getLosAngelesDateISO(thirtyDaysAgoDate)
  const targetExternalIds = targetStores.map((s: any) => String(s.external_id))

  interface RawStoreLiveBundle {
    store: any
    ronosCompanyId: number
    simplifySiteId: string
    managerName: string
    managerEmail: string
    supervisorName: string
    supervisorEmail: string
    simplifyHourlyEmployees: SimplifyHrEmployeeRecord[]
    simplifySalariedExcludedCount: number
    toastJobsMap: Map<string, LiveToastJobRecord>
    toastActiveEmployees: LiveToastEmployeeRecord[]
  }

  const resolveStoreLeadership = (store: any) => {
    const supervisor = allUsers.find(
      (u: any) =>
        u.id === store.supervisor_id &&
        !EXCLUDED_LEADERSHIP_EMAILS.has(String(u.email || '').trim().toLowerCase())
    )
    const storeManager = allUsers.find((u: any) => {
      if (!u.is_active) return false
      const role = String(u.role || '').trim().toLowerCase()
      if (role !== 'manager' && role !== 'gerente') return false
      const email = String(u.email || '').trim().toLowerCase()
      if (!email || EXCLUDED_LEADERSHIP_EMAILS.has(email)) return false
      const fullName = String(u.full_name || '').toLowerCase()
      if (/\b(asst|assist|asistente|shift)\b/i.test(fullName)) return false
      return (
        u.store_id === store.id ||
        (Array.isArray(u.store_scope) &&
          (u.store_scope.includes(store.code) || u.store_scope.includes(String(store.id))))
      )
    })

    const supervisorName = supervisor?.full_name || 'Supervisor de Zona'
    const supervisorEmail = supervisor?.email || 'carlos@tacosgavilan.com'
    const managerName = storeManager?.full_name || `Gerente ${store.name}`
    const managerEmail = storeManager?.email || supervisorEmail

    return { managerName, managerEmail, supervisorName, supervisorEmail }
  }

  const [recentPunches, liveBundles] = await Promise.all([
    fetchAllPaginated((from, to) =>
      supabaseAdmin
        .from('punches')
        .select('store_id, employee_toast_guid, job_toast_guid, business_date')
        .in('store_id', targetExternalIds)
        .gte('business_date', cutoff30dISO)
        .order('toast_id', { ascending: true })
        .range(from, to)
    ),
    mapConcurrent(targetStores, 5, async (store: any) => {
      const ronosMeta = RONOS_STORES_MAP.find((r) => r.tegStoreId === store.id)
      const ronosCompanyId = ronosMeta?.ronosCompanyId || 0
      const simplifySiteId = ronosCompanyId ? RONOS_TO_SIMPLIFY_SITE_MAP[ronosCompanyId] : ''
      if (!simplifySiteId) {
        throw new Error(
          `La sucursal ${formatStoreDisplayName(store) || store.name} no tiene siteId configurado en RONOS_TO_SIMPLIFY_SITE_MAP`
        )
      }

      const [simplifyExtraction, toastJobsMap, toastActiveEmployees] = await Promise.all([
        extractAllSimplifyHrSalaries(simplifySiteId, 6, false),
        fetchLiveToastStoreJobs(String(store.external_id)),
        fetchLiveToastStoreEmployees(String(store.external_id)),
      ])

      const activeSimplifyEmployees = (simplifyExtraction.employees || []).filter(
        (e) => String(e.status || '').toLowerCase() === 'active'
      )

      const simplifyHourlyEmployees: SimplifyHrEmployeeRecord[] = []
      let simplifySalariedExcludedCount = 0

      for (const emp of activeSimplifyEmployees) {
        if (isSimplifyEmployeeHourlyAuditTarget(emp)) {
          simplifyHourlyEmployees.push(emp)
        } else {
          simplifySalariedExcludedCount++
        }
      }

      const { managerName, managerEmail, supervisorName, supervisorEmail } =
        resolveStoreLeadership(store)

      return {
        store,
        ronosCompanyId,
        simplifySiteId,
        managerName,
        managerEmail,
        supervisorName,
        supervisorEmail,
        simplifyHourlyEmployees,
        simplifySalariedExcludedCount,
        toastJobsMap,
        toastActiveEmployees,
      } satisfies RawStoreLiveBundle
    }),
  ])

  // Índice: storeExternalId -> employeeToastGuid -> jobToastGuid -> punchCount
  const punchesByStoreEmpJob = new Map<string, Map<string, Map<string, number>>>()
  for (const pu of recentPunches) {
    const storeExt = String(pu.store_id || '')
    const empGuid = String(pu.employee_toast_guid || '')
    const jobGuid = String(pu.job_toast_guid || '')
    if (!storeExt || !empGuid || !jobGuid) continue

    let empMap = punchesByStoreEmpJob.get(storeExt)
    if (!empMap) {
      empMap = new Map()
      punchesByStoreEmpJob.set(storeExt, empMap)
    }
    let jobMap = empMap.get(empGuid)
    if (!jobMap) {
      jobMap = new Map()
      empMap.set(empGuid, jobMap)
    }
    jobMap.set(jobGuid, (jobMap.get(jobGuid) || 0) + 1)
  }

  // Construir padrón global de empleados Hourly de Simplify HR para salvaguarda de préstamos multi-tienda
  const globalSimplifyHourlyByEmail = new Map<
    string,
    Array<{ emp: SimplifyHrEmployeeRecord; homeStoreName: string; homeStoreId: number }>
  >()
  const globalSimplifyHourlyByNormName = new Map<
    string,
    Array<{ emp: SimplifyHrEmployeeRecord; homeStoreName: string; homeStoreId: number }>
  >()

  for (const b of liveBundles) {
    const label = formatStoreDisplayName(b.store) || b.store.name
    for (const se of b.simplifyHourlyEmployees) {
      for (const rawE of [se.notificationEmail, se.emailAddress]) {
        const cleanE = cleanMatchableEmail(rawE)
        if (cleanE) {
          const arr = globalSimplifyHourlyByEmail.get(cleanE) || []
          arr.push({ emp: se, homeStoreName: label, homeStoreId: b.store.id })
          globalSimplifyHourlyByEmail.set(cleanE, arr)
        }
      }
      const normN = normalizePersonName(se.fullName || `${se.firstName} ${se.lastName}`)
      if (normN) {
        const arr = globalSimplifyHourlyByNormName.get(normN) || []
        arr.push({ emp: se, homeStoreName: label, homeStoreId: b.store.id })
        globalSimplifyHourlyByNormName.set(normN, arr)
      }
    }
  }

  // 6. Emparejar empleados y evaluar tarifas por tienda
  const storeSummaries: StoreWageAuditSummary[] = []

  for (const bundle of liveBundles) {
    const {
      store,
      ronosCompanyId,
      simplifySiteId,
      managerName,
      managerEmail,
      supervisorName,
      supervisorEmail,
      simplifyHourlyEmployees,
      simplifySalariedExcludedCount,
      toastJobsMap,
      toastActiveEmployees,
    } = bundle

    const storeLabel = formatStoreDisplayName(store) || store.name
    const storeExtId = String(store.external_id)
    const storePunchMap = punchesByStoreEmpJob.get(storeExtId) || new Map()

    const storeMappings = allMappings.filter(
      (m: any) => Number(m.ronos_company_id) === ronosCompanyId
    )

    const { matchedPairs, unmatchedToast } = matchStoreEmployeesSimplifyToToast({
      simplifyHourlyEmployees,
      toastActiveEmployees,
      confirmedRonosMappings: storeMappings,
    })

    // Salvaguarda multi-tienda: si un empleado de Toast no hizo match local pero tiene ponchadas 30d en esta sucursal
    if (liveBundles.length > 1) {
      for (const ut of unmatchedToast) {
        const empPunches = storePunchMap.get(ut.guid)
        if (!empPunches || empPunches.size === 0) continue

        let loanMatch: { emp: SimplifyHrEmployeeRecord; homeStoreName: string } | null = null
        const cleanE = cleanMatchableEmail(ut.email)
        if (cleanE) {
          const emailCands = (globalSimplifyHourlyByEmail.get(cleanE) || []).filter(
            (c) => c.homeStoreId !== store.id
          )
          if (emailCands.length === 1) {
            loanMatch = emailCands[0]
          }
        }
        if (!loanMatch) {
          const normT = normalizePersonName(`${ut.firstName} ${ut.lastName}`)
          const nameCands = (globalSimplifyHourlyByNormName.get(normT) || []).filter(
            (c) => c.homeStoreId !== store.id
          )
          if (nameCands.length === 1) {
            loanMatch = nameCands[0]
          }
        }

        if (loanMatch) {
          matchedPairs.push({
            simplifyEmp: loanMatch.emp,
            toastEmp: ut,
            matchMethod: 'cross_store_loan',
            isCrossStoreLoan: true,
            homeStoreName: loanMatch.homeStoreName,
          })
        }
      }
    }

    const storeDiscrepancies: EmployeeJobWageDiscrepancy[] = []
    let compliantEmployeesCount = 0
    let affectedEmployeesCount = 0

    for (const pair of matchedPairs) {
      const empJobPunches = storePunchMap.get(pair.toastEmp.guid) || new Map<string, number>()
      const evalRes = evaluateMatchedEmployeeJobWages({
        storeId: store.id,
        storeCode: store.code,
        storeName: storeLabel,
        pair,
        jobsMap: toastJobsMap,
        punchesByJobGuid: empJobPunches,
      })

      if (evalRes.discrepancies.length === 0) {
        compliantEmployeesCount++
      } else {
        affectedEmployeesCount++
        storeDiscrepancies.push(...evalRes.discrepancies)
      }
    }

    storeDiscrepancies.sort((a, b) => {
      if (a.discrepancyType !== b.discrepancyType) {
        return a.discrepancyType === 'MISSING_TOAST_WAGE' ? -1 : 1
      }
      return a.toastFullName.localeCompare(b.toastFullName)
    })

    const missingWageCount = storeDiscrepancies.filter(
      (d) => d.discrepancyType === 'MISSING_TOAST_WAGE'
    ).length
    const mismatchWageCount = storeDiscrepancies.filter(
      (d) => d.discrepancyType === 'WAGE_MISMATCH'
    ).length

    const summary: StoreWageAuditSummary = {
      storeId: store.id,
      storeCode: store.code,
      storeName: storeLabel,
      storeExternalId: storeExtId,
      ronosCompanyId,
      simplifySiteId,
      managerName,
      managerEmail,
      supervisorName,
      supervisorEmail,
      simplifyActiveHourlyCount: simplifyHourlyEmployees.length,
      simplifySalariedExcludedCount,
      toastActiveEmployeesCount: toastActiveEmployees.length,
      matchedHourlyEmployeesCount: matchedPairs.length,
      compliantEmployeesCount,
      affectedEmployeesCount,
      discrepanciesCount: storeDiscrepancies.length,
      missingWageCount,
      mismatchWageCount,
      discrepancies: storeDiscrepancies,
      managerEmailSent: false,
      managerEmailHtmlBytes: 0,
    }

    if (storeDiscrepancies.length > 0) {
      const html = buildStoreManagerWageAuditEmailHtml(summary, dateLA)
      summary.managerEmailHtmlBytes = Buffer.byteLength(html, 'utf8')
    }

    storeSummaries.push(summary)
  }

  storeSummaries.sort((a, b) => compareStoreNamesAlphabetically(a.storeName, b.storeName))

  const totalSimplifyActiveHourly = storeSummaries.reduce(
    (acc, s) => acc + s.simplifyActiveHourlyCount,
    0
  )
  const totalSimplifySalariedExcluded = storeSummaries.reduce(
    (acc, s) => acc + s.simplifySalariedExcludedCount,
    0
  )
  const totalToastActiveEmployees = storeSummaries.reduce(
    (acc, s) => acc + s.toastActiveEmployeesCount,
    0
  )
  const totalMatchedHourlyEmployees = storeSummaries.reduce(
    (acc, s) => acc + s.matchedHourlyEmployeesCount,
    0
  )
  const totalCompliantEmployees = storeSummaries.reduce(
    (acc, s) => acc + s.compliantEmployeesCount,
    0
  )
  const totalAffectedEmployees = storeSummaries.reduce(
    (acc, s) => acc + s.affectedEmployeesCount,
    0
  )
  const totalDiscrepancies = storeSummaries.reduce((acc, s) => acc + s.discrepanciesCount, 0)
  const totalMissingWage = storeSummaries.reduce((acc, s) => acc + s.missingWageCount, 0)
  const totalMismatchWage = storeSummaries.reduce((acc, s) => acc + s.mismatchWageCount, 0)

  const affectedStores = storeSummaries.filter((s) => s.discrepanciesCount > 0)
  const cleanStores = storeSummaries
    .filter((s) => s.discrepanciesCount === 0)
    .map((s) => s.storeName)

  const report: EmployeeWageAuditReport = {
    executedAt: now.toISOString(),
    dateLA,
    durationMs: Date.now() - startedAtMs,
    dryRun,
    force,
    skippedDuplicateSameDay: false,
    filteredStoreId: rawStoreFilter,
    testTo,
    totalStoresAudited: storeSummaries.length,
    totalSimplifyActiveHourly,
    totalSimplifySalariedExcluded,
    totalToastActiveEmployees,
    totalMatchedHourlyEmployees,
    totalCompliantEmployees,
    totalAffectedEmployees,
    totalDiscrepancies,
    totalMissingWage,
    totalMismatchWage,
    affectedStoresCount: affectedStores.length,
    cleanStoresCount: cleanStores.length,
    cleanStores,
    managerEmailsSent: 0,
    executiveEmailSent: false,
    executiveEmailHtmlBytes: 0,
    stores: storeSummaries,
  }

  const execHtml = buildExecutiveWageAuditSummaryEmailHtml(report)
  report.executiveEmailHtmlBytes = Buffer.byteLength(execHtml, 'utf8')
  report.durationMs = Date.now() - startedAtMs

  if (dryRun) {
    return report
  }

  // 7. Despacho de correos a Gerentes de Tienda (To) + Supervisor de Zona (CC) en tiendas con discrepancias
  for (const storeSummary of affectedStores) {
    const html = buildStoreManagerWageAuditEmailHtml(storeSummary, dateLA)
    storeSummary.managerEmailHtmlBytes = Buffer.byteLength(html, 'utf8')

    const subjectPrefix = testTo ? '[SIMULACIÓN GERENTE] ' : ''
    const subject = `${subjectPrefix}💲 Acción Requerida: Actualizar Salarios en Toast POS (vs Simplify HR) — ${storeSummary.storeName}`

    const toHeader = testTo
      ? testTo
      : `"${storeSummary.managerName}" <${storeSummary.managerEmail}>`
    const ccHeader =
      testTo ||
      !storeSummary.supervisorEmail ||
      storeSummary.supervisorEmail.toLowerCase() === storeSummary.managerEmail.toLowerCase()
        ? undefined
        : `"${storeSummary.supervisorName}" <${storeSummary.supervisorEmail}>`

    const sent = await sendSystemEmail({
      fromName: 'Sistema de Monitoreo',
      to: toHeader,
      cc: ccHeader,
      subject,
      html,
    })

    storeSummary.managerEmailSent = true
    storeSummary.managerEmailMessageId = sent.messageId
    report.managerEmailsSent++
    await sleep(300)
  }

  // 8. Despacho del Resumen Ejecutivo Semanal Consolidado (cuando se audita toda la cadena)
  if (!rawStoreFilter) {
    const execPrefix = testTo ? '[SIMULACIÓN EJECUTIVO] ' : ''
    const execSubject =
      report.totalDiscrepancies === 0
        ? `${execPrefix}✅ Auditoría Semanal de Salarios (Simplify HR vs Toast POS): 100% Sincronizados (${dateLA})`
        : `${execPrefix}💲 Resumen Ejecutivo Semanal de Salarios (Simplify HR vs Toast POS): ${report.totalDiscrepancies} discrepancias en ${report.affectedStoresCount} sucursales (${dateLA})`

    const finalExecHtml = buildExecutiveWageAuditSummaryEmailHtml(report)
    report.executiveEmailHtmlBytes = Buffer.byteLength(finalExecHtml, 'utf8')

    const sentExec = await sendSystemEmail({
      fromName: 'Sistema de Monitoreo',
      to: testTo ? testTo : WAGE_AUDIT_EXECUTIVE_TO.join(', '),
      cc:
        testTo || WAGE_AUDIT_EXECUTIVE_CC.length === 0
          ? undefined
          : WAGE_AUDIT_EXECUTIVE_CC.join(', '),
      subject: execSubject,
      html: finalExecHtml,
    })

    report.executiveEmailSent = true
    report.executiveEmailMessageId = sentExec.messageId
  }

  // 9. Guardar estado de idempotencia en `integrations` (salvo cuando es prueba a `testTo` o tienda individual)
  if (!testTo && !rawStoreFilter) {
    await saveWageAuditState(existingStateId, {
      lastDispatchedDateLA: dateLA,
      lastRunAt: new Date().toISOString(),
      lastSummary: {
        totalStoresAudited: report.totalStoresAudited,
        totalMatchedHourlyEmployees: report.totalMatchedHourlyEmployees,
        totalDiscrepancies: report.totalDiscrepancies,
        affectedStoresCount: report.affectedStoresCount,
      },
    })
  }

  report.durationMs = Date.now() - startedAtMs
  return report
}
