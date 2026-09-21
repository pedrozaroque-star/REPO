/**
 * @module lib/ronos-mapping
 * @description Motor de Mapeo y Vinculación entre Empleados de RONOS y Toast (Planificador).
 *   - REGLA OBLIGATORIA: Solo se permite vínculo automático ('auto') cuando existe un identificador
 *     nativo unívoco: assignmentId, employee ID o PIN único validado en tienda y período.
 *   - Similitudes de nombres: NUNCA crean auto-vinculación en BD ni en memoria; solo se presentan
 *     como sugerencias visuales en la cola de revisión manual supervisada.
 *   - Persistencia real de Inactivo (is_active: false, mapping_type: 'inactive') y Desvincular (toast_employee_id: null).
 *   - Detección de traslados multi-tienda limitada exclusivamente a colaboradores con horas reales trabajadas
 *     (hours > 0) en la tienda secundaria dentro del período visible seleccionado (no arrastra traslados históricos sin horas).
 *   - Paginación completa: Sin truncamiento en 100 empleados en RONOS ni en 1000 en Supabase.
 *
 * @businessRules
 *   - Los colaboradores no vinculados se dirigen a la Cola de Revisión Manual Supervisada.
 *   - Cada sugerencia muestra: empleado RONOS, candidato Toast, tienda, período, identificador nativo, evidencia y 3 acciones (Confirmar, Descartar, Cancelar).
 *   - Ningún cambio de selector debe auto-guardar sin confirmación explícita del usuario.
 *   - Traslados: Solo se detectan si hay ponchadas reales (total_weekly_hours > 0) en otra sucursal en la semana auditada.
 *
 * @dataFlow
 *   RONOS API (paginada sin límite de 100) -> Supabase ronos_employee_mappings + toast_employees -> UI Mapeo & Cola de Revisión.
 *
 * @notes
 *   - Maneja caché en memoria para transferencias con TTL de 4 horas para reducir llamadas redundantes al API de RONOS.
 *   - Prohíbe terminantemente auto-vincular por similitud de nombres; las coincidencias son únicamente sugerencias humanas.
 */

import { supabaseAdmin } from './supabase'
import { callRonosApi, RONOS_STORES_MAP, getRonosWeeks, getRonosWeekEmployees, mapConcurrent } from './ronos-api'

// ==========================================
// CACHÉ EN MEMORIA PARA DETECCIÓN DE TRASLADOS
// TTL: 4 horas. Se refresca automáticamente cuando expira o bajo demanda.
// ==========================================
const TRANSFER_CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 horas

interface TransferCacheEntry {
  transfers: Map<number, { storeName: string; hours: number }>
  scannedAt: number
  zeroHoursCount: number
  weekId?: number
}

// Cache global: ronosCompanyId -> TransferCacheEntry
const transferCache = new Map<number, TransferCacheEntry>()

/**
 * Escanea tiendas de RONOS para detectar traslados basados en ponchadas reales en la semana visible.
 * Para empleados con 0 horas en la tienda actual, verifica si están ponchando en otra tienda.
 * Solo considera colaboradores con horas trabajadas (hours > 0) en el período auditado.
 */
export async function refreshTransferCache(
  ronosCompanyId: number,
  zeroHoursUserIds: number[],
  targetWeekId?: number
): Promise<Map<number, { storeName: string; hours: number }>> {
  if (zeroHoursUserIds.length === 0) {
    const empty = new Map<number, { storeName: string; hours: number }>()
    transferCache.set(ronosCompanyId, { transfers: empty, scannedAt: Date.now(), zeroHoursCount: 0, weekId: targetWeekId })
    return empty
  }

  const otherStores = RONOS_STORES_MAP.filter(s => s.ronosCompanyId !== ronosCompanyId && !s.isBodega)

  const crossStoreResults = await mapConcurrent(
    otherStores,
    4,
    async (store) => {
      try {
        let weekIdsToQuery: number[] = []
        if (targetWeekId) {
          weekIdsToQuery = [targetWeekId]
        } else {
          const weeks = await getRonosWeeks(store.ronosCompanyId)
          if (!weeks[0]) return { store, employees: [] as any[] }
          weekIdsToQuery = [weeks[0].weekId]
        }

        const allEmployees: any[] = []
        for (const wId of weekIdsToQuery) {
          const rawEmps = await getRonosWeekEmployees(store.ronosCompanyId, wId)
          allEmployees.push(...rawEmps)
        }
        return { store, employees: allEmployees }
      } catch {
        return { store, employees: [] as any[] }
      }
    }
  )

  // Construir mapa: employeeUserId -> { storeName, hours } (estrictamente hours > 0)
  const crossStoreMap = new Map<number, { storeName: string; hours: number }>()
  const zeroHoursSet = new Set(zeroHoursUserIds)

  crossStoreResults.forEach(result => {
    if (!result) return
    const { store, employees } = result
    employees.forEach((emp: any) => {
      const uId = Number(emp.employeeUserId || emp.userId)
      if (!zeroHoursSet.has(uId)) return

      const hours = Number(emp.totalWeeklyHour || 0)
      if (hours > 0) {
        const existing = crossStoreMap.get(uId)
        if (!existing || hours > existing.hours) {
          crossStoreMap.set(uId, { storeName: store.tegName, hours })
        }
      }
    })
  })

  // Guardar en caché
  transferCache.set(ronosCompanyId, {
    transfers: crossStoreMap,
    scannedAt: Date.now(),
    zeroHoursCount: zeroHoursUserIds.length,
    weekId: targetWeekId
  })

  return crossStoreMap
}

