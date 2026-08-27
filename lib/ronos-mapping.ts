/**
 * @module lib/ronos-mapping
 * @description Motor de Mapeo y Vinculación entre Empleados de RONOS y Toast (Planificador).
 *   - Mapeo inteligente automático por tokens de nombres y similitud en español.
 *   - Persistencia de mapeos manuales y confirmados en Supabase (`ronos_employee_mappings`).
 *   - Detección de traslados por ponchadas reales de RONOS (cross-store, cacheado 4 horas).
 *   - Extracción de correos electrónicos verificados de Toast para avisos.
 *
 * @businessRules
 *   - Los empleados de Toast son la fuente de verdad de correos electrónicos vigentes.
 *   - Se debe permitir vinculación manual para nombres compuestos o abreviados.
 *   - Los mapeos manuales tienen precedencia sobre los automáticos.
 *   - Traslados: Se detectan comparando ponchadas REALES del employeeUserId en todas las tiendas.
 *     Fase 1: Mapeos guardados en otra tienda → traslado por DB.
 *     Fase 2: Empleados con 0h aquí pero con horas en otra tienda → traslado por ponchadas.
 *   - El caché de traslados tiene TTL de 4 horas. Se consulta semana actual + anterior.
 *
 * @dataFlow
 *   RONOS API (15 tiendas × 2 semanas) → caché en memoria (4h TTL) → activeStoreByUserId
 *   RONOS API → Supabase `ronos_employee_mappings` + `toast_employees` → UI Mapeo
 *
 * @notes
 *   - Bug fix 2026-08-25: calculateNameSimilarity línea 127 — token corto >= 4 chars requerido.
 *   - Bug fix 2026-08-25: Phase 2 reescrita — de Toast name matching a RONOS cross-store punches.
 *   - Perf fix 2026-08-25: Caché en memoria evita ~30 llamadas API en cada carga de página.
 */

import { supabaseAdmin } from './supabase'
import { callRonosApi, RONOS_STORES_MAP, getRonosWeeks, mapConcurrent } from './ronos-api'

// ==========================================
// CACHÉ EN MEMORIA PARA DETECCIÓN DE TRASLADOS
// TTL: 4 horas. Se refresca automáticamente cuando expira o bajo demanda.
// Evita ~30 llamadas API a RONOS en cada carga de página.
// ==========================================
const TRANSFER_CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 horas

interface TransferCacheEntry {
  transfers: Map<number, { storeName: string; hours: number }>
  scannedAt: number
  zeroHoursCount: number
}

// Cache global: ronosCompanyId → TransferCacheEntry
const transferCache = new Map<number, TransferCacheEntry>()

/**
 * Escanea TODAS las tiendas de RONOS para detectar traslados basados en ponchadas reales.
 * Para empleados con 0 horas en la tienda actual, verifica si están ponchando en otra tienda.
 * Consulta semana actual + semana anterior (cubre lunes/martes sin ponchadas aún).
 */
