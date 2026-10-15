/**
 * @module lib/delivery-armor
 * @description Módulo central de Blindaje Delivery para Tacos Gavilan.
 *   - Integra Toast API v2 Orders y Dining Options para captura exhaustiva de pedidos off-premise (DoorDash, Uber Eats, Grubhub, Toast Online, Curbside, Takeout).
 *   - Valida la identidad del personal mediante PIN de 4 dígitos sincronizado directamente desde RONOS (Cingular HR), no de Toast.
 *   - Administra cuatro controles operativos rápidos, evidencia proporcional al riesgo y la liberación segura de la bolsa.
 *   - Genera expedientes de disputa (Dispute Dossiers) automáticos con argumentación legal en inglés para DoorDash Merchant Portal y Uber Eats Manager.
 *
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente. El turno PM inicia a las 5:00 PM.
 *   - Protocolo Toast API: NUNCA hardcodear GUIDs de Dining Options; siempre traducir vía getDiningOptionsMap().
 *   - Ninguna bolsa se libera sin confirmar platillos, bebidas, cantidad de bolsas, sello y verificación nativa de la plataforma.
 *   - Las bebidas refrigeradas (Horchatas, sodas mexicanas, aguas frescas) son marcadas como ítems de alto riesgo (High Risk) para evitar olvidos.
 *   - La entrega al repartidor requiere validación de app activa y registro del PIN de RONOS del colaborador en turno.
 *
 * @dataFlow
 *   Toast API (/ordersBulk, /diningOptions) + RONOS (ronos_employee_timecards_cache) -> delivery-armor -> Supabase (delivery_packing_audits + bucket delivery-evidence) -> UI Tablet / Admin.
 *
 * @notes
 *   - Desarrollado inicialmente para el plan piloto en Slauson (Tienda #7) y LA Central (Tienda #6), extensible a las 15 sucursales de Tacos Gavilan.
 */

import { supabaseAdmin } from './supabase'
import { getAuthToken } from './toast-api'
import { RONOS_STORES_MAP } from './ronos-api'

// Host de Toast API
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

// Tipos del Módulo Blindaje Delivery
export type DeliveryPlatform = 
  | 'DOORDASH'
  | 'UBER_EATS'
  | 'GRUBHUB'
  | 'TOAST_ONLINE'
  | 'TAKEOUT'
  | 'OTHER'

export type AuditStatus = 
  | 'PENDING_MATCH'
  | 'MATCHED'
  | 'PACKED_AND_SEALED'
  | 'DELIVERED'
  | 'DISPUTED'
  | 'UNCLAIMED_2H'

export const UNCLAIMED_DRIVER_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 horas (120 minutos) sin recolección de chofer

export type DeliveryRiskLevel = 'NORMAL' | 'HIGH'
export type EvidencePolicy = 'NONE' | 'SEALED_BAG'
export type CourierVerificationMethod = 'DOORDASH_QR' | 'PLATFORM_ORDER_ID' | 'APP_ORDER_SCREEN'
export type KdsPrepStatus = 'IN_KITCHEN' | 'READY'

export interface PlatformOrderIdentity {
  platformOrderKey: string
  shortOrderKey: string
  cleanCustomerName: string
  maskedCustomerName: string
  assignedDriverHint?: string | null
}

export interface KdsTimingInfo {
  kdsStatus: KdsPrepStatus
  kdsSentAt: string
  kdsReadyAt: string | null
  kdsPrepSeconds: number | null
}

export interface DeliveryQuickChecks {
  foodComplete: boolean
  drinksComplete: boolean
  bagCountCorrect: boolean
  bagSealed: boolean
  platformOrderKey?: string
  shortOrderKey?: string
  kdsStatus?: KdsPrepStatus
  kdsSentAt?: string
  kdsReadyAt?: string | null
  kdsPrepSeconds?: number | null
}

export interface OrderItemDetail {
  id: string
  displayName: string
  quantity: number
  price: number
  modifiers: string[]
  isHighRiskDrink: boolean
}

export interface OffPremiseOrder {
  orderGuid: string
  displayNumber: string
  storeId: number
  storeName: string
  platform: DeliveryPlatform
  diningOptionGuid: string
  diningOptionName: string
  customerName: string
  maskedCustomerName: string
  platformOrderKey: string
  shortOrderKey: string
  assignedDriverHint?: string | null
  openedDate: string
  kdsStatus: KdsPrepStatus
  kdsSentAt: string
  kdsReadyAt: string | null
  kdsPrepSeconds: number | null
  isVoided?: boolean
  items: OrderItemDetail[]
  totalItemsCount: number
  audit?: {
    id: string
    status: AuditStatus
    matchedItems: string[]
    matchCompleted: boolean
    photoOpenUrl?: string | null
    photoSealedUrl?: string | null
    packerName?: string | null
    packedAt?: string | null
    handedByName?: string | null
    handedAt?: string | null
    driverName?: string | null
    driverConfirmed?: boolean
    quickChecks?: DeliveryQuickChecks
    expectedBagCount?: number
    confirmedBagCount?: number | null
    riskLevel?: DeliveryRiskLevel
    riskReasons?: string[]
    evidencePolicy?: EvidencePolicy
    courierVerificationMethod?: CourierVerificationMethod | null
    courierOrderReference?: string | null
    livePickupConfirmed?: boolean
  }
}

/**
 * Enmascara el nombre del cliente (ej. "Aramis P." -> "A••• P.")
 */
export function maskCustomerName(rawName: string): string {
  const clean = String(rawName || '').trim()
  if (!clean) return 'C•••'
  const parts = clean.split(/\s+/).filter(Boolean)
  const first = parts[0] || 'C'
  const firstChar = first.charAt(0).toUpperCase()
  if (parts.length === 1) {
    return `${firstChar}•••`
  }
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase()
  return `${firstChar}••• ${lastInitial}.`
}

export type NameCollisionReason = 'EXACT_NAME' | 'SAME_FIRST_NAME' | 'SIMILAR_NAME'