/**
 * Obtiene los traslados detectados desde la Base de Datos Supabase (ronos_employee_timecards_cache)
 * para colaboradores que tengan HORAS REALES TRABAJADAS (> 0) en otra sucursal durante el período visible.
 *
 * REGLA: No arrastra traslados históricos ni registros con 0 horas.
 */
async function getTransferData(
  ronosCompanyId: number,
  zeroHoursUserIds: number[],
  targetWeekId?: number
): Promise<Map<number, { storeName: string; hours: number }>> {
  if (zeroHoursUserIds.length === 0) return new Map()

  const storeByCompany = new Map<number, string>()
  RONOS_STORES_MAP.forEach(s => storeByCompany.set(s.ronosCompanyId, s.tegName))

  const resultsMap = new Map<number, { storeName: string; hours: number }>()

  try {
    // 1. Consultar BD Supabase: buscar ponchadas con horas reales en otras tiendas en el período visible
    let query = supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('employee_user_id, company_id, total_weekly_hours, week_id')
      .in('employee_user_id', zeroHoursUserIds)
      .neq('company_id', ronosCompanyId)
      .gt('total_weekly_hours', 0)

    if (targetWeekId) {
      query = query.eq('week_id', targetWeekId)
    } else {
      query = query.order('week_id', { ascending: false })
    }

    const { data: dbCards, error: dbErr } = await query

    if (!dbErr && dbCards && dbCards.length > 0) {
      dbCards.forEach(card => {
        const uId = Number(card.employee_user_id)
        const hours = Number(card.total_weekly_hours)
        if (hours > 0 && !resultsMap.has(uId)) {
          const storeName = storeByCompany.get(card.company_id) || `Company ${card.company_id}`
          resultsMap.set(uId, { storeName, hours })
        }
      })
    }
  } catch (err) {
    console.warn('Error querying Supabase transfer cache:', err)
  }

  // 2. Si no se encontraron datos en BD para algún colaborador, verificar caché en memoria si coincide la semana
  const cached = transferCache.get(ronosCompanyId)
  if (cached && (targetWeekId === undefined || cached.weekId === targetWeekId)) {
    cached.transfers.forEach((val, key) => {
      if (!resultsMap.has(key) && val.hours > 0) {
        resultsMap.set(key, val)
      }
    })
  }

  return resultsMap
}

export interface RonosRawEmployee {
  employeeUserId?: number
  userId?: number
  employeeId?: number
  firstName?: string
  lastName?: string
  pin?: string
  title?: string
  jobTitle?: string
  departmentName?: string
  active?: boolean
  totalWeeklyHour?: number
  assignmentId?: string
  ronos_assignment_id?: string
}

export interface ToastEmployeeCandidate {
  id: string
  toast_guid: string
  first_name: string
  last_name: string
  full_name: string
  email: string
  phone: string | null
  job_title?: string
  store_ids: string[]
  passcode?: string | null
  external_employee_id?: string | null
  external_id?: string | null
}

