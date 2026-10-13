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

export type DeliveryRiskLevel = 'NORMAL' | 'HIGH'
export type EvidencePolicy = 'NONE' | 'SEALED_BAG'
export type CourierVerificationMethod = 'DOORDASH_QR' | 'PLATFORM_ORDER_ID' | 'APP_ORDER_SCREEN'

export interface DeliveryQuickChecks {
  foodComplete: boolean
  drinksComplete: boolean
  bagCountCorrect: boolean
  bagSealed: boolean
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
  openedDate: string
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

/**
 * Detecta si un ítem corresponde a una bebida o producto refrigerado de alto riesgo de olvido
 */
export function isHighRiskBeverage(name: string): boolean {
  const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return (
    n.includes('horchata') ||
    n.includes('jamaica') ||
    n.includes('tamarindo') ||
    n.includes('fresa') ||
    n.includes('limon') ||
    n.includes('soda') ||
    n.includes('coke') ||
    n.includes('coca') ||
    n.includes('sprite') ||
    n.includes('jarrito') ||
    n.includes('sidral') ||
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

/**
 * Consulta las opciones de comedor (Dining Options) de Toast de forma dinámica (Protocolo Toast API)
 */
async function fetchDiningOptionsMap(token: string, storeExternalId: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeExternalId
      }
    })
    if (!res.ok) return {}
    const data = await res.json()
    const map: Record<string, string> = {}
    if (Array.isArray(data)) {
      data.forEach((opt: any) => {
        if (opt.guid && opt.name) {
          map[opt.guid] = opt.name
        }
      })
    }
    return map
  } catch {
    return {}
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

  // 3. Consultar órdenes en Toast API con paginación completa para el día laboral actual
  const rawOrders: any[] = []
  let page = 1
  const maxPages = 20 // Seguridad para prevenir bucles (hasta 2,000 órdenes diarias)

  while (page <= maxPages) {
    const ordersUrl = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`
    const oRes = await fetch(ordersUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': store.external_id
      }
    })

    if (!oRes.ok) {
      if (page === 1) {
        const errText = await oRes.text().catch(() => '')
        throw new Error(`Error consultando órdenes en Toast API (${oRes.status}): ${errText.substring(0, 150)}`)
      }
      break
    }

    const chunk: any[] = await oRes.json()
    if (!Array.isArray(chunk) || chunk.length === 0) break
    rawOrders.push(...chunk)

    // Si la página devolvió menos de 100 órdenes, ya se descargó el 100% de órdenes del día
    if (chunk.length < 100) break
    page++
  }

  // 4. Consultar auditorías existentes en Supabase para vincular su estado actual
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
    if (o.voided || o.deleted) continue

    const dGuid = o.diningOption?.guid || ''
    const dName = diningOptionsMap[dGuid] || o.diningOption?.name || 'Mostrador'
    const deliveryService = o.deliveryService?.name || ''
    const source = typeof o.source === 'string' ? o.source : (o.source?.name || '')

    // EL MÓDULO ES ESTRICTAMENTE DELIVERY: Descartar todo lo presencial (For Here, To Go, Kiosk, Phone)
    if (!isDeliveryPlatform(dName, deliveryService, source)) {
      continue
    }

    const platform = classifyPlatform(dName, deliveryService, source)

    // Extraer datos reales del cliente de la plataforma (Toast ubica clientes en o.checks[0].customer o en o.customer)
    const custObj = o.customer || o.checks?.[0]?.customer
    const platformLabel = platform === 'DOORDASH' ? 'DoorDash' : platform === 'UBER_EATS' ? 'Uber Eats' : platform === 'GRUBHUB' ? 'Grubhub' : 'Online'
    let customerName = `Cliente ${platformLabel}`
    if (custObj) {
      let fName = String(custObj.firstName || '').trim()
      const lName = String(custObj.lastName || '').trim()
      
      // Limpieza de prefijos técnicos de Uber Eats como 'UE-Wendy27537' -> 'Wendy (UE-27537)'
      if (fName.startsWith('UE-')) {
        const match = fName.match(/^UE-([a-zA-Z]+)(\d+.*)$/)
        if (match) {
          fName = `${match[1]} (${match[2]})`
        }
      }

      if (fName || lName) {
        customerName = `${fName} ${lName}`.trim()
      } else if (custObj.name) {
        customerName = String(custObj.name).trim()
      }
    }

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

    const existingAudit = auditsMap.get(o.guid)

    offPremiseOrders.push({
      orderGuid: o.guid,
      displayNumber: String(o.displayNumber || o.orderNumber || 'S/N'),
      storeId,
      storeName: store.name,
      platform,
      diningOptionGuid: dGuid,
      diningOptionName: dName,
      customerName,
      openedDate: o.openedDate || new Date().toISOString(),
      items,
      totalItemsCount: items.reduce((acc, curr) => acc + curr.quantity, 0),
      audit: existingAudit ? {
        id: existingAudit.id,
        status: existingAudit.status,
        matchedItems: Array.isArray(existingAudit.matched_items) ? existingAudit.matched_items : [],
        matchCompleted: !!existingAudit.match_completed,
        photoOpenUrl: existingAudit.photo_open_url,
        photoSealedUrl: existingAudit.photo_sealed_url,
        packerName: existingAudit.packer_ronos_name,
        packedAt: existingAudit.packed_at,
        handedByName: existingAudit.handed_by_ronos_name,
        handedAt: existingAudit.handed_at,
        driverConfirmed: existingAudit.driver_confirmed,
        quickChecks: existingAudit.quick_checks || undefined,
        expectedBagCount: Number(existingAudit.expected_bag_count || 1),
        confirmedBagCount: existingAudit.confirmed_bag_count == null ? null : Number(existingAudit.confirmed_bag_count),
        riskLevel: existingAudit.risk_level || 'NORMAL',
        riskReasons: Array.isArray(existingAudit.risk_reasons) ? existingAudit.risk_reasons : [],
        evidencePolicy: existingAudit.evidence_policy || 'NONE',
        courierVerificationMethod: existingAudit.courier_verification_method || null,
        courierOrderReference: existingAudit.courier_order_reference || null,
        livePickupConfirmed: !!existingAudit.live_pickup_confirmed
      } : undefined
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
    packerRonosUserId,
    packerRonosName,
    packerPin,
    quickChecks,
    expectedBagCount,
    confirmedBagCount,
    riskLevel,
    riskReasons,
    evidencePolicy
  } = params

  if (!Number.isInteger(expectedBagCount) || expectedBagCount < 1 || expectedBagCount > 20) {
    throw new Error('La cantidad esperada de bolsas es inválida.')
  }
  if (confirmedBagCount !== expectedBagCount) {
    throw new Error('La cantidad confirmada de bolsas no coincide con la esperada.')
  }
  if (!areQuickChecksComplete(quickChecks) || !matchCompleted) {
    throw new Error('Los cuatro controles rápidos deben estar confirmados antes de dejar lista la orden.')
  }
  if (evidencePolicy === 'SEALED_BAG' && !photoSealedUrl) {
    throw new Error('Esta orden de riesgo requiere una foto de la bolsa sellada con el ticket visible.')
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
    driverName,
    driverConfirmed,
    verificationMethod,
    courierOrderReference,
    livePickupConfirmed
  } = params

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

  if (currentError || !current) throw new Error('La orden no tiene un registro de empaque listo para liberar.')
  if (Number(current.store_id) !== storeId) throw new Error('La orden no pertenece a la sucursal activa.')
  if (current.status === 'DELIVERED') throw new Error('La orden ya fue liberada al chofer.')
  if (current.status !== 'PACKED_AND_SEALED' || !current.match_completed || !areQuickChecksComplete(current.quick_checks)) {
    throw new Error('La orden todavía no cumple los controles de empaque y sello.')
  }
  if (Number(current.expected_bag_count) !== Number(current.confirmed_bag_count)) {
    throw new Error('La cantidad de bolsas no está confirmada.')
  }
  if (current.evidence_policy === 'SEALED_BAG' && !current.photo_sealed_url) {
    throw new Error('Falta la evidencia requerida para esta orden de riesgo.')
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
    courier_order_reference: courierOrderReference.trim().slice(-12),
    live_pickup_confirmed: livePickupConfirmed,
    status: 'DELIVERED' as AuditStatus,
    updated_at: new Date().toISOString()
  }

  const { data: updated, error } = await supabaseAdmin
    .from('delivery_packing_audits')
    .update(payload)
    .eq('id', current.id)
    .eq('status', 'PACKED_AND_SEALED')
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

  return `
DISPUTE REPRESENTMENT DOSSIER — TACOS GAVILAN
--------------------------------------------------------------------------------
MERCHANT: Tacos Gavilan (Store #${audit.store_id})
ORDER NUMBER / DISPLAY ID: #${audit.toast_display_number || 'N/A'}
PLATFORM / CHANNEL: ${audit.platform} (${audit.dining_option_name || 'Delivery'})
FULFILLMENT TIMESTAMP: ${dateFormatted} PST
VERIFIED PACKER: ${audit.packer_ronos_name || 'Staff Employee'} (RONOS ID #${audit.packer_ronos_user_id || 'N/A'})
HANDOFF AGENT: ${audit.handed_by_ronos_name || 'Counter Staff'} (Handoff at: ${audit.handed_at || 'Verified'})

OFFICIAL DISPUTE STATEMENT:
"This order passed the restaurant's four-point release control for prepared items, beverages, bag count, and seal integrity.
The custody record identifies the responsible restaurant employee and the handoff time.
Courier verification method: ${audit.courier_verification_method || 'not recorded'}; live pickup confirmation observed: ${audit.live_pickup_confirmed ? 'yes' : 'no'}.
${audit.photo_sealed_url ? 'A timestamped photograph of the sealed bag and visible ticket is attached.' : 'No photographic evidence is asserted for this order.'}
We request a review of the error charge against the attached order-level custody evidence."

VERIFIED PACKED ITEMS:
${itemsList}

AVAILABLE EVIDENCE:
1. Sealed bag and ticket: ${audit.photo_sealed_url || 'Not captured / not asserted'}
--------------------------------------------------------------------------------
`.trim()
}