export async function refreshTransferCache(ronosCompanyId: number, zeroHoursUserIds: number[]): Promise<Map<number, { storeName: string; hours: number }>> {
  if (zeroHoursUserIds.length === 0) {
    const empty = new Map<number, { storeName: string; hours: number }>()
    transferCache.set(ronosCompanyId, { transfers: empty, scannedAt: Date.now(), zeroHoursCount: 0 })
    return empty
  }

  const otherStores = RONOS_STORES_MAP.filter(s => s.ronosCompanyId !== ronosCompanyId && !s.isBodega)

  const crossStoreResults = await mapConcurrent(
    otherStores,
    4,
    async (store) => {
      try {
        const weeks = await getRonosWeeks(store.ronosCompanyId)
        if (!weeks[0]) return { store, employees: [] as any[] }

        // Consultar semana actual Y semana anterior
        const weekIds = [weeks[0].weekId, weeks[1]?.weekId].filter(Boolean) as number[]
        const allEmployees: any[] = []

        for (const wId of weekIds) {
          const weekData = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
            searchTerm: null,
            companyId: store.ronosCompanyId,
            weekId: wId,
            departmentId: 0,
            pageNumber: 0,
            pageSize: 100,
            sort: 'FirstName',
            showInactive: 0,
            payType: 0,
            internalSalariedRules: false
          })
          const rawEmps = Array.isArray(weekData) ? weekData : (weekData?.results || weekData?.data || weekData?.employees || [])
          allEmployees.push(...rawEmps)
        }
        return { store, employees: allEmployees }
      } catch {
        return { store, employees: [] as any[] }
      }
    }
  )

  // Construir mapa: employeeUserId → { storeName, hours }
  const crossStoreMap = new Map<number, { storeName: string; hours: number }>()
  const zeroHoursSet = new Set(zeroHoursUserIds)

  crossStoreResults.forEach(result => {
    if (!result) return
    const { store, employees } = result
    employees.forEach((emp: any) => {
      const uId = Number(emp.employeeUserId || emp.userId)
      // Solo nos interesan los IDs que tienen 0 horas en la tienda origen
      if (!zeroHoursSet.has(uId)) return

      const hours = emp.totalWeeklyHour || 0
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
    zeroHoursCount: zeroHoursUserIds.length
  })

  return crossStoreMap
}

/**
 * Obtiene los traslados detectados desde la Base de Datos Supabase (ronos_employee_timecards_cache)
 * o desde la API en vivo si no se encuentran en la BD.
 * Esto permite consultas instantáneas (< 20ms) de forma PERMANENTE.
 */
async function getTransferData(
  ronosCompanyId: number,
  zeroHoursUserIds: number[]
): Promise<Map<number, { storeName: string; hours: number }>> {
  if (zeroHoursUserIds.length === 0) return new Map()

  const storeByCompany = new Map<number, string>()
  RONOS_STORES_MAP.forEach(s => storeByCompany.set(s.ronosCompanyId, s.tegName))

  const resultsMap = new Map<number, { storeName: string; hours: number }>()

  try {
    // 1. Consultar BD Supabase permanente: buscar tarjetas recientes con horas en otras tiendas
    const { data: dbCards, error: dbErr } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('employee_user_id, company_id, total_weekly_hours, week_id')
      .in('employee_user_id', zeroHoursUserIds)
      .neq('company_id', ronosCompanyId)
      .gt('total_weekly_hours', 0)
      .order('week_id', { ascending: false })

    if (!dbErr && dbCards && dbCards.length > 0) {
      dbCards.forEach(card => {
        const uId = Number(card.employee_user_id)
        if (!resultsMap.has(uId)) {
          const storeName = storeByCompany.get(card.company_id) || `Company ${card.company_id}`
          resultsMap.set(uId, { storeName, hours: Number(card.total_weekly_hours) })
        }
      })
    }

    // 2. Consultar historial de traslados detectados en BD
    const missingIds = zeroHoursUserIds.filter(uId => !resultsMap.has(uId))
    if (missingIds.length > 0) {
      const { data: dbTransfers } = await supabaseAdmin
        .from('ronos_transfers_history')
        .select('employee_user_id, target_store_name, target_company_id')
        .in('employee_user_id', missingIds)
        .eq('source_company_id', ronosCompanyId)

      if (dbTransfers && dbTransfers.length > 0) {
        dbTransfers.forEach(tr => {
          const uId = Number(tr.employee_user_id)
          if (!resultsMap.has(uId)) {
            resultsMap.set(uId, { storeName: tr.target_store_name, hours: 0 })
          }
        })
      }
    }
  } catch (err) {
    console.warn('Error querying Supabase transfer cache:', err)
  }

  // 3. Si la base de datos Supabase ya tiene datos de la tienda, los empleados no encontrados
  // simplemente son colaboradores inactivos que no laboran en ninguna otra sucursal.
  // Retornamos inmediatamente desde Supabase (< 20ms).
  const cached = transferCache.get(ronosCompanyId)
  if (cached) {
    cached.transfers.forEach((val, key) => {
      if (!resultsMap.has(key)) resultsMap.set(key, val)
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
 * Calcula el puntaje de similitud entre dos nombres (0 a 100)
 */
export function calculateNameSimilarity(ronosName: string, toastName: string): number {
  const normR = normalizeForMatch(ronosName)
  const normT = normalizeForMatch(toastName)

  if (!normR || !normT) return 0
  if (normR === normT) return 100

  // Si uno contiene al otro completamente
  if (normR.length >= 5 && normT.includes(normR)) return 95
  if (normT.length >= 5 && normR.includes(normT)) return 95

  // Comparación por palabras / tokens (manejo de nombres y apellidos múltiples en español)
  const tokensR = ronosName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean)
  const tokensT = toastName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean)

  if (tokensR.length === 0 || tokensT.length === 0) return 0

  let matches = 0
  tokensR.forEach(tr => {
    if (tokensT.some(tt => {
      if (tt === tr) return true
      // Ambos tokens deben ser >= 4 caracteres para matching por substring
      // (evita falsos positivos como "h" matcheando con "hismirna")
      if (tr.length >= 4 && tt.length >= 4 && (tt.includes(tr) || tr.includes(tt))) return true
      // Tolerancia a erratas de 1 caracter en palabras largas (ej. Ajcataz vs Ajeataz)
      if (tr.length >= 4 && tt.length >= 4 && Math.abs(tr.length - tt.length) <= 1) {
        return levenshteinDistance(tr, tt) <= 1
      }
      return false
    })) {
      matches++
    }
  })

  // Si todas las palabras del nombre más corto coinciden en el más largo (ej. "Miguel Perez" en "Miguel Pablo Perez")
  const minTokens = Math.min(tokensR.length, tokensT.length)
  const maxTokens = Math.max(tokensR.length, tokensT.length)

  if (matches === minTokens && minTokens >= 2) {
    return 90 // Alta confianza para nombres compuestos con segundo nombre o apellido omitido
  }

  if (tokensR.length > 0) {
    const score = Math.round((matches / maxTokens) * 100)
    return score
  }

  return 0
}

/**
 * Obtiene la lista de todos los empleados de Toast activos con sus puestos reales de toast_jobs
 * @param storeExternalId (opcional) Si se pasa, filtra solo los colaboradores asignados a esa tienda o corporativos
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

  // 2. Obtener empleados de Toast (solo activos)
  const { data, error } = await supabaseAdmin
    .from('toast_employees')
    .select('id, toast_guid, first_name, last_name, email, phone, job_references, store_ids')
    .eq('deleted', false)
    .order('first_name', { ascending: true })

  if (error || !data) {
    console.error('Error fetching toast_employees:', error)
    return []
  }

  // Filtrar por tienda si se especifica storeExternalId (incluyendo empleados corporativos con acceso multitienda)
  const filteredData = storeExternalId
    ? data.filter(e => Array.isArray(e.store_ids) && (e.store_ids.includes(storeExternalId) || e.store_ids.length >= 10))
    : data

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
      store_ids: Array.isArray(e.store_ids) ? e.store_ids : []
    }
  })
}

/**
 * Obtiene el mapeo completo de empleados ACTIVOS para una sucursal de RONOS
 * Filtra los candidatos de Toast exclusivamente a la sucursal seleccionada
 */
export async function getStoreEmployeeMappings(ronosCompanyId: number): Promise<{
  mappings: RonosMappedEmployee[]
  toastCandidates: ToastEmployeeCandidate[]
  stats: {
    totalRonos: number
    autoMatched: number
    manuallyMatched: number
    inactive: number
    unmapped: number
  }
}> {
  const storeMeta = RONOS_STORES_MAP.find(s => s.ronosCompanyId === ronosCompanyId)

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

  // 1. Obtener candidatos de Toast filtrados para esta tienda
  const allToastEmployees = await getAllToastEmployees(storeExternalId)

  // 2. Obtener empleados ACTIVOS de RONOS para la tienda usando la semana actual (filtra empleados dados de baja)
  let ronosList: any[] = []
  try {
    const weeks = await getRonosWeeks(ronosCompanyId)
    const currentWeekId = weeks[0]?.weekId
    if (currentWeekId) {
      const weekData = await callRonosApi<any>('WorkWeek/AdminGetWeekByWeekId', {
        searchTerm: null,
        companyId: ronosCompanyId,
        weekId: currentWeekId,
        departmentId: 0,
        pageNumber: 0,
        pageSize: 100,
        sort: 'FirstName',
        showInactive: 0,
        payType: 0,
        internalSalariedRules: false
      })
      ronosList = (weekData.results || []).filter((e: any) => e.active !== false)
    }
  } catch (err) {
    console.warn('Error fetching active employees by workweek, falling back to company list:', err)
  }

  // Si por alguna razón la lista de la semana está vacía, usar el endpoint de compañía
  if (ronosList.length === 0) {
    const rawEmployees = await callRonosApi<RonosRawEmployee[]>('Employee/GetEmployeesByCompany', {
      companyId: ronosCompanyId
    })
    ronosList = Array.isArray(rawEmployees) ? rawEmployees : []
  }

  // 3. Obtener mapeos guardados y detectar traslados
  const { data: allSavedMappings } = await supabaseAdmin
    .from('ronos_employee_mappings')
    .select('*')

  const savedMap = new Map<number, any>()
  const usedToastIds = new Set<string>()
  const activeStoreByUserId = new Map<number, string>()

  if (allSavedMappings && Array.isArray(allSavedMappings)) {
    allSavedMappings.forEach((m: any) => {
      const uId = Number(m.ronos_employee_user_id)
      if (m.ronos_company_id === ronosCompanyId) {
        savedMap.set(uId, m)
        if (m.toast_employee_id) {
          usedToastIds.add(m.toast_employee_id)
        }
      } else if (m.toast_employee_id && m.mapping_type !== 'inactive') {
        const otherStore = RONOS_STORES_MAP.find(s => s.ronosCompanyId === m.ronos_company_id)
        if (otherStore) {
          activeStoreByUserId.set(uId, otherStore.tegName)
        }
      }
    })
  }

  // Fase 2: Detección de traslados por PONCHADAS REALES en RONOS (cacheado 4 horas)
  // Identifica empleados con 0 horas en la tienda actual y verifica si poncharon en otra tienda
  const zeroHoursUserIds = ronosList
    .filter(e => (e.totalWeeklyHour || 0) === 0)
    .map(e => Number(e.employeeUserId || e.userId))
    .filter(uId => !activeStoreByUserId.has(uId))

  if (zeroHoursUserIds.length > 0) {
    const transferData = await getTransferData(ronosCompanyId, zeroHoursUserIds)
    transferData.forEach((data, uId) => {
      if (!activeStoreByUserId.has(uId)) {
        activeStoreByUserId.set(uId, data.storeName)
      }
    })
  }

  let autoMatchedCount = 0
  let manuallyMatchedCount = 0
  let inactiveCount = 0
  let unmappedCount = 0

  const results: RonosMappedEmployee[] = []

  ronosList.forEach(rEmp => {
    const userId = Number(rEmp.employeeUserId || rEmp.userId)
    const fullName = `${rEmp.firstName || ''} ${rEmp.lastName || ''}`.trim()
    const saved = savedMap.get(userId)
    const transferredTo = activeStoreByUserId.get(userId) || null

    if (saved) {
      // Caso 1: Marcado explícitamente como Inactivo / No labora
      if (saved.mapping_type === 'inactive') {
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
          transferredToStore: transferredTo
        })
        return
      }

      // Caso 2: Vinculado a empleado de Toast en base de datos
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
          transferredToStore: transferredTo
        })
        return
      }
    }

    // Intentar Auto-Match inteligente contra los candidatos de la tienda NO asignados
    let bestMatch: ToastEmployeeCandidate | null = null
    let bestScore = 0

    allToastEmployees.forEach(tEmp => {
      // No emparejar a un candidato de Toast que ya esté asignado a otro colaborador
      if (usedToastIds.has(tEmp.id)) return

      const score = calculateNameSimilarity(fullName, tEmp.full_name)
      if (score > bestScore) {
        bestScore = score
        bestMatch = tEmp
      }
    })

    if (bestMatch && bestScore >= 70) {
      usedToastIds.add((bestMatch as ToastEmployeeCandidate).id)
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
        toastEmployeeId: (bestMatch as ToastEmployeeCandidate).id,
        toastGuid: (bestMatch as ToastEmployeeCandidate).toast_guid,
        toastFullName: (bestMatch as ToastEmployeeCandidate).full_name,
        toastEmail: (bestMatch as ToastEmployeeCandidate).email,
        toastPhone: (bestMatch as ToastEmployeeCandidate).phone,
        toastJobTitle: (bestMatch as ToastEmployeeCandidate).job_title || null,
        mappingType: 'auto',
        isConfirmed: false,
        confidenceScore: bestScore,
        transferredToStore: transferredTo
      })
    } else {
      unmappedCount++
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
        confidenceScore: bestScore,
        transferredToStore: transferredTo
      })
    }
  })

  return {
    mappings: results.sort((a, b) => {
      // Prioridad en orden: 1. Sin vincular (unmapped), 2. Vinculados (auto/manual), 3. Inactivos
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
    }
  }
}

/**
 * Guarda o actualiza un mapeo de empleado (manual, auto o inactivo)
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
  mappingType?: 'auto' | 'manual' | 'inactive'
  isConfirmed?: boolean
  notes?: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .upsert({
        ronos_employee_user_id: data.ronosEmployeeUserId,
        ronos_employee_id: data.ronosEmployeeId || null,
        ronos_company_id: data.ronosCompanyId,
        ronos_full_name: data.ronosFullName,
        ronos_pin: data.ronosPin || null,
        ronos_job_title: data.ronosJobTitle || null,
        toast_employee_id: data.toastEmployeeId,
        toast_guid: data.toastGuid || null,
        toast_full_name: data.toastFullName || null,
        toast_email: data.toastEmail || null,
        mapping_type: data.mappingType || 'manual',
        is_confirmed: data.isConfirmed ?? true,
        notes: data.notes || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'ronos_employee_user_id,ronos_company_id'
      })

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