export interface RonosMappedEmployee {
  ronosEmployeeUserId: number
  ronosEmployeeId: number
  ronosCompanyId: number
  ronosFullName: string
  ronosFirstName: string
  ronosLastName: string
  ronosPin: string
  ronosJobTitle: string
  toastEmployeeId: string | null
  toastGuid: string | null
  toastFullName: string | null
  toastEmail: string | null
  toastPhone: string | null
  toastJobTitle: string | null
  mappingType: 'auto' | 'manual' | 'inactive' | 'unmapped'
  isConfirmed: boolean
  confidenceScore: number
  transferredToStore?: string | null
  // Propiedades para cola de revisión manual supervisada
  suggestedCandidate?: ToastEmployeeCandidate | null
  suggestedReason?: string | null
  nativeIdentifier?: string | null
  evidence?: string | null
  similarityScore?: number
  storeName?: string | null
  periodLabel?: string | null
  isActive?: boolean
}

/**
 * Calcula la distancia de Levenshtein entre dos cadenas para tolerancia a erratas (typos)
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

/**
 * Normaliza cadenas de texto para matching fonético y sin acentos
 */
export function normalizeForMatch(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * Calcula el puntaje de similitud entre dos nombres (0 a 100).
 * NOTA: Este puntaje se utiliza EXCLUSIVAMENTE para generar sugerencias visuales
 * en la cola de revisión humana. NUNCA se utiliza para auto-vincular.
 */
export function calculateNameSimilarity(ronosName: string, toastName: string): number {
  const normR = normalizeForMatch(ronosName)
  const normT = normalizeForMatch(toastName)

  if (!normR || !normT) return 0
  if (normR === normT) return 100

  // Si uno contiene al otro completamente
  if (normR.length >= 5 && normT.includes(normR)) return 95
  if (normT.length >= 5 && normR.includes(normT)) return 95

  // Comparación por palabras / tokens
  const tokensR = ronosName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean)
  const tokensT = toastName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean)

  if (tokensR.length === 0 || tokensT.length === 0) return 0

  let matches = 0
  tokensR.forEach(tr => {
    if (tokensT.some(tt => {
      if (tt === tr) return true
      if (tr.length >= 4 && tt.length >= 4 && (tt.includes(tr) || tr.includes(tt))) return true
      if (tr.length >= 4 && tt.length >= 4 && Math.abs(tr.length - tt.length) <= 1) {
        return levenshteinDistance(tr, tt) <= 1
      }
      return false
    })) {
      matches++
    }
  })

  const minTokens = Math.min(tokensR.length, tokensT.length)
  const maxTokens = Math.max(tokensR.length, tokensT.length)

  if (matches === minTokens && minTokens >= 2) {
    return 90
  }

  if (tokensR.length > 0) {
    const score = Math.round((matches / maxTokens) * 100)
    return score
  }

  return 0
}

/**
 * REGLA OBLIGATORIA:
 * Resuelve auto-vinculación ÚNICAMENTE cuando existe un identificador nativo unívoco:
 * 1. assignmentId (coincide unívocamente con external_employee_id, external_id o toast_guid).
 * 2. employeeId (número oficial de empleado coincide 1 a 1 de forma unívoca).
 * 3. PIN / Passcode (el PIN de checador coincide con passcode de Toast y es ÚNICO en toda la tienda).
 *
 * Retorna el candidato y la evidencia de identidad, o null si no hay identificador nativo unívoco.
 */
export function resolveNativeAutoMatch(
  rEmp: {
    employeeUserId?: number
    userId?: number
    employeeId?: number
    pin?: string
    assignmentId?: string
    ronos_assignment_id?: string
  },
  availableCandidates: ToastEmployeeCandidate[],
  storeCandidatesList: ToastEmployeeCandidate[]
): {
  matchedCandidate: ToastEmployeeCandidate
  matchedBy: 'assignmentId' | 'employeeId' | 'pin'
  identifierValue: string
  evidence: string
} | null {
  const rEmpId = Number(rEmp.employeeId || 0)
  const rPin = String(rEmp.pin || '').trim()
  const rAssignment = String(rEmp.assignmentId || rEmp.ronos_assignment_id || '').trim()

  // 1. Identificador nativo: assignmentId
  if (rAssignment && rAssignment !== '0' && rAssignment !== 'null' && rAssignment !== 'undefined') {
    const matches = availableCandidates.filter(c =>
      (c.external_employee_id && String(c.external_employee_id).trim() === rAssignment) ||
      (c.external_id && String(c.external_id).trim() === rAssignment) ||
      (c.toast_guid && String(c.toast_guid).trim() === rAssignment)
    )
    if (matches.length === 1) {
      return {
        matchedCandidate: matches[0],
        matchedBy: 'assignmentId',
        identifierValue: rAssignment,
        evidence: `Vínculo nativo por Assignment ID verificado (${rAssignment})`
      }
    }
  }

  // 2. Identificador nativo: employeeId
  if (rEmpId > 0) {
    const strEmpId = String(rEmpId)
    const matches = availableCandidates.filter(c =>
      (c.external_employee_id && String(c.external_employee_id).trim() === strEmpId) ||
      (c.external_id && String(c.external_id).trim() === strEmpId)
    )
    if (matches.length === 1) {
      return {
        matchedCandidate: matches[0],
        matchedBy: 'employeeId',
        identifierValue: strEmpId,
        evidence: `Vínculo nativo por Employee ID unívoco (${strEmpId})`
      }
    }
  }

  // 3. Identificador nativo: PIN / Passcode único verificado en la tienda
  if (rPin && rPin.length >= 3 && rPin !== '0000' && rPin !== '1234') {
    // Verificar si el PIN es único en TODA la plantilla de candidatos de la tienda
    const totalStoreWithPin = storeCandidatesList.filter(c => String(c.passcode || '').trim() === rPin)
    const availableWithPin = availableCandidates.filter(c => String(c.passcode || '').trim() === rPin)

    // Solo es unívoco si exactamente 1 persona en la tienda tiene este PIN y está libre
    if (totalStoreWithPin.length === 1 && availableWithPin.length === 1) {
      return {
        matchedCandidate: availableWithPin[0],
        matchedBy: 'pin',
        identifierValue: rPin,
        evidence: `Vínculo nativo por PIN unívoco validado en tienda (${rPin})`
      }
    }
  }

  return null
}