function normalizeAsciiLetters(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function phoneticFirstToken(token: string): string {
  return token
    .replace(/ph/g, 'f')
    .replace(/ch/g, 'x')
    .replace(/ll/g, 'i')
    .replace(/qu/g, 'k')
    .replace(/c([ei])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/g([ei])/g, 'j$1')
    .replace(/h/g, '')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1')
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  return matrix[a.length][b.length]
}

const GENERIC_CUSTOMER_TOKENS = new Set(['cliente', 'uber', 'eats', 'doordash', 'grubhub', 'online', 'delivery', 'pickup'])

/**
 * Detecta si dos nombres de clientes son idénticos, comparten el mismo primer nombre (aunque el apellido sea diferente)
 * o son fonéticamente/visualmente muy parecidos (ej. Maria G. vs Maria R., Cristian vs Christian, Jovita vs Jovanna, Carla vs Karla).
 */
export function areCustomerNamesConfusable(
  nameA: string,
  nameB: string
): { confusable: boolean; reason: NameCollisionReason | null } {
  const normA = normalizeAsciiLetters(nameA)
  const normB = normalizeAsciiLetters(nameB)
  if (!normA || !normB) return { confusable: false, reason: null }

  const partsA = normA.split(' ').filter(t => t && !GENERIC_CUSTOMER_TOKENS.has(t))
  const partsB = normB.split(' ').filter(t => t && !GENERIC_CUSTOMER_TOKENS.has(t))
  const firstA = partsA[0] || ''
  const firstB = partsB[0] || ''

  if (firstA.length < 2 || firstB.length < 2) {
    return { confusable: false, reason: null }
  }

  // 1. Nombre y apellido/inicial exactamente iguales
  if (partsA.join(' ') === partsB.join(' ')) {
    return { confusable: true, reason: 'EXACT_NAME' }
  }

  // 2. Mismo primer nombre aunque el apellido o inicial sea diferente (ej. "Maria G." vs "Maria R.")
  if (firstA === firstB) {
    return { confusable: true, reason: 'SAME_FIRST_NAME' }
  }

  // 3. Equivalencia fonética directa (ej. "Cristian" vs "Christian", "Bryan" vs "Brian", "Carla" vs "Karla", "Steven" vs "Stephen")
  const phonA = phoneticFirstToken(firstA)
  const phonB = phoneticFirstToken(firstB)
  if (phonA.length >= 3 && phonA === phonB) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  // 4. Uno contiene al otro como prefijo/diminutivo de >= 3 letras (ej. "Alex" vs "Alexis"/"Alejandro", "Mari" vs "Maria", "Jovi" vs "Jovita")
  const minLen = Math.min(firstA.length, firstB.length)
  if (minLen >= 3 && (firstA.startsWith(firstB) || firstB.startsWith(firstA))) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }
  const minPhonLen = Math.min(phonA.length, phonB.length)
  if (minPhonLen >= 3 && (phonA.startsWith(phonB) || phonB.startsWith(phonA))) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  // 5. Distancia de edición muy corta (ej. "Maria" vs "Mario", "Jovita" vs "Jovana", "Juan" vs "Juana", "Luis" vs "Luisa")
  const rawDist = levenshteinDistance(firstA, firstB)
  const phonDist = levenshteinDistance(phonA, phonB)

  if (minLen >= 4 && (rawDist <= 1 || phonDist <= 1)) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  if (minLen >= 5 && rawDist <= 2 && phonA[0] === phonB[0]) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  return { confusable: false, reason: null }
}

/**
 * Determina si una orden no fue recogida por ningún chofer en 2 horas o más (>= 120 minutos).
 */
export function isOrderUnclaimedByDriver(params: {
  openedDate?: string | null
  packedAt?: string | null
  handedAt?: string | null
  status?: string | null
  nowMs?: number
}): boolean {
  const { openedDate, packedAt, handedAt, status, nowMs = Date.now() } = params
  if (status === 'DELIVERED' || status === 'released' || handedAt) return false
  if (status === 'UNCLAIMED_2H' || status === 'unclaimed') return true

  const openedMs = openedDate ? new Date(openedDate).getTime() : NaN
  const packedMs = packedAt ? new Date(packedAt).getTime() : NaN
  const referenceMs = Number.isFinite(openedMs) ? openedMs : packedMs

  if (!Number.isFinite(referenceMs)) return false
  return nowMs - referenceMs >= UNCLAIMED_DRIVER_TIMEOUT_MS
}

/**
 * Cambia automáticamente el estatus en base de datos a UNCLAIMED_2H para todas las órdenes
 * no entregadas (sin chofer) que hayan cumplido 2 horas o más desde su apertura o empaque.
 */
export async function autoExpireUnclaimedAudits(
  storeId?: number,
  nowMs: number = Date.now()
): Promise<number> {
  try {
    let query = supabaseAdmin
      .from('delivery_packing_audits')
      .select('id, status, order_opened_at, packed_at, handed_at, created_at')
      .in('status', ['PENDING_MATCH', 'MATCHED', 'PACKED_AND_SEALED'])
      .is('handed_at', null)

    if (storeId && storeId > 0) {
      query = query.eq('store_id', storeId)
    }

    const { data: candidates, error } = await query
    if (error || !candidates?.length) return 0

    const expiredIds = candidates
      .filter(row =>
        isOrderUnclaimedByDriver({
          openedDate: row.order_opened_at || row.packed_at || row.created_at,
          packedAt: row.packed_at,
          handedAt: row.handed_at,
          status: row.status,
          nowMs
        })
      )
      .map(row => row.id)

    if (expiredIds.length === 0) return 0

    await supabaseAdmin
      .from('delivery_packing_audits')
      .update({
        status: 'UNCLAIMED_2H' as AuditStatus,
        updated_at: new Date(nowMs).toISOString()
      })
      .in('id', expiredIds)

    return expiredIds.length
  } catch {
    return 0
  }
}

/**
 * Extrae la Clave Oficial de la Orden de cada plataforma (Uber Eats, DoorDash, Grubhub, Toast) desde Toast API
 */