/**
 * Carga todos los mapeos guardados en Supabase usando paginación dinámica sin límite de 1000
 */
export async function getAllSavedMappings(ronosCompanyId?: number): Promise<any[]> {
  const allRows: any[] = []
  let from = 0
  const step = 1000
  let hasMore = true

  while (hasMore) {
    let query = supabaseAdmin
      .from('ronos_employee_mappings')
      .select('*')
      .range(from, from + step - 1)

    if (ronosCompanyId) {
      query = query.eq('ronos_company_id', ronosCompanyId)
    }

    const { data, error } = await query
    if (error || !data || data.length === 0) {
      hasMore = false
      break
    }

    allRows.push(...data)
    if (data.length < step) {
      hasMore = false
    } else {
      from += step
    }
  }

  return allRows
}

/**
 * Obtiene la lista completa de todos los empleados de Toast activos con sus puestos reales
 * Implementa paginación completa para no truncar la lista si excede 1000 colaboradores.
 */
export async function getAllToastEmployees(storeExternalId?: string): Promise<ToastEmployeeCandidate[]> {
  // 1. Obtener catálogo de puestos de toast_jobs
  const jobMap = new Map<string, string>()
  try {
    const { data: jobs } = await supabaseAdmin.from('toast_jobs').select('guid, title')
    if (jobs && Array.isArray(jobs)) {
      jobs.forEach(j => {
        if (j.guid && j.title) {
          jobMap.set(j.guid, j.title.trim())
        }
      })
    }
  } catch (err) {
    console.warn('Error fetching toast_jobs:', err)
  }

  // 2. Obtener empleados de Toast (solo activos) con paginación exhaustiva
  const allData: any[] = []
  let from = 0
  const step = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('toast_employees')
      .select('id, toast_guid, first_name, last_name, email, phone, passcode, external_employee_id, external_id, job_references, store_ids')
      .eq('deleted', false)
      .order('first_name', { ascending: true })
      .range(from, from + step - 1)

    if (error || !data || data.length === 0) {
      hasMore = false
      break
    }

    allData.push(...data)
    if (data.length < step) {
      hasMore = false
    } else {
      from += step
    }
  }

  // Filtrar por tienda si se especifica storeExternalId (incluyendo empleados corporativos con acceso multitienda)
  const filteredData = storeExternalId
    ? allData.filter(e => Array.isArray(e.store_ids) && (e.store_ids.includes(storeExternalId) || e.store_ids.length >= 10))
    : allData

  return filteredData.map(e => {
    let jobTitle = 'Colaborador'
    if (Array.isArray(e.job_references) && e.job_references.length > 0) {
      const jGuid = e.job_references[0]?.guid
      if (jGuid && jobMap.has(jGuid)) {
        jobTitle = jobMap.get(jGuid)!
      }
    }

    return {
      id: e.id,
      toast_guid: e.toast_guid,
      first_name: e.first_name || '',
      last_name: e.last_name || '',
      full_name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
      email: e.email || '',
      phone: e.phone || null,
      job_title: jobTitle,
      store_ids: Array.isArray(e.store_ids) ? e.store_ids : [],
      passcode: e.passcode || null,
      external_employee_id: e.external_employee_id || null,
      external_id: e.external_id || null
    }
  })
}

/**
 * Obtiene el mapeo completo de empleados ACTIVOS para una sucursal de RONOS.
 * - Solo auto-vincula con identificadores nativos unívocos (assignmentId, employeeId, PIN único).
 * - Los nombres similares NO auto-vinculan; se presentan como sugerencias visuales en la cola de revisión.
 * - Detección de traslados limitada estrictamente a horas reales en la semana visible.
 * - Paginación completa de empleados (sin truncar a 100).
 */
export async function getStoreEmployeeMappings(
  ronosCompanyId: number,
  targetWeekId?: number
): Promise<{
  mappings: RonosMappedEmployee[]
  toastCandidates: ToastEmployeeCandidate[]
  stats: {
    totalRonos: number
    autoMatched: number
    manuallyMatched: number
    inactive: number
    unmapped: number
  }
  storeName: string
  periodLabel: string
}> {
  const storeMeta = RONOS_STORES_MAP.find(s => s.ronosCompanyId === ronosCompanyId)
  const storeName = storeMeta?.tegName || `Tienda #${ronosCompanyId}`

  // Obtener UUID externo de la tienda en Supabase
  let storeExternalId: string | undefined = undefined
  if (storeMeta) {
    try {
      const { data: dbStore } = await supabaseAdmin
        .from('stores')
        .select('id, external_id')
        .or(`id.eq.${storeMeta.tegStoreId},code.eq.${storeMeta.tegCode}`)
        .single()

      if (dbStore?.external_id) {
        storeExternalId = dbStore.external_id
      }
    } catch (err) {
      console.warn('Error fetching store external_id:', err)
    }
  }

  // 1. Obtener candidatos de Toast filtrados para esta tienda (paginados completos)
  const allToastEmployees = await getAllToastEmployees(storeExternalId)

  // 2. Resolver semana de trabajo y etiqueta de período
  let resolvedWeekId: number | undefined = targetWeekId
  let periodLabel = targetWeekId ? `Semana #${targetWeekId}` : 'Semana Actual'
  try {
    const weeks = await getRonosWeeks(ronosCompanyId)
    if (weeks && weeks.length > 0) {
      const matchW = targetWeekId ? weeks.find(w => w.weekId === targetWeekId) : weeks[0]
      if (matchW) {
        resolvedWeekId = matchW.weekId
        periodLabel = matchW.startDate && matchW.endDate ? `${matchW.startDate.substring(0, 10)} - ${matchW.endDate.substring(0, 10)}` : `Semana #${matchW.weekId}`
      } else if (!resolvedWeekId && weeks[0]) {
        resolvedWeekId = weeks[0].weekId
        periodLabel = weeks[0].startDate && weeks[0].endDate ? `${weeks[0].startDate.substring(0, 10)} - ${weeks[0].endDate.substring(0, 10)}` : `Semana #${weeks[0].weekId}`
      }
    }
  } catch (err) {
    console.warn('Error fetching work weeks:', err)
  }

  // 3. Obtener empleados ACTIVOS de RONOS usando paginación exhaustiva (sin límite de 100)
  let ronosList: any[] = []
  if (resolvedWeekId) {
    try {
      const pagedEmployees = await getRonosWeekEmployees(ronosCompanyId, resolvedWeekId)
      ronosList = (pagedEmployees || []).filter((e: any) => e.active !== false)
    } catch (err) {
      console.warn('Error fetching active employees via getRonosWeekEmployees:', err)
    }
  }

  // Fallback si la semana está vacía
  if (ronosList.length === 0) {
    try {
      const rawEmployees = await callRonosApi<RonosRawEmployee[]>('Employee/GetEmployeesByCompany', {
        companyId: ronosCompanyId
      })
      ronosList = Array.isArray(rawEmployees) ? rawEmployees.filter(e => e.active !== false) : []
    } catch (err) {
      console.warn('Error fetching company employees fallback:', err)
    }
  }

  // 4. Obtener mapeos guardados en Supabase (paginación exhaustiva)
  const allSavedMappings = await getAllSavedMappings(ronosCompanyId)

  const savedMap = new Map<number, any>()
  const usedToastIds = new Set<string>()

  if (allSavedMappings && Array.isArray(allSavedMappings)) {
    allSavedMappings.forEach((m: any) => {
      const uId = Number(m.ronos_employee_user_id)
      savedMap.set(uId, m)
      if (m.toast_employee_id && m.mapping_type !== 'inactive' && m.mapping_type !== 'unmapped') {
        usedToastIds.add(m.toast_employee_id)
      }
    })
  }

  // 5. Detección de traslados multi-tienda:
  // REGLA: Exclusivamente colaboradores con 0 horas en la tienda actual que registren HORAS REALES (> 0)
  // en otra sucursal durante la semana visible auditada.
  const zeroHoursUserIds = ronosList
    .filter(e => (Number(e.totalWeeklyHour) || 0) === 0)
    .map(e => Number(e.employeeUserId || e.userId))

  const activeStoreByUserId = new Map<number, string>()
  if (zeroHoursUserIds.length > 0) {
    const transferData = await getTransferData(ronosCompanyId, zeroHoursUserIds, resolvedWeekId)
    transferData.forEach((data, uId) => {
      if (data.hours > 0) {
        activeStoreByUserId.set(uId, data.storeName)
      }
    })
  }

  let autoMatchedCount = 0
  let manuallyMatchedCount = 0
  let inactiveCount = 0
  let unmappedCount = 0

  const results: RonosMappedEmployee[] = []

  // Candidatos disponibles (que aún no han sido asignados permanentemente)
  const availableCandidates = allToastEmployees.filter(t => !usedToastIds.has(t.id))

  ronosList.forEach(rEmp => {
    const userId = Number(rEmp.employeeUserId || rEmp.userId)
    const fullName = `${rEmp.firstName || ''} ${rEmp.lastName || ''}`.trim()
    const saved = savedMap.get(userId)
    const transferredTo = activeStoreByUserId.get(userId) || null

    // Caso A: Mapeo guardado en base de datos
    if (saved) {
      // A.1: Inactivo explícito
      if (saved.mapping_type === 'inactive' || saved.is_active === false) {
        inactiveCount++
        results.push({
          ronosEmployeeUserId: userId,
          ronosEmployeeId: Number(rEmp.employeeId || 0),
          ronosCompanyId,
          ronosFullName: fullName,
          ronosFirstName: rEmp.firstName || '',
          ronosLastName: rEmp.lastName || '',
          ronosPin: rEmp.pin || '',
          ronosJobTitle: rEmp.title || 'Colaborador',
          toastEmployeeId: null,
          toastGuid: null,
          toastFullName: 'INACTIVO / NO LABORA',
          toastEmail: null,
          toastPhone: null,
          toastJobTitle: 'Inactivo',
          mappingType: 'inactive',
          isConfirmed: true,
          confidenceScore: 100,
          transferredToStore: transferredTo,
          storeName,
          periodLabel,
          isActive: false
        })
        return
      }

      // A.2: Desvinculado explícito en DB (toast_employee_id: null)
      if (!saved.toast_employee_id && saved.mapping_type === 'unmapped') {
        unmappedCount++
        // Buscar sugerencia visual de nombre para la cola humana (sin auto-vincular)
        let suggestedMatch: ToastEmployeeCandidate | null = null
        let bestScore = 0
        availableCandidates.forEach(tEmp => {
          const s = calculateNameSimilarity(fullName, tEmp.full_name)
          if (s > bestScore) {
            bestScore = s
            suggestedMatch = tEmp
          }
        })

        results.push({
          ronosEmployeeUserId: userId,
          ronosEmployeeId: Number(rEmp.employeeId || 0),
          ronosCompanyId,
          ronosFullName: fullName,
          ronosFirstName: rEmp.firstName || '',
          ronosLastName: rEmp.lastName || '',
          ronosPin: rEmp.pin || '',
          ronosJobTitle: rEmp.title || 'Colaborador',
          toastEmployeeId: null,
          toastGuid: null,
          toastFullName: null,
          toastEmail: null,
          toastPhone: null,
          toastJobTitle: null,
          mappingType: 'unmapped',
          isConfirmed: false,
          confidenceScore: 0,
          transferredToStore: transferredTo,
          suggestedCandidate: bestScore >= 70 ? suggestedMatch : null,
          suggestedReason: bestScore >= 70 ? `Sugerencia por similitud de nombre (${bestScore}%)` : null,
          evidence: bestScore >= 70 ? `Coincidencia de nombre al ${bestScore}%. Requiere confirmación humana explícita.` : 'Sin coincidencia de identidad.',
          similarityScore: bestScore,
          nativeIdentifier: null,
          storeName,
          periodLabel,
          isActive: true
        })
        return
      }

      // A.3: Vinculado confirmado en DB
      if (saved.toast_employee_id) {
        const toastMatch = allToastEmployees.find(t => t.id === saved.toast_employee_id)
        if (saved.mapping_type === 'manual') {
          manuallyMatchedCount++
        } else {
          autoMatchedCount++
        }

        results.push({
          ronosEmployeeUserId: userId,
          ronosEmployeeId: Number(rEmp.employeeId || 0),
          ronosCompanyId,
          ronosFullName: fullName,
          ronosFirstName: rEmp.firstName || '',
          ronosLastName: rEmp.lastName || '',
          ronosPin: rEmp.pin || '',
          ronosJobTitle: rEmp.title || 'Colaborador',
          toastEmployeeId: saved.toast_employee_id,
          toastGuid: saved.toast_guid || toastMatch?.toast_guid || null,
          toastFullName: saved.toast_full_name || toastMatch?.full_name || null,
          toastEmail: saved.toast_email || toastMatch?.email || null,
          toastPhone: toastMatch?.phone || null,
          toastJobTitle: toastMatch?.job_title || null,
          mappingType: saved.mapping_type as any,
          isConfirmed: saved.is_confirmed ?? true,
          confidenceScore: 100,
          transferredToStore: transferredTo,
          evidence: 'Mapeo verificado y persistido en base de datos.',
          storeName,
          periodLabel,
          isActive: true
        })
        return
      }
    }

    // Caso B: Colaborador sin mapeo en base de datos.
    // REGLA OBLIGATORIA: Intentar auto-vincular EXCLUSIVAMENTE mediante identificador nativo unívoco.
    const nativeMatch = resolveNativeAutoMatch(rEmp, availableCandidates, allToastEmployees)

    if (nativeMatch) {
      usedToastIds.add(nativeMatch.matchedCandidate.id)
      autoMatchedCount++
      results.push({
        ronosEmployeeUserId: userId,
        ronosEmployeeId: Number(rEmp.employeeId || 0),
        ronosCompanyId,
        ronosFullName: fullName,
        ronosFirstName: rEmp.firstName || '',
        ronosLastName: rEmp.lastName || '',
        ronosPin: rEmp.pin || '',
        ronosJobTitle: rEmp.title || 'Colaborador',
        toastEmployeeId: nativeMatch.matchedCandidate.id,
        toastGuid: nativeMatch.matchedCandidate.toast_guid,
        toastFullName: nativeMatch.matchedCandidate.full_name,
        toastEmail: nativeMatch.matchedCandidate.email,
        toastPhone: nativeMatch.matchedCandidate.phone,
        toastJobTitle: nativeMatch.matchedCandidate.job_title || null,
        mappingType: 'auto',
        isConfirmed: true,
        confidenceScore: 100,
        transferredToStore: transferredTo,
        nativeIdentifier: nativeMatch.identifierValue,
        evidence: nativeMatch.evidence,
        storeName,
        periodLabel,
        isActive: true
      })
      return
    }

    // Caso C: NO hay identificador nativo unívoco.
    // REGLA OBLIGATORIA: NUNCA auto-vincular por similitud de nombres.
    // El empleado queda como 'unmapped' y se añade a la Cola de Revisión Manual con sugerencia visual si aplica.
    unmappedCount++
    let suggestedMatch: ToastEmployeeCandidate | null = null
    let bestScore = 0

    availableCandidates.forEach(tEmp => {
      const score = calculateNameSimilarity(fullName, tEmp.full_name)
      if (score > bestScore) {
        bestScore = score
        suggestedMatch = tEmp
      }
    })

    const hasSuggestion = bestScore >= 70 && suggestedMatch !== null
    results.push({
      ronosEmployeeUserId: userId,
      ronosEmployeeId: Number(rEmp.employeeId || 0),
      ronosCompanyId,
      ronosFullName: fullName,
      ronosFirstName: rEmp.firstName || '',
      ronosLastName: rEmp.lastName || '',
      ronosPin: rEmp.pin || '',
      ronosJobTitle: rEmp.title || 'Colaborador',
      toastEmployeeId: null,
      toastGuid: null,
      toastFullName: null,
      toastEmail: null,
      toastPhone: null,
      toastJobTitle: null,
      mappingType: 'unmapped',
      isConfirmed: false,
      confidenceScore: 0,
      transferredToStore: transferredTo,
      suggestedCandidate: hasSuggestion ? suggestedMatch : null,
      suggestedReason: hasSuggestion ? `Sugerencia por similitud de nombre (${bestScore}%)` : null,
      evidence: hasSuggestion
        ? `Coincidencia de nombre al ${bestScore}%. Requiere confirmación humana explícita.`
        : 'Sin coincidencia de identificador nativo ni nombre similar.',
      similarityScore: bestScore,
      nativeIdentifier: null,
      storeName,
      periodLabel,
      isActive: true
    })
  })

  return {
    mappings: results.sort((a, b) => {
      // Prioridad: 1. Sin vincular (unmapped), 2. Vinculados (auto/manual), 3. Inactivos
      const order = { unmapped: 1, auto: 2, manual: 3, inactive: 4 }
      const diff = (order[a.mappingType] || 5) - (order[b.mappingType] || 5)
      if (diff !== 0) return diff
      return a.ronosFullName.localeCompare(b.ronosFullName)
    }),
    toastCandidates: allToastEmployees,
    stats: {
      totalRonos: ronosList.length,
      autoMatched: autoMatchedCount,
      manuallyMatched: manuallyMatchedCount,
      inactive: inactiveCount,
      unmapped: unmappedCount
    },
    storeName,
    periodLabel
  }
}