export function extractPlatformOrderIdentity(params: {
  platform: DeliveryPlatform
  displayNumber: string
  tabName?: string | null
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
  email?: string | null
  phone?: string | null
  deliveryNotes?: string | null
}): PlatformOrderIdentity {
  const ticket = String(params.displayNumber || 'S/N').trim()
  const tab = String(params.tabName || '').trim()
  const rawFirst = String(params.firstName || '').trim()
  const rawLast = String(params.lastName || '').trim()
  const email = String(params.email || '').trim()
  const phone = String(params.phone || '').trim()
  const notes = String(params.deliveryNotes || '').trim()

  // Detectar pista de chofer asignado en notas de Uber Eats ("Driver Pin: 31902213 (Jessica)")
  const driverMatch = notes.match(/Driver Pin:\s*\d+\s*\(([^)]+)\)/i)
  const assignedDriverHint = driverMatch ? driverMatch[1].trim() : null

  // Limpiar nombre del cliente quitando prefijos y claves pegadas
  let cleanFirst = rawFirst
  let ueCodeFromFirst = ''
  if (cleanFirst.toUpperCase().startsWith('UE-')) {
    const withoutPrefix = cleanFirst.slice(3).trim()
    const trailingHex = withoutPrefix.match(/^([a-zA-Z\s.'-]+?)([A-Z0-9]{5})$/i)
    if (trailingHex) {
      cleanFirst = trailingHex[1].trim()
      ueCodeFromFirst = trailingHex[2].toUpperCase()
    } else {
      cleanFirst = withoutPrefix
    }
  } else if (cleanFirst.toLowerCase().startsWith('pickup-')) {
    cleanFirst = cleanFirst.slice(7).trim()
  }

  const platformLabel =
    params.platform === 'DOORDASH'
      ? 'DoorDash'
      : params.platform === 'UBER_EATS'
      ? 'Uber Eats'
      : params.platform === 'GRUBHUB'
      ? 'Grubhub'
      : 'Online'

  const tabCustomerFallback = tab
    .replace(/^\s*UBER[-_\s]*[A-Z0-9]{4,8}\b\s*/i, '')
    .replace(/^\s*(DD|SF)\s+[a-f0-9]{6,10}\b\s*/i, '')
    .replace(/^\s*Grubhub\s*#?\d+\s*/i, '')
    .replace(/^pickup-\s*/i, '')
    .trim()

  const cleanCustomerName =
    [cleanFirst, rawLast].filter(Boolean).join(' ').trim() ||
    String(params.fullName || '').trim() ||
    tabCustomerFallback ||
    `Cliente ${platformLabel}`

  const maskedCustomerName = maskCustomerName(cleanCustomerName)

  if (params.platform === 'UBER_EATS') {
    const tabMatch = tab.match(/\bUBER[-_\s]*([A-Z0-9]{4,8})\b/i)
    const emailMatch = email.match(/ubersupport([a-z0-9]{4,8})@/i)
    const code = (tabMatch?.[1] || ueCodeFromFirst || emailMatch?.[1] || '').toUpperCase()
    if (code) {
      return {
        platformOrderKey: code,
        shortOrderKey: code,
        cleanCustomerName,
        maskedCustomerName,
        assignedDriverHint
      }
    }
    return {
      platformOrderKey: `#${ticket}`,
      shortOrderKey: `#${ticket}`,
      cleanCustomerName,
      maskedCustomerName,
      assignedDriverHint
    }
  }

  if (params.platform === 'DOORDASH') {
    const tabMatch = tab.match(/^\s*(DD|SF)\s+([a-f0-9]{6,10})\b/i)
    const emailMatch = email.match(/orders_([a-f0-9]{8})-/i)
    const prefix = (tabMatch?.[1] || 'DD').toUpperCase()
    const code = (tabMatch?.[2] || emailMatch?.[1] || '').toUpperCase()
    if (code) {
      return {
        platformOrderKey: `${prefix} ${code}`,
        shortOrderKey: code,
        cleanCustomerName,
        maskedCustomerName,
        assignedDriverHint
      }
    }
    return {
      platformOrderKey: `DD #${ticket}`,
      shortOrderKey: `QR #${ticket}`,
      cleanCustomerName,
      maskedCustomerName,
      assignedDriverHint
    }
  }

  if (params.platform === 'GRUBHUB') {
    const ghMatch = tab.match(/Grubhub\s*#?(\d{6,20})/i)
    const ghNum = ghMatch?.[1] || ''
    if (ghNum) {
      return {
        platformOrderKey: `GH #${ghNum}`,
        shortOrderKey: `#${ghNum.slice(-4)}`,
        cleanCustomerName,
        maskedCustomerName,
        assignedDriverHint
      }
    }
    return {
      platformOrderKey: `GH #${ticket}`,
      shortOrderKey: `#${ticket}`,
      cleanCustomerName,
      maskedCustomerName,
      assignedDriverHint
    }
  }

  const sfOrDdInTab = tab.match(/^\s*(DD|SF)\s+([a-f0-9]{6,10})\b/i)
  if (sfOrDdInTab) {
    const prefix = sfOrDdInTab[1].toUpperCase()
    const code = sfOrDdInTab[2].toUpperCase()
    return {
      platformOrderKey: `${prefix} ${code}`,
      shortOrderKey: code,
      cleanCustomerName,
      maskedCustomerName,
      assignedDriverHint
    }
  }

  const digits = phone.replace(/\D/g, '')
  const last4 = digits.length >= 4 ? digits.slice(-4) : ''
  return {
    platformOrderKey: last4 ? `TOAST #${ticket} (${last4})` : `TOAST #${ticket}`,
    shortOrderKey: last4 ? `#${ticket}•${last4}` : `#${ticket}`,
    cleanCustomerName,
    maskedCustomerName,
    assignedDriverHint
  }
}

/**
 * Calcula el tiempo real de preparación en KDS desde que llega la orden (createdDate/openedDate)
 * hasta que el cocinero borra la orden del KDS (fulfillmentStatus === 'READY' -> modifiedDate).
 * Nota operativa: En Toast, las bebidas (Large Piña, Jamaica, Horchata, Champurrado) no van a la pantalla KDS de cocina
 * y permanecen en 'SENT', mientras que los platillos cambian a 'READY' en el segundo exacto en que el cocinero borra la orden.
 */
export function extractKdsTiming(rawOrder: any): KdsTimingInfo {
  const openedDate = rawOrder?.openedDate || new Date().toISOString()
  const checks = Array.isArray(rawOrder?.checks) ? rawOrder.checks : []
  const selections: any[] = []
  for (const chk of checks) {
    if (Array.isArray(chk?.selections)) {
      for (const sel of chk.selections) {
        if (!sel?.voided) selections.push(sel)
      }
    }
  }

  if (selections.length === 0) {
    return {
      kdsStatus: 'READY',
      kdsSentAt: openedDate,
      kdsReadyAt: openedDate,
      kdsPrepSeconds: 0
    }
  }

  const createdTimestamps = selections
    .map(s => (s?.createdDate ? new Date(s.createdDate).getTime() : NaN))
    .filter(t => Number.isFinite(t) && t > 0)

  const openedMs = new Date(openedDate).getTime()
  const minCreatedMs = createdTimestamps.length > 0 ? Math.min(...createdTimestamps) : NaN
  const sentMs =
    Number.isFinite(openedMs) && Number.isFinite(minCreatedMs)
      ? Math.max(openedMs, minCreatedMs)
      : Number.isFinite(minCreatedMs)
      ? minCreatedMs
      : Number.isFinite(openedMs)
      ? openedMs
      : Date.now()

  const kdsSentAt = new Date(sentMs).toISOString()

  // Separar platillos de cocina vs bebidas de mostrador (las bebidas no pasan por el KDS del cocinero)
  const foodSelections = selections.filter(s => {
    const name = s?.displayName || s?.itemGroup?.name || ''
    return !isHighRiskBeverage(name)
  })

  // Si la orden es únicamente de bebidas (sin platillos de cocina), pasa directo a la cajera
  if (foodSelections.length === 0) {
    return {
      kdsStatus: 'READY',
      kdsSentAt,
      kdsReadyAt: kdsSentAt,
      kdsPrepSeconds: 0
    }
  }

  const readyFoodSelections = foodSelections.filter(
    s => String(s?.fulfillmentStatus || '').toUpperCase() === 'READY'
  )
  const pendingFoodSelections = foodSelections.filter(s => {
    const st = String(s?.fulfillmentStatus || '').toUpperCase()
    return st === 'SENT' || st === 'NEW' || st === 'HOLD'
  })

  // Si aún hay platillos de cocina en SENT/NEW/HOLD y no todos han salido del KDS
  if (pendingFoodSelections.length > 0 && readyFoodSelections.length < foodSelections.length) {
    return {
      kdsStatus: 'IN_KITCHEN',
      kdsSentAt,
      kdsReadyAt: null,
      kdsPrepSeconds: null
    }
  }

  const readySource = readyFoodSelections.length > 0 ? readyFoodSelections : foodSelections
  const modifiedTimestamps = readySource
    .map(s => (s?.modifiedDate ? new Date(s.modifiedDate).getTime() : NaN))
    .filter(t => Number.isFinite(t) && t > 0)

  const readyMs = modifiedTimestamps.length > 0 ? Math.max(...modifiedTimestamps) : sentMs
  const rawPrepSec = Math.round((readyMs - sentMs) / 1000)
  const kdsPrepSeconds = Number.isFinite(rawPrepSec) ? Math.max(0, Math.min(7200, rawPrepSec)) : 0

  return {
    kdsStatus: 'READY',
    kdsSentAt,
    kdsReadyAt: new Date(Math.max(sentMs, readyMs)).toISOString(),
    kdsPrepSeconds
  }
}

export function areQuickChecksComplete(checks: Partial<DeliveryQuickChecks> | null | undefined): boolean {
  return !!(
    checks?.foodComplete &&
    checks?.drinksComplete &&
    checks?.bagCountCorrect &&
    checks?.bagSealed
  )
}

export function calculateDeliveryRisk(params: {
  hasRefrigeratedBeverages: boolean
  totalItemsCount: number
  confirmedBagCount: number
}): { level: DeliveryRiskLevel; reasons: string[]; evidencePolicy: EvidencePolicy } {
  const reasons: string[] = []
  if (params.hasRefrigeratedBeverages) reasons.push('BEBIDA_REFRIGERADA')
  if (params.totalItemsCount >= 8) reasons.push('ORDEN_GRANDE')
  if (params.confirmedBagCount > 1) reasons.push('MULTIPLES_BOLSAS')
  const level: DeliveryRiskLevel = reasons.length > 0 ? 'HIGH' : 'NORMAL'
  return { level, reasons, evidencePolicy: level === 'HIGH' ? 'SEALED_BAG' : 'NONE' }
}

/**
 * Obtiene el ID de compañía de RONOS para una tienda de Tacos Gavilan
 */
export function getRonosCompanyId(storeId: number): number {
  const match = RONOS_STORES_MAP.find(s => s.tegStoreId === storeId)
  return match?.ronosCompanyId || 34 // Default Lynwood / Corporativo
}

/**
 * Valida un PIN de 4 dígitos contra el personal activo de RONOS para la tienda
 */
export async function verifyRonosPin(storeId: number, pin: string): Promise<{
  valid: boolean
  employeeUserId?: number
  fullName?: string
  jobTitle?: string
  error?: string
}> {
  const cleanPin = String(pin || '').trim()
  if (!/^\d{4}$/.test(cleanPin)) {
    return { valid: false, error: 'El PIN debe contener exactamente 4 dígitos.' }
  }

  const companyId = getRonosCompanyId(storeId)

  try {
    // 1. Buscar primero en la caché de tarjetas de tiempo de RONOS para esta sucursal
    const { data: cached, error } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('employee_user_id, full_name, job_title, pin, company_id')
      .eq('company_id', companyId)
      .eq('pin', cleanPin)
      .limit(1)

    if (!error && cached && cached.length > 0) {
      const emp = cached[0]
      return {
        valid: true,
        employeeUserId: emp.employee_user_id,
        fullName: emp.full_name,
        jobTitle: emp.job_title || 'Colaborador'
      }
    }

    // 2. Si no se encuentra en la tienda local, buscar si es un colaborador flotante o transferido en cualquier sucursal de RONOS
    const { data: anyStoreMatch } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('employee_user_id, full_name, job_title, pin, company_id')
      .eq('pin', cleanPin)
      .limit(1)

    if (anyStoreMatch && anyStoreMatch.length > 0) {
      const emp = anyStoreMatch[0]
      return {
        valid: true,
        employeeUserId: emp.employee_user_id,
        fullName: emp.full_name,
        jobTitle: emp.job_title || 'Colaborador (Transferido)'
      }
    }

    return { valid: false, error: 'PIN no encontrado en el padrón de colaboradores de RONOS.' }
  } catch (err: any) {
    console.error('Error validando PIN de RONOS:', err)
    return { valid: false, error: 'Error de conexión con el padrón de RONOS.' }
  }
}

export const PIN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutos sin actividad

export interface ActiveStorePinSession {
  storeId: number
  sessionToken: string
  employeeUserId: number
  employeeName: string
  jobTitle: string
  startedAt: string
  lastActivityAt: string
  expiresAt: string
}

const activeSessionMemoryCache = new Map<number, ActiveStorePinSession>()

function getStoreSessionRowId(storeId: number): string {
  return `delivery_armor_session_store_${storeId}`
}

/**
 * Obtiene la sesión única activa de PIN para una sucursal desde PostgreSQL.
 * Si ya cumplió 10 minutos sin actividad, devuelve null.
 */
export async function getActiveStorePinSession(storeId: number): Promise<ActiveStorePinSession | null> {
  try {
    const rowId = getStoreSessionRowId(storeId)
    const { data, error } = await supabaseAdmin
      .from('order_ready_settings')
      .select('updated_by')
      .eq('id', rowId)
      .maybeSingle()

    if (error || !data || !data.updated_by) {
      activeSessionMemoryCache.delete(storeId)
      return null
    }
    const parsed = JSON.parse(data.updated_by) as ActiveStorePinSession
    if (!parsed || !parsed.sessionToken || new Date(parsed.expiresAt).getTime() <= Date.now()) {
      activeSessionMemoryCache.delete(storeId)
      return null
    }
    activeSessionMemoryCache.set(storeId, parsed)
    return parsed
  } catch {
    const mem = activeSessionMemoryCache.get(storeId)
    if (mem && new Date(mem.expiresAt).getTime() > Date.now()) return mem
    return null
  }
}

/**
 * Registra una nueva sesión exclusiva de PIN para una sucursal.
 * Sobreescribe e invalida inmediatamente cualquier otra sesión abierta en esa misma tienda (no puede haber 2 sesiones abiertas).
 */
export async function registerExclusiveStorePinSession(params: {
  storeId: number
  employeeUserId: number
  employeeName: string
  jobTitle: string
}): Promise<ActiveStorePinSession> {
  const now = Date.now()
  const sessionToken =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${params.storeId}-${now}-${Math.random().toString(36).slice(2, 10)}`

  const session: ActiveStorePinSession = {
    storeId: params.storeId,
    sessionToken,
    employeeUserId: params.employeeUserId,
    employeeName: params.employeeName,
    jobTitle: params.jobTitle,
    startedAt: new Date(now).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PIN_INACTIVITY_TIMEOUT_MS).toISOString()
  }

  activeSessionMemoryCache.set(params.storeId, session)

  try {
    const rowId = getStoreSessionRowId(params.storeId)
    await supabaseAdmin
      .from('order_ready_settings')
      .upsert(
        {
          id: rowId,
          voice: 'Kore',
          voice_language: 'bilingual',
          updated_by: JSON.stringify(session),
          updated_at: new Date(now).toISOString()
        },
        { onConflict: 'id' }
      )
  } catch (err) {
    console.warn('No se pudo persistir sesión exclusiva en PostgreSQL:', err)
  }

  return session
}

/**
 * Valida que el sessionToken siga siendo la única sesión activa de la tienda y renueva los 10 minutos por actividad.
 */
export async function touchActiveStorePinSession(
  storeId: number,
  sessionToken: string
): Promise<{
  valid: boolean
  replacedBy?: string
  expired?: boolean
  session?: ActiveStorePinSession
}> {
  const current = await getActiveStorePinSession(storeId)
  if (!current) {
    return { valid: false, expired: true }
  }
  if (current.sessionToken !== sessionToken) {
    return {
      valid: false,
      replacedBy: current.employeeName
    }
  }
  const now = Date.now()
  const updated: ActiveStorePinSession = {
    ...current,
    lastActivityAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PIN_INACTIVITY_TIMEOUT_MS).toISOString()
  }
  activeSessionMemoryCache.set(storeId, updated)
  try {
    const rowId = getStoreSessionRowId(storeId)
    await supabaseAdmin
      .from('order_ready_settings')
      .upsert(
        {
          id: rowId,
          voice: 'Kore',
          voice_language: 'bilingual',
          updated_by: JSON.stringify(updated),
          updated_at: new Date(now).toISOString()
        },
        { onConflict: 'id' }
      )
  } catch {
    // ignore transient DB failure
  }
  return { valid: true, session: updated }
}

/**
 * Cierra la sesión activa de la sucursal únicamente si coincide con el sessionToken que solicita el cierre.
 */
export async function clearActiveStorePinSession(storeId: number, sessionToken?: string): Promise<boolean> {
  try {
    const current = await getActiveStorePinSession(storeId)
    if (current && sessionToken && current.sessionToken !== sessionToken) {
      // Otra persona ya inició sesión; no borrar la nueva sesión activa
      return false
    }
    activeSessionMemoryCache.delete(storeId)
    const rowId = getStoreSessionRowId(storeId)
    await supabaseAdmin.from('order_ready_settings').delete().eq('id', rowId)
    return true
  } catch {
    return false
  }
}

/**
 * Detecta si un ítem corresponde a una bebida o producto refrigerado/líquido que requiere atención de la cajera
 */
export function isHighRiskBeverage(name: string): boolean {
  const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return (
    n.includes('horchata') ||
    n.includes('jamaica') ||
    n.includes('tamarindo') ||
    n.includes('pina') ||
    n.includes('pineapple') ||
    n.includes('fresa') ||
    n.includes('limon') ||
    n.includes('melon') ||
    n.includes('sandia') ||
    n.includes('pepino') ||
    n.includes('mango') ||
    n.includes('guayaba') ||
    n.includes('champurrado') ||
    n.includes('atole') ||
    n.includes('soda') ||
    n.includes('coke') ||
    n.includes('coca') ||
    n.includes('sprite') ||
    n.includes('fanta') ||
    n.includes('squirt') ||
    n.includes('pepsi') ||
    n.includes('jarrito') ||
    n.includes('sidral') ||
    n.includes('mundet') ||
    n.includes('manzanita') ||
    n.includes('sangria') ||
    n.includes('agua') ||
    n.includes('water') ||
    n.includes('drink') ||
    n.includes('jugo') ||
    n.includes('coffee') ||
    n.includes('cafe') ||
    n.includes('mineral') ||
    n.includes('topo chico')
  )
}

/**
 * Clasifica la plataforma de entrega de acuerdo a la Dining Option y Delivery Service de Toast
 */
export function classifyPlatform(diningOptionName: string, deliveryService?: string, source?: string): DeliveryPlatform {
  const full = `${diningOptionName} ${deliveryService || ''} ${source || ''}`.toLowerCase()

  if (full.includes('doordash') || full.includes('dash')) {
    return 'DOORDASH'
  }
  if (full.includes('uber') || full.includes('eats') || full.includes('postmates')) {
    return 'UBER_EATS'
  }
  if (full.includes('grubhub') || full.includes('grub')) {
    return 'GRUBHUB'
  }
  if (full.includes('toast online') || full.includes('online ordering') || full.includes('curbside') || full.includes('toast delivery')) {
    return 'TOAST_ONLINE'
  }
  return 'OTHER'
}

/**
 * Determina si una orden pertenece estrictamente a una plataforma de delivery o pedido online.
 * Excluye explícitamente órdenes de mostrador presencial ('To Go'), comedor ('For Here'), kioskos y teléfono.
 */
export function isDeliveryPlatform(diningOptionName: string, deliveryService?: string, source?: string): boolean {
  const p = classifyPlatform(diningOptionName, deliveryService, source)
  return p !== 'OTHER'
}

const diningOptionsCache = new Map<string, { at: number; map: Record<string, string> }>()
const toastRawOrdersCache = new Map<string, { at: number; orders: any[] }>()
const toastRawOrdersInflight = new Map<string, Promise<any[]>>()
const TOAST_RAW_CACHE_TTL_MS = 5000 // 5 segundos para evitar 429 en Toast API y responder al instante tras confirmar empaque

/**
 * Consulta las opciones de comedor (Dining Options) de Toast de forma dinámica (Protocolo Toast API)
 */
async function fetchDiningOptionsMap(token: string, storeExternalId: string): Promise<Record<string, string>> {
  const cached = diningOptionsCache.get(storeExternalId)
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
    return cached.map
  }
  try {
    const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeExternalId
      }
    })
    if (!res.ok) return cached?.map || {}
    const data = await res.json()
    const map: Record<string, string> = {}
    if (Array.isArray(data)) {
      data.forEach((opt: any) => {
        if (opt.guid && opt.name) {
          map[opt.guid] = opt.name
        }
      })
    }
    if (Object.keys(map).length > 0) {
      diningOptionsCache.set(storeExternalId, { at: Date.now(), map })
    }
    return map
  } catch {
    return cached?.map || {}
  }
}

/**
 * Obtiene la fecha de negocio actual de Toast en horario Los Ángeles (Regla de las 6:00 AM)
 */
export function getToastBusinessDate(date: Date = new Date()): string {
  const laDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  // Si es antes de las 6:00 AM, pertenece al día laboral anterior
  if (laDate.getHours() < 6) {
    laDate.setDate(laDate.getDate() - 1)
  }
  const y = laDate.getFullYear()
  const m = String(laDate.getMonth() + 1).padStart(2, '0')
  const d = String(laDate.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * Extrae y normaliza las órdenes de entrega y para llevar (Off-Premise) de Toast con su contenido completo
 */
export async function fetchOffPremiseOrders(storeId: number, targetBusinessDate?: string): Promise<{
  orders: OffPremiseOrder[]
  storeName: string
  businessDate: string
}> {
  // 1. Buscar metadatos de la tienda en Supabase
  const { data: store, error: sErr } = await supabaseAdmin
    .from('stores')
    .select('id, name, external_id')
    .eq('id', storeId)
    .single()

  if (sErr || !store || !store.external_id) {
    throw new Error(`Sucursal ID ${storeId} no encontrada o sin external_id configurado.`)
  }

  const token = await getAuthToken()
  if (!token) {
    throw new Error('No se pudo autenticar con Toast API (token no disponible).')
  }
  const businessDate = targetBusinessDate || getToastBusinessDate()

  // 2. Mapeo dinámico de Dining Options
  const diningOptionsMap = await fetchDiningOptionsMap(token, store.external_id)

  // 3. Consultar órdenes en Toast API con ventana móvil en tiempo real (últimos 180 min) para cubrir el cambio automático a las 2 horas sin paginar desde las 6 AM ni truncar en la orden #200 por rate-limit
  const cacheKey = `${store.external_id}:${targetBusinessDate || 'LIVE'}`
  const nowMs = Date.now()
  const cachedRaw = toastRawOrdersCache.get(cacheKey)

  let rawOrders: any[] = []
  if (cachedRaw && nowMs - cachedRaw.at < TOAST_RAW_CACHE_TTL_MS) {
    rawOrders = cachedRaw.orders
  } else {
    let inflightJob = toastRawOrdersInflight.get(cacheKey)
    if (!inflightJob) {
      inflightJob = (async () => {
        const fetched: any[] = []
        let page = 1
        const maxPages = targetBusinessDate ? 20 : 5
        let abortedByError = false

        const endInstant = new Date()
        const startInstant = new Date(endInstant.getTime() - 180 * 60 * 1000)
        const formatToastIso = (d: Date) => d.toISOString().replace('Z', '+0000')

        while (page <= maxPages) {
          const ordersUrl = targetBusinessDate
            ? `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`
            : `${TOAST_API_HOST}/orders/v2/ordersBulk?startDate=${encodeURIComponent(
                formatToastIso(startInstant)
              )}&endDate=${encodeURIComponent(formatToastIso(endInstant))}&pageSize=100&page=${page}`

          const oRes = await fetch(ordersUrl, {
            cache: 'no-store',
            headers: {
              Authorization: `Bearer ${token}`,
              'Toast-Restaurant-External-ID': store.external_id
            }
          })

          if (!oRes.ok) {
            abortedByError = true
            if (cachedRaw?.orders?.length) {
              return cachedRaw.orders
            }
            if (page === 1) {
              const errText = await oRes.text().catch(() => '')
              throw new Error(`Error consultando órdenes en Toast API (${oRes.status}): ${errText.substring(0, 150)}`)
            }
            break
          }

          const chunk: any[] = await oRes.json()
          if (!Array.isArray(chunk) || chunk.length === 0) break
          fetched.push(...chunk)

          if (chunk.length < 100) break
          page++
        }

        // Nunca sobrescribir el caché si una página intermedia falló por rate-limit (evita mostrar órdenes viejas #200)
        if (!abortedByError || !cachedRaw?.orders?.length) {
          toastRawOrdersCache.set(cacheKey, { at: Date.now(), orders: fetched })
        }
        return fetched
      })().finally(() => {
        toastRawOrdersInflight.delete(cacheKey)
      })
      toastRawOrdersInflight.set(cacheKey, inflightJob)
    }
    rawOrders = await inflightJob
  }

  // 4. Cambiar automáticamente a UNCLAIMED_2H las auditorías que cumplan >= 2 horas sin ser recogidas por ningún chofer
  await autoExpireUnclaimedAudits(storeId, nowMs)

  const { data: existingAudits } = await supabaseAdmin
    .from('delivery_packing_audits')
    .select('*')
    .eq('store_id', storeId)

  const auditsMap = new Map<string, any>()
  existingAudits?.forEach(a => {
    auditsMap.set(a.toast_order_guid, a)
  })

  // 5. Filtrar órdenes relevantes (excluir comedor Dine-In tradicional)
  const offPremiseOrders: OffPremiseOrder[] = []

  for (const o of rawOrders) {
    if (o.deleted) continue
    const existingAudit = auditsMap.get(o.guid)
    if (o.voided && !existingAudit) continue

    const openedRaw = o.openedDate || o.createdDate || existingAudit?.order_opened_at
    const openedMs = openedRaw ? new Date(openedRaw).getTime() : NaN

    // En modo en vivo (tableta), descartar órdenes de otro día laboral (corte 6:00 AM) o abiertas hace más de 3 horas sin auditoría que Toast actualiza por cierre de lote/propinas (ej. #200 vs #670 actuales)
    if (!targetBusinessDate) {
      if (o.businessDate && String(o.businessDate) !== businessDate) {
        continue
      }
      if (!existingAudit && Number.isFinite(openedMs) && nowMs - openedMs > 180 * 60 * 1000) {
        continue
      }
    }

    const dGuid = o.diningOption?.guid || ''
    const dName = diningOptionsMap[dGuid] || o.diningOption?.name || 'Mostrador'
    const deliveryService = o.deliveryService?.name || ''
    const source = typeof o.source === 'string' ? o.source : (o.source?.name || '')

    // EL MÓDULO ES ESTRICTAMENTE DELIVERY: Descartar todo lo presencial (For Here, To Go, Kiosk, Phone)
    if (!isDeliveryPlatform(dName, deliveryService, source)) {
      continue
    }

    const platform = classifyPlatform(dName, deliveryService, source)

    // Extraer datos reales del cliente y la Clave Oficial de la Plataforma desde checks[0].tabName y customer
    const firstCheck = o.checks?.[0] || {}
    const custObj = o.customer || firstCheck.customer || {}
    const displayNumStr = String(o.displayNumber || o.orderNumber || 'S/N')

    const identity = extractPlatformOrderIdentity({
      platform,
      displayNumber: displayNumStr,
      tabName: firstCheck.tabName,
      firstName: custObj.firstName,
      lastName: custObj.lastName,
      fullName: custObj.name,
      email: custObj.email,
      phone: custObj.phone,
      deliveryNotes: o.deliveryInfo?.notes
    })

    const kds = extractKdsTiming(o)

    // Extraer productos y modificadores
    const items: OrderItemDetail[] = []
    const checks = o.checks || []

    checks.forEach((chk: any, checkIndex: number) => {
      const selections = chk.selections || []
      selections.forEach((sel: any, idx: number) => {
        const selName = sel.displayName || sel.itemGroup?.name || 'Artículo'
        const modifiersList: string[] = []

        if (Array.isArray(sel.modifiers)) {
          sel.modifiers.forEach((m: any) => {
            const modName = m.displayName || m.name || ''
            if (modName) {
              const qtyStr = m.quantity > 1 ? ` (x${m.quantity})` : ''
              modifiersList.push(`${modName}${qtyStr}`)
            }
          })
        }

        items.push({
          id: sel.guid || `${o.guid}:check_${checkIndex}:item_${idx}`,
          displayName: selName,
          quantity: Number.isFinite(Number(sel.quantity)) ? Math.max(0, Number(sel.quantity)) : 1,
          price: Number(sel.price || 0),
          modifiers: modifiersList,
          isHighRiskDrink: isHighRiskBeverage(selName)
        })
      })
    })

    if (items.length === 0) continue

    const isUnclaimed2h = isOrderUnclaimedByDriver({
      openedDate: openedRaw,
      packedAt: existingAudit?.packed_at,
      handedAt: existingAudit?.handed_at,
      status: existingAudit?.status,
      nowMs
    })

    // Si Toast actualizó el nombre del repartidor posteriormente (ej. Uber Eats en deliveryInfo.notes "Driver Pin: ... (Nombre)")
    // y nuestra auditoría no tenía nombre o tenía un placeholder genérico, sincronizarlo automáticamente en DB.
    const currentAuditDriver = (existingAudit?.driver_name || '').trim()
    const isGenericDriverPlaceholder =
      !currentAuditDriver ||
      currentAuditDriver.toLowerCase() === 'chofer verificado' ||
      currentAuditDriver.toLowerCase() === 'repartidor verificado'
    const resolvedDriverName =
      isGenericDriverPlaceholder && identity.assignedDriverHint
        ? identity.assignedDriverHint
        : existingAudit?.driver_name || identity.assignedDriverHint || null

    if (existingAudit?.id && isGenericDriverPlaceholder && identity.assignedDriverHint) {
      existingAudit.driver_name = identity.assignedDriverHint
      supabaseAdmin
        .from('delivery_packing_audits')
        .update({
          driver_name: identity.assignedDriverHint,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingAudit.id)
        .then(() => {})
    }

    offPremiseOrders.push({
      orderGuid: o.guid,
      displayNumber: displayNumStr,
      storeId,
      storeName: store.name,
      platform,
      diningOptionGuid: dGuid,
      diningOptionName: dName,
      customerName: identity.cleanCustomerName,
      maskedCustomerName: identity.maskedCustomerName,
      platformOrderKey: identity.platformOrderKey,
      shortOrderKey: identity.shortOrderKey,
      assignedDriverHint: identity.assignedDriverHint,
      openedDate: o.openedDate || new Date().toISOString(),
      kdsStatus: kds.kdsStatus,
      kdsSentAt: kds.kdsSentAt,
      kdsReadyAt: kds.kdsReadyAt,
      kdsPrepSeconds: kds.kdsPrepSeconds,
      isVoided: !!o.voided,
      items,
      totalItemsCount: items.reduce((acc, curr) => acc + curr.quantity, 0),
      audit: existingAudit
        ? {
            id: existingAudit.id,
            status:
              isUnclaimed2h && existingAudit.status !== 'DELIVERED'
                ? 'UNCLAIMED_2H'
                : existingAudit.status,
            matchedItems: Array.isArray(existingAudit.matched_items) ? existingAudit.matched_items : [],
            matchCompleted: !!existingAudit.match_completed,
            photoOpenUrl: existingAudit.photo_open_url,
            photoSealedUrl: existingAudit.photo_sealed_url,
            packerName: existingAudit.packer_ronos_name,
            packedAt: existingAudit.packed_at,
            handedByName: existingAudit.handed_by_ronos_name,
            handedAt: existingAudit.handed_at,
            driverName: resolvedDriverName,
            driverConfirmed: existingAudit.driver_confirmed,
            quickChecks: existingAudit.quick_checks || undefined,
            expectedBagCount: Number(existingAudit.expected_bag_count || 1),
            confirmedBagCount:
              existingAudit.confirmed_bag_count == null ? null : Number(existingAudit.confirmed_bag_count),
            riskLevel: existingAudit.risk_level || 'NORMAL',
            riskReasons: Array.isArray(existingAudit.risk_reasons) ? existingAudit.risk_reasons : [],
            evidencePolicy: existingAudit.evidence_policy || 'NONE',
            courierVerificationMethod: existingAudit.courier_verification_method || null,
            courierOrderReference: existingAudit.courier_order_reference || null,
            livePickupConfirmed: !!existingAudit.live_pickup_confirmed
          }
        : isUnclaimed2h
        ? {
            id: `unclaimed:${o.guid}`,
            status: 'UNCLAIMED_2H',
            matchedItems: [],
            matchCompleted: false,
            photoOpenUrl: null,
            photoSealedUrl: null,
            packerName: null,
            packedAt: null,
            handedByName: null,
            handedAt: null,
            driverName: null,
            driverConfirmed: false,
            expectedBagCount: 1,
            confirmedBagCount: null,
            riskLevel: 'NORMAL',
            riskReasons: [],
            evidencePolicy: 'NONE',
            courierVerificationMethod: null,
            courierOrderReference: null,
            livePickupConfirmed: false
          }
        : undefined
    })
  }

  // Ordenar: las más recientes primero (openedDate descendente)
  offPremiseOrders.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime())

  return {
    orders: offPremiseOrders,
    storeName: store.name,
    businessDate
  }
}

/**
 * Guarda o actualiza el progreso del checklist de coincidencia y las fotos de evidencia
 */
export async function saveAuditProgress(params: {
  storeId: number
  toastOrderGuid: string
  toastDisplayNumber: string
  platform: DeliveryPlatform
  diningOptionGuid?: string
  diningOptionName?: string
  customerName?: string
  orderOpenedAt?: string
  itemsJson: OrderItemDetail[]
  matchedItems: string[]
  matchCompleted: boolean
  photoOpenUrl?: string | null
  photoSealedUrl?: string | null
  packerRonosUserId?: number
  packerRonosName?: string
  packerPin?: string
  sessionToken?: string
  quickChecks: DeliveryQuickChecks
  expectedBagCount: number
  confirmedBagCount: number
  riskLevel: DeliveryRiskLevel
  riskReasons: string[]
  evidencePolicy: EvidencePolicy
}): Promise<any> {
  const {
    storeId,
    toastOrderGuid,
    toastDisplayNumber,
    platform,
    diningOptionGuid,
    diningOptionName,
    customerName,
    orderOpenedAt,
    itemsJson,
    matchedItems,
    matchCompleted,
    photoOpenUrl,
    photoSealedUrl,
    packerPin,
    sessionToken,
    quickChecks,
    expectedBagCount,
    confirmedBagCount,
    riskLevel,
    riskReasons,
    evidencePolicy
  } = params

  if (sessionToken) {
    const sessionCheck = await touchActiveStorePinSession(storeId, sessionToken)
    if (!sessionCheck.valid) {
      if (sessionCheck.replacedBy) {
        throw new Error(`SESSION_REPLACED:${sessionCheck.replacedBy}`)
      }
      throw new Error('SESSION_EXPIRED')
    }
  }

  if (!Number.isInteger(expectedBagCount) || expectedBagCount < 1 || expectedBagCount > 20) {
    throw new Error('La cantidad esperada de bolsas es inválida.')
  }
  if (confirmedBagCount !== expectedBagCount) {
    throw new Error('La cantidad confirmada de bolsas no coincide con la esperada.')
  }
  if (!areQuickChecksComplete(quickChecks) || !matchCompleted) {
    throw new Error('Debe concluirse el sellado de empaque antes de dejar lista la orden.')
  }
  if (!packerPin) throw new Error('Se requiere el PIN del colaborador responsable.')
  const verifiedPacker = await verifyRonosPin(storeId, packerPin)
  if (!verifiedPacker.valid || !verifiedPacker.employeeUserId || !verifiedPacker.fullName) {
    throw new Error(verifiedPacker.error || 'No fue posible validar al colaborador en RONOS.')
  }

  const status: AuditStatus = 'PACKED_AND_SEALED'

  const payload: any = {
    store_id: storeId,
    toast_order_guid: toastOrderGuid,
    toast_display_number: toastDisplayNumber,
    platform,
    dining_option_guid: diningOptionGuid || null,
    dining_option_name: diningOptionName || null,
    customer_name: customerName || null,
    order_opened_at: orderOpenedAt || null,
    items_json: itemsJson,
    matched_items: matchedItems,
    match_completed: matchCompleted,
    photo_open_url: photoOpenUrl || null,
    photo_sealed_url: photoSealedUrl || null,
    packer_ronos_user_id: verifiedPacker.employeeUserId,
    packer_ronos_name: verifiedPacker.fullName,
    packer_pin: null,
    quick_checks: quickChecks,
    expected_bag_count: expectedBagCount,
    confirmed_bag_count: confirmedBagCount,
    risk_level: riskLevel,
    risk_reasons: riskReasons,
    evidence_policy: evidencePolicy,
    packed_at: new Date().toISOString(),
    status,
    updated_at: new Date().toISOString()
  }

  const { data: existing } = await supabaseAdmin
    .from('delivery_packing_audits')
    .select('id, status')
    .eq('toast_order_guid', toastOrderGuid)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'DELIVERED') {
      throw new Error('La orden ya fue liberada al chofer y no puede regresar a empaque.')
    }
    const { data: updated, error } = await supabaseAdmin
      .from('delivery_packing_audits')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single()

    if (error) throw new Error(`Error actualizando auditoría: ${error.message}`)
    return updated
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from('delivery_packing_audits')
      .insert(payload)
      .select('*')
      .single()

    if (error) throw new Error(`Error registrando auditoría: ${error.message}`)
    return inserted
  }
}

/**
 * Registra la entrega final de la bolsa sellada al repartidor
 */
export async function confirmHandoffToDriver(params: {
  toastOrderGuid: string
  storeId: number
  handedByRonosUserId: number
  handedByRonosName: string
  handedPin: string
  sessionToken?: string
  driverName?: string
  driverConfirmed: boolean
  verificationMethod: CourierVerificationMethod
  courierOrderReference: string
  livePickupConfirmed: boolean
}): Promise<any> {
  const {
    toastOrderGuid,
    storeId,
    handedPin,
    sessionToken,
    driverName,
    driverConfirmed,
    verificationMethod,
    courierOrderReference,
    livePickupConfirmed
  } = params

  if (sessionToken) {
    const sessionCheck = await touchActiveStorePinSession(storeId, sessionToken)
    if (!sessionCheck.valid) {
      if (sessionCheck.replacedBy) {
        throw new Error(`SESSION_REPLACED:${sessionCheck.replacedBy}`)
      }
      throw new Error('SESSION_EXPIRED')
    }
  }

  const verifiedEmployee = await verifyRonosPin(storeId, handedPin)
  if (!verifiedEmployee.valid || !verifiedEmployee.employeeUserId || !verifiedEmployee.fullName) {
    throw new Error(verifiedEmployee.error || 'No fue posible validar al colaborador en RONOS.')
  }
  if (!driverConfirmed || !livePickupConfirmed || !courierOrderReference.trim()) {
    throw new Error('Debe observarse la confirmación en vivo y registrarse la referencia de la orden.')
  }

  const { data: current, error: currentError } = await supabaseAdmin
    .from('delivery_packing_audits')
    .select('id, store_id, status, match_completed, quick_checks, expected_bag_count, confirmed_bag_count, platform, evidence_policy, photo_sealed_url')
    .eq('toast_order_guid', toastOrderGuid)
    .maybeSingle()

  if (currentError || !current) throw new Error('Primero debes concluir el sellado de empaque antes de entregar la orden.')
  if (Number(current.store_id) !== storeId) throw new Error('La orden no pertenece a la sucursal activa.')
  if (current.status === 'DELIVERED') throw new Error('La orden ya fue liberada al chofer.')
  if (
    (current.status !== 'PACKED_AND_SEALED' && current.status !== 'UNCLAIMED_2H') ||
    !current.match_completed ||
    !areQuickChecksComplete(current.quick_checks)
  ) {
    throw new Error('Primero debes concluir el sellado de empaque antes de entregar la orden.')
  }
  if (Number(current.expected_bag_count) !== Number(current.confirmed_bag_count)) {
    throw new Error('La cantidad de bolsas no está confirmada.')
  }
  if (current.platform === 'DOORDASH' && verificationMethod !== 'DOORDASH_QR') {
    throw new Error('DoorDash requiere verificar el QR nativo del ticket en la app del Dasher.')
  }
  if (current.platform !== 'DOORDASH' && verificationMethod === 'DOORDASH_QR') {
    throw new Error('El método QR de DoorDash no corresponde a esta plataforma.')
  }

  const payload = {
    handed_by_ronos_user_id: verifiedEmployee.employeeUserId,
    handed_by_ronos_name: verifiedEmployee.fullName,
    handed_pin: null,
    handed_at: new Date().toISOString(),
    driver_name: driverName || 'Repartidor Verificado',
    driver_confirmed: driverConfirmed,
    courier_verification_method: verificationMethod,
    courier_order_reference: courierOrderReference.trim().slice(0, 32),
    live_pickup_confirmed: livePickupConfirmed,
    status: 'DELIVERED' as AuditStatus,
    updated_at: new Date().toISOString()
  }

  const { data: updated, error } = await supabaseAdmin
    .from('delivery_packing_audits')
    .update(payload)
    .eq('id', current.id)
    .in('status', ['PACKED_AND_SEALED', 'UNCLAIMED_2H'])
    .select('*')
    .single()

  if (error) throw new Error(`Error confirmando entrega de orden: ${error.message}`)
  return updated
}

/**
 * Genera el paquete de pruebas formal (Dispute Dossier) listo para copiar o enviar a DoorDash / Uber Eats
 */
export function formatDisputeStatement(audit: any): string {
  const dateFormatted = audit.packed_at 
    ? new Date(audit.packed_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    : new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })

  const itemsList = Array.isArray(audit.items_json)
    ? audit.items_json.map((i: any) => `- ${i.quantity}x ${i.displayName} ($${Number(i.price).toFixed(2)})`).join('\n')
    : 'All ordered items'

  const platformKey = audit.courier_order_reference || audit.quick_checks?.platformOrderKey || `#${audit.toast_display_number || 'N/A'}`
  const kdsSeconds = audit.quick_checks?.kdsPrepSeconds
  const kdsLine = Number.isFinite(Number(kdsSeconds))
    ? `KITCHEN KDS PREP TIME: ${Math.floor(Number(kdsSeconds) / 60)}m ${Number(kdsSeconds) % 60}s (Cleared by Kitchen before Packing)\n`
    : ''
  const isUnclaimed2h = audit.status === 'UNCLAIMED_2H' || audit.status === 'unclaimed'
  const handoffLine = isUnclaimed2h
    ? 'UNCLAIMED BY DRIVER AFTER 2+ HOURS (Auto-status: UNCLAIMED_2H)'
    : `${audit.handed_by_ronos_name || 'Counter Staff'} (Handoff at: ${audit.handed_at || 'Verified'})`

  return `
DISPUTE REPRESENTMENT DOSSIER — TACOS GAVILAN
--------------------------------------------------------------------------------
MERCHANT: Tacos Gavilan (Store #${audit.store_id})
ORDER NUMBER / DISPLAY ID: #${audit.toast_display_number || 'N/A'}
PLATFORM ORDER KEY / CLAVE: ${platformKey}
PLATFORM / CHANNEL: ${audit.platform} (${audit.dining_option_name || 'Delivery'})
${kdsLine}FULFILLMENT TIMESTAMP: ${dateFormatted} PST
VERIFIED PACKER: ${audit.packer_ronos_name || 'Staff Employee'} (RONOS ID #${audit.packer_ronos_user_id || 'N/A'})
HANDOFF AGENT: ${handoffLine}

OFFICIAL DISPUTE STATEMENT:
"This order passed the restaurant's four-point release control for prepared items, beverages, bag count, and seal integrity.
The custody record identifies the responsible restaurant employee and the fulfillment timestamp.${isUnclaimed2h ? '\nNo platform courier arrived to pick up the order within 2 hours of preparation; the system automatically recorded its status as UNCLAIMED_2H (No Courier Pickup After 2+ Hours).' : `\nCourier verification method: ${audit.courier_verification_method || 'not recorded'}; order key verified: ${platformKey}; live pickup confirmation observed: ${audit.live_pickup_confirmed ? 'yes' : 'no'}.`}
${audit.photo_sealed_url ? 'A timestamped photograph of the sealed bag and visible ticket is attached.' : 'No photographic evidence is asserted for this order.'}
We request a review of the error charge against the attached order-level custody evidence."

VERIFIED PACKED ITEMS:
${itemsList}

AVAILABLE EVIDENCE:
1. Sealed bag and ticket: ${audit.photo_sealed_url || 'Not captured / not asserted'}
--------------------------------------------------------------------------------
`.trim()
}