/**
 * Guarda o actualiza un mapeo de empleado en Supabase (manual, auto, inactivo o desvincular)
 * Garantiza persistencia real de inactivo (mapping_type: 'inactive') y desvincular (toast_employee_id: null).
 */
export async function saveEmployeeMapping(data: {
  ronosEmployeeUserId: number
  ronosEmployeeId?: number
  ronosCompanyId: number
  ronosFullName: string
  ronosPin?: string
  ronosJobTitle?: string
  toastEmployeeId: string | null
  toastGuid?: string | null
  toastFullName?: string | null
  toastEmail?: string | null
  mappingType?: 'auto' | 'manual' | 'inactive' | 'unmapped'
  isConfirmed?: boolean
  notes?: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const isInactive = data.mappingType === 'inactive' || data.toastEmployeeId === 'INACTIVE'
    const isUnlink = data.mappingType === 'unmapped' || data.toastEmployeeId === 'UNLINK' || (!isInactive && !data.toastEmployeeId)

    const cleanToastEmployeeId = (isInactive || isUnlink) ? null : data.toastEmployeeId
    const finalMappingType: 'auto' | 'manual' | 'inactive' | 'unmapped' = isInactive
      ? 'inactive'
      : isUnlink
      ? 'unmapped'
      : (data.mappingType === 'auto' ? 'auto' : 'manual')

    const cleanToastFullName = isInactive
      ? 'INACTIVO / NO LABORA'
      : isUnlink
      ? null
      : (data.toastFullName || null)

    const isConfirmed = isInactive ? true : (isUnlink ? false : (data.isConfirmed ?? true))

    const payload: any = {
      ronos_employee_user_id: data.ronosEmployeeUserId,
      ronos_employee_id: data.ronosEmployeeId || null,
      ronos_company_id: data.ronosCompanyId,
      ronos_full_name: data.ronosFullName,
      ronos_pin: data.ronosPin || null,
      ronos_job_title: data.ronosJobTitle || null,
      toast_employee_id: cleanToastEmployeeId,
      toast_guid: isInactive || isUnlink ? null : (data.toastGuid || null),
      toast_full_name: cleanToastFullName,
      toast_email: isInactive || isUnlink ? null : (data.toastEmail || null),
      mapping_type: finalMappingType,
      is_confirmed: isConfirmed,
      notes: isInactive
        ? (data.notes || 'Marcado inactivo en revisión manual')
        : (isUnlink ? (data.notes || 'Desvinculado manualmente') : (data.notes || null)),
      updated_at: new Date().toISOString()
    }

    // Intentar guardar con soporte para is_active si la columna existe en BD
    let upsertPayload = { ...payload, is_active: !isInactive }
    let { error } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .upsert(upsertPayload, {
        onConflict: 'ronos_employee_user_id,ronos_company_id'
      })

    // Si la columna is_active no existe aún en PostgreSQL (código 42703), reintentar sin ella
    if (error && (error.code === '42703' || error.message.includes('is_active'))) {
      const fallbackResult = await supabaseAdmin
        .from('ronos_employee_mappings')
        .upsert(payload, {
          onConflict: 'ronos_employee_user_id,ronos_company_id'
        })
      error = fallbackResult.error
    }

    if (error) {
      console.error('Error saving ronos_employee_mapping:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err: any) {
    console.error('Exception in saveEmployeeMapping:', err)
    return { success: false, error: err.message }
  }
}
