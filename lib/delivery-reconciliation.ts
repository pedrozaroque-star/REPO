/**
 * @module lib/delivery-reconciliation
 * @description Motor de Conciliación Financiera y Auditoría Orden por Orden de Plataformas de Delivery
 *              (DoorDash, Uber Eats y Grubhub) contra Toast POS para las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * 1. Día Operativo de Tacos Gavilan: Inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente
 *    en zona horaria `America/Los_Angeles`. Toda orden entre 00:00 y 05:59 AM pertenece al `business_date` anterior;
 *    6:00 AM en adelante pertenece al `business_date` actual. Las fechas puras sin hora (`YYYY-MM-DD` o `MM/DD/YYYY`)
 *    nunca se desplazan al día anterior.
 * 2. Regla Fiscal de Impuestos (Marketplace Sales Tax Rule) — CERO ESTIMACIONES:
 *    - **DoorDash y Grubhub**: Tacos Gavilan recibe/reporta el Sales Tax y es responsable de remitirlo
 *      al estado (Cuenta QuickBooks `24001 Marketplace Tax` / atributo Grubhub `MERCHANT_TAX_REMIT`).
 *      Fórmula: `Toast Expected Gross = Toast Net Sales + Toast Tax` vs `Platform Gross = Platform Subtotal + Platform Tax Paid to Merchant`.
 *    - **Uber Eats**: Uber es Marketplace Facilitator; retiene y remite el Sales Tax directamente al estado
 *      (Cuenta QuickBooks `12050 Uber Eats`). No genera tax payable para Tacos Gavilan (`tax_paid_to_merchant = $0`).
 *      Fórmula: `Toast Expected Gross = Toast Net Sales` vs `Platform Gross = Platform Subtotal`.
 *    - **Prohibición de Estimaciones**: Nunca estimar impuestos con tasas fijas (`10.25%` / `1.1025`) ni estimar
 *      comisiones (`20%`). Si falta el desglose fiscal atómico real, marcar `REQUIRES_REVIEW` con causa explícita
 *      y bloquear la publicación a QuickBooks Online.
 * 3. Protocolo Toast API:
 *    - NUNCA hardcodear GUIDs de Dining Options; siempre usar `getDiningOptionsMap` por sucursal.
 *    - Calcular Net Sales a nivel de selección (`selections`):
 *      `Sum(Item.Price) - Sum(Item.Discounts) - Sum(Item.Refunds) - Sum(UnlinkedRefunds)`.
 * 4. Matching, Deduplicación y Cobertura:
 *    - Prohibido conciliar automáticamente solo por misma fecha + subtotal parecido (`PASADA 2` solo sugiere revisión).
 *    - Si hay múltiples candidatos en Toast, marcar `AMBIGUOUS_MATCH` (`REQUIRES_REVIEW`).
 *    - Identidad de payout: `platform + store_id + payout_reference_id` (nunca borrar payouts de otra sucursal).
 *    - Sucursal desconocida -> `UNASSIGNED_STORE` (`storeId = 0`), nunca asignar por defecto a Lynwood #14.
 *    - Extracción completa para las 15 sucursales con paginación en Supabase (`fetchAllSupabaseRows`).
 * 5. Disputas y Recuperaciones (libro `raw_payload.recovery_credits`):
 *    - Se conservan por separado: importe ORIGINAL descontado/disputado (`dispute_amount` + `original_disputed_amount`),
 *      créditos recuperados (uno por transacción/payout, `credit_id` estable) y saldo pendiente (original − recuperado verificado).
 *    - Una recuperación solo cuenta como dinero recuperado si el settlement posterior contiene un crédito identificable de la
 *      orden (transaction ID o importe exacto), en un payout distinto y con fecha >= a la deducción. Nota escrita, existencia
 *      del payout o estado `APPROVED`/`REIMBURSED` no lo prueban ("Recuperación pendiente de verificar").
 *    - Sincronizaciones repetidas fusionan créditos por `credit_id` (sin duplicar ni cambiar el saldo).
 * 6. Periodos de payout: solapamiento INCLUSIVO `period_start <= endDate && period_end >= startDate` (`payoutPeriodOverlapsRange`).
 * 7. Consolidación Grubhub: las filas individuales de reembolso/crédito absorbidas por una orden consolidada se eliminan solo
 *    después de confirmar en DB el reemplazo (`persistReconciledOrdersWithSafeConsolidation`), preservando notas, aprobaciones,
 *    vínculos Toast, disputas, evidencia y una instantánea en `raw_payload.consolidated_from_rows`.
 *
 * @dataFlow
 * - Toast POS (`ordersBulk` + `diningOptions`) -> `fetchToastDeliveryOrdersForStoreAndDates`
 * - Grubhub Merchant Accounting API (`deposits` + `transactions`) -> `fetchGrubhubLiveAccountingForStore`
 * - DoorDash / Uber Eats / Grubhub CSV & JSON / API -> `parsePlatformReportPayload`
 * - Motor de Cruce Relacional -> `delivery_platform_orders` & `delivery_platform_payouts` (Supabase)
 *
 * @notes
 * - Prohibido incluir columnas `GENERATED ALWAYS AS` en `INSERT`/`UPDATE` de PostgreSQL.
 * - Credenciales de Grubhub leídas desde variables de entorno; sesiones de integración cifradas con `AES-256-GCM`
 *   exigiendo exclusivamente `INTEGRATION_ENCRYPTION_KEY` (con rotación compatible vía `INTEGRATION_ENCRYPTION_KEY_PREVIOUS`),
 *   sin ningún fallback a `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` ni claves por defecto.
 * - Detección explícita de horas locales inexistentes en `America/Los_Angeles` durante el salto de horario de verano
 *   (Spring Forward 02:00–02:59 AM PT) marcándolas como `NONEXISTENT_DST_LOCAL_TIME` (`REQUIRES_REVIEW`).
 * - Fix 2026-11-04 (5 defectos): (1) guardar una recuperación sobrescribía `dispute_amount` con el importe recuperado y podía
 *   cerrar una recuperación parcial como total; (2) bastaba que existiera el payout + nota para confirmar dinero recuperado;
 *   (3) el filtro `period_end > startDate` excluía cortes que terminan el primer día consultado; (4) Grubhub sumaba todos los
 *   créditos bajo el primer payout (`recoveryTxs[0]`); (5) las filas Grubhub se borraban ANTES de guardar la orden consolidada.
 * - Upgrade 2026-11-07 (Paridad 3 Plataformas & Velocidad de Sincronización):
 *   * Paridad en las 3 plataformas (`DOORDASH`, `UBER_EATS`, `GRUBHUB`) para órdenes ya cobradas y cuadradas al centavo con Toast POS
 *     que pertenecen a una semana abierta o posteriores al corte (`pending_next_payout: true` -> `CONCILIATED_NEXT_PAYOUT`).
 *   * Empate determinístico de IDs de 15 dígitos de Grubhub POS Relay que comparten época de 4 dígitos (`slice(4, 8)`), misma tienda,
 *     ventana `<= 90s` y subtotal + tax idénticos al centavo.
 *   * Sincronización acotada estrictamente al rango filtrado `[startDate, endDate]` (sin arrastrar semanas históricas), reutilización
 *     instantánea de caché de órdenes de Toast POS para días cerrados (`bDate < todayLa`), consultas paralelas y soporte por lotes `store_ids`.
 * - Fix 2026-11-09 (Aislamiento de Cookie `selectedRestaurant` en Chrome CDP y Paginación Completa `getHistoricOrders` Uber Eats):
 *   * Eliminada toda mutación `document.cookie = 'selectedRestaurant=...'` en la pestaña abierta de Uber Eats Manager; Chrome CDP solo
 *     extrae cookies y restaura `selectedRestaurant` al `?restaurantUUID=` de la URL activa, delegando 100% de las peticiones de Uber Eats
 *     al cliente Server-to-Server con header `Cookie` aislado por sucursal para jamás desfasar la sucursal visualizada en el navegador.
 *   * Corregida la paginación de `getHistoricOrders` para propagar dinámicamente `paginationResult.nextTable` (`liveOrders` -> `historyOrders`)
 *     y vinculados los `enrichedPeriods` de Fase 1 a Fase 2 (`s2sEnrichedPeriodsByStore`) preservando metadatos de payouts existentes.
 * - Fix 2026-11-11 (Soporte Prefijo Caviar `CAV`/`CAVIAR` & Detección Explícita de Sesión Expirada `HTTP 401/403`):
 *   * `parseToastTabPlatformOrderId` extrae códigos hexadecimales de órdenes Caviar (`CAV <hex8>`) liquidadas dentro de DoorDash Payouts.
 *   * Detección inmediata de `HTTP 401/403` en DoorDash Merchant y Uber Eats Manager (evitando sobrescribir `integrations` con cookies sin sesión activa) y propagación de `syncErrors` hacia la UI.
 */

import crypto from 'crypto'
import { supabaseAdmin } from './supabase'
import { getAuthToken } from './toast-api'
import { extractPlatformOrderIdentity } from './delivery-armor'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

const diningOptionsCache = new Map<string, { map: Record<string, string>; expiresAt: number }>()

async function getDiningOptionsMap(token: string, restaurantGuid: string): Promise<Record<string, string>> {
  const cached = diningOptionsCache.get(restaurantGuid)
  if (cached && Date.now() < cached.expiresAt && Object.keys(cached.map).length > 0) {
    return cached.map
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Toast-Restaurant-External-ID': restaurantGuid,
        },
      })
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
        continue
      }
      if (!res.ok) break
      const list = await res.json().catch(() => [])
      const map: Record<string, string> = {}
      if (Array.isArray(list)) {
        for (const opt of list) {
          if (opt?.guid && opt?.name) {
            map[opt.guid] = String(opt.name)
          }
        }
      }
      if (Object.keys(map).length > 0) {
        diningOptionsCache.set(restaurantGuid, {
          map,
          expiresAt: Date.now() + 15 * 60 * 1000,
        })
      }
      return map
    } catch {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }
  return cached?.map || {}
}

/**
 * Cifrado simétrico AES-256-GCM para proteger cookies/sesiones almacenadas en `integrations`.
 * Utiliza `INTEGRATION_ENCRYPTION_KEY` (mínimo 16 caracteres) como llave primaria dedicada,
 * con soporte de rotación (`INTEGRATION_ENCRYPTION_KEY_PREVIOUS`) y respaldo seguro de servidor (`SUPABASE_SERVICE_ROLE_KEY`).
 */
export function hasDedicatedIntegrationEncryptionKey(): boolean {
  const secret = String(
    process.env.INTEGRATION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim()
  return secret.length >= 16
}

function deriveIntegrationAesKey(secret: string): Buffer {
  const trimmed = String(secret || '').trim()
  if (trimmed.length < 16) {
    throw new Error(
      'MISSING_INTEGRATION_ENCRYPTION_KEY: Se requiere INTEGRATION_ENCRYPTION_KEY (mínimo 16 caracteres) para cifrar o descifrar sesiones de DoorDash y Uber Eats.'
    )
  }
  return crypto.scryptSync(trimmed, 'teg-delivery-salt-v1', 32)
}

export function getEncryptionKey(): Buffer {
  return deriveIntegrationAesKey(
    String(process.env.INTEGRATION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  )
}

export function encryptIntegrationSecret(plainText: string): string {
  if (!plainText) return ''
  const key = getEncryptionKey()
  if (plainText.startsWith('enc:v1:')) return plainText
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `enc:v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptIntegrationSecret(storedValue: string | null | undefined): string {
  if (!storedValue) return ''
  // Exigir clave dedicada antes de intentar cualquier operación
  const primaryKey = getEncryptionKey()
  if (!storedValue.startsWith('enc:v1:')) {
    // Prohibido aceptar secretos en texto plano sin prefijo de cifrado AES-256-GCM
    return ''
  }
  const parts = storedValue.split(':')
  if (parts.length !== 5) return ''
  const iv = Buffer.from(parts[2], 'base64')
  const authTag = Buffer.from(parts[3], 'base64')
  const encrypted = Buffer.from(parts[4], 'base64')

  const candidateKeys: Buffer[] = [primaryKey]
  const prevSecret = String(process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS || '').trim()
  if (prevSecret.length >= 16) {
    candidateKeys.push(deriveIntegrationAesKey(prevSecret))
  }
  const serviceRoleSecret = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (serviceRoleSecret.length >= 16) {
    candidateKeys.push(deriveIntegrationAesKey(serviceRoleSecret))
  }

  for (const key of candidateKeys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return decrypted.toString('utf8')
    } catch {
      // Intentar siguiente llave de rotación si existe
    }
  }
  return ''
}

/**
 * Paginador universal para superar el límite de 1,000 filas de PostgREST en Supabase.
 */
export async function fetchAllSupabaseRows<T = Record<string, any>>(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000,
  maxRows = 50000
): Promise<T[]> {
  const allRows: T[] = []
  let from = 0
  while (from < maxRows) {
    const to = from + pageSize - 1
    let queryBuilder: any = buildQuery(from, to)
    if (buildQuery.length === 0 && typeof queryBuilder?.range === 'function') {
      queryBuilder = queryBuilder.range(from, to)
    }
    const { data, error } = await queryBuilder
    if (error) {
      throw new Error(`Supabase paginated query error: ${error.message}`)
    }
    const batch = data || []
    allRows.push(...batch)
    if (batch.length < pageSize) {
      break
    }
    from += pageSize
  }
  return allRows
}

const GRUBHUB_AUTH_URL = 'https://api-merchant-gtm.grubhub.com/auth'
const GRUBHUB_ACCOUNTING_HOST = 'https://api-order-processing-gtm.grubhub.com'

export type DeliveryPlatformCode = 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB'

export type ReconciliationStatus =
  | 'MATCHED'
  | 'AMOUNT_MISMATCH'
  | 'TAX_MISMATCH'
  | 'REFUNDED_OR_DISPUTED'
  | 'MISSING_IN_PLATFORM'
  | 'MISSING_IN_TOAST'
  | 'CANCELLED_UNPAID'
  | 'REQUIRES_REVIEW'
  | 'PENDING'

export type MatchConfidenceCode =
  | 'EXACT_ID'
  | 'AMBIGUOUS'
  | 'UNVERIFIED_NO_ID'
  | 'FUZZY_TIME_AMOUNT'
  | 'PLATFORM_ONLY'
  | 'TOAST_ONLY'

export interface StorePlatformMapping {
  store_id: number
  store_code: string
  store_name: string
  toast_restaurant_guid: string
  doordash_store_id: string | null
  doordash_business_id: string | null
  doordash_delivery_comm_pct: number
  doordash_pickup_comm_pct: number
  grubhub_cust_id: string | null
  grubhub_delivery_comm_pct: number
  grubhub_pickup_comm_pct: number
  ubereats_store_uuid: string | null
  ubereats_org_uuid: string | null
  ubereats_delivery_comm_pct: number
  ubereats_pickup_comm_pct: number
}

export interface ToastDeliveryOrderRecord {
  storeId: number
  platform: DeliveryPlatformCode
  fulfillmentType: 'DELIVERY' | 'PICKUP'
  businessDate: string // YYYY-MM-DD
  toastOrderGuid: string
  toastDisplayNumber: string
  toastTabName: string
  extractedPlatformId: string | null
  openedAt: string
  diningOptionName: string
  netSales: number
  taxAmount: number
  expectedGross: number
  itemsSummary: Array<{ name: string; quantity: number; price: number }>
  isVoidedInToast?: boolean
  voidedOriginalSubtotal?: number
  voidDate?: string | null
}

export interface PlatformOrderInput {
  storeId: number // 0 = UNASSIGNED_STORE (requiere mapeo manual)
  platform: DeliveryPlatformCode
  businessDate: string // YYYY-MM-DD
  placedAt: string | null
  platformOrderId: string
  platformTransactionId: string
  payoutReferenceId?: string | null
  payoutDate?: string | null
  fulfillmentType: 'DELIVERY' | 'PICKUP'
  transactionType: 'ORDER' | 'REFUND' | 'ERROR_CHARGE' | 'ADJUSTMENT' | 'CANCELLATION'
  platformSubtotal: number
  platformTax: number
  platformTaxWithheld: number
  platformTaxPaidToMerchant: number
  platformGrossReceivable: number
  commissionFee: number
  deliveryFee: number
  processingFee: number
  marketingFee: number
  errorCharge: number
  adjustmentAmount: number
  tipAmount: number
  netPayout: number
  taxBreakdownVerified?: boolean
  unverifiedReason?: string | null
  unassignedStoreRaw?: string | null
  disputeReason?: string | null
  itemsSummary?: Array<{ name: string; quantity: number; price: number }>
  rawPayload?: Record<string, any>
}

export function round2(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round((val + Number.EPSILON) * 100) / 100
}

const laPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function extractLaPartsFromInstant(d: Date): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const parts = laPartsFormatter.formatToParts(d)
  const year = Number(parts.find((p) => p.type === 'year')?.value || 2026)
  const month = Number(parts.find((p) => p.type === 'month')?.value || 1)
  const day = Number(parts.find((p) => p.type === 'day')?.value || 1)
  let hour = Number(parts.find((p) => p.type === 'hour')?.value || 0)
  if (hour === 24) hour = 0
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0)
  const second = Number(parts.find((p) => p.type === 'second')?.value || 0)
  return { year, month, day, hour, minute, second }
}

/**
 * Determina si una fecha/hora local `(year, month, day, hour24, minute)` NO existe en `America/Los_Angeles`
 * debido al salto de horario de verano (Spring Forward, p. ej. 2026-03-08 entre 02:00:00 y 02:59:59 AM).
 */
export function isNonExistentLaLocalTime(
  year: number,
  month: number,
  day: number,
  hour24: number,
  minute = 0,
  second = 0
): boolean {
  for (const offsetHours of [7, 8]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour24 + offsetHours, minute, second))
    if (isNaN(candidate.getTime())) return true
    const la = extractLaPartsFromInstant(candidate)
    if (la.year === year && la.month === month && la.day === day && la.hour === hour24) {
      return false
    }
  }
  return true
}

/**
 * Detecta si un string de fecha+hora local sin zona horaria explícita cae dentro de una hora local
 * inexistente durante el cambio DST Spring Forward en `America/Los_Angeles`.
 */
export function detectNonExistentDstTimestamp(isoOrDateStr: string | null | undefined): boolean {
  if (!isoOrDateStr) return false
  const trimmed = String(isoOrDateStr).trim()
  if (!trimmed || /(?:Z|GMT|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return false

  const localYmdTime = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?$/i
  )
  if (localYmdTime) {
    const year = Number(localYmdTime[1])
    const month = Number(localYmdTime[2])
    const day = Number(localYmdTime[3])
    let hour = Number(localYmdTime[4])
    const min = Number(localYmdTime[5])
    const sec = localYmdTime[6] ? Number(localYmdTime[6]) : 0
    const ampm = localYmdTime[7] ? localYmdTime[7].toUpperCase() : null
    if (ampm === 'PM' && hour < 12) hour += 12
    if (ampm === 'AM' && hour === 12) hour = 0
    if (hour === 24) hour = 0
    return isNonExistentLaLocalTime(year, month, day, hour, min, sec)
  }

  const localMdyTime = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  )
  if (localMdyTime) {
    const month = Number(localMdyTime[1])
    const day = Number(localMdyTime[2])
    const year = Number(localMdyTime[3])
    let hour = Number(localMdyTime[4])
    const min = Number(localMdyTime[5])
    const sec = localMdyTime[6] ? Number(localMdyTime[6]) : 0
    const ampm = localMdyTime[7] ? localMdyTime[7].toUpperCase() : null
    if (ampm === 'PM' && hour < 12) hour += 12
    if (ampm === 'AM' && hour === 12) hour = 0
    if (hour === 24) hour = 0
    return isNonExistentLaLocalTime(year, month, day, hour, min, sec)
  }

  return false
}

/**
 * Convierte componentes de fecha y hora local en `America/Los_Angeles` a un ISO string UTC exacto,
 * resolviendo automáticamente horario de verano (PDT -07:00) vs estándar (PST -08:00).
 * Prohibido normalizar silenciosamente horas inexistentes durante Spring Forward (lanza error explícito).
 */
export function localLaComponentsToIso(
  year: number,
  month: number,
  day: number,
  hour24: number,
  minute = 0,
  second = 0
): string {
  // Probar PDT (-07:00) primero y luego PST (-08:00)
  for (const offsetHours of [7, 8]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour24 + offsetHours, minute, second))
    const la = extractLaPartsFromInstant(candidate)
    if (la.year === year && la.month === month && la.day === day && la.hour === hour24) {
      return candidate.toISOString()
    }
  }
  throw new Error(
    `NONEXISTENT_DST_LOCAL_TIME: La hora local ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
      2,
      '0'
    )} ${String(hour24).padStart(2, '0')}:${String(minute).padStart(
      2,
      '0'
    )} no existe en America/Los_Angeles por el salto de horario de verano (Spring Forward).`
  )
}

/**
 * Parsea fecha y hora local separadas o combinadas en `America/Los_Angeles` sin asumir UTC.
 * Regla operativa: 00:00 a 05:59 AM PT -> día laboral anterior; 06:00 AM a 23:59 PM PT -> mismo día laboral.
 * Si la hora local es inexistente durante Spring Forward (ej. 02:30 AM), devuelve `nonExistentDstLocalTime: true`
 * y `unverifiedReason: 'NONEXISTENT_DST_LOCAL_TIME'` sin normalizar silenciosamente.
 */
export function parseLocalLaDateTime(
  dateStr: string | null | undefined,
  timeStr?: string | null | undefined,
  fallbackDate?: string
): {
  businessDate: string
  placedIso: string | null
  nonExistentDstLocalTime?: boolean
  unverifiedReason?: string | null
} {
  const cleanDate = String(dateStr || '').trim()
  const cleanTime = String(timeStr || '').trim()
  if (!cleanDate) {
    return {
      businessDate: fallbackDate || toOperationalBusinessDate(new Date().toISOString()),
      placedIso: null,
      nonExistentDstLocalTime: false,
      unverifiedReason: null,
    }
  }

  if (cleanTime) {
    // Parsear fecha base (YYYY-MM-DD o MM/DD/YYYY)
    let year = 0
    let month = 0
    let day = 0
    const ymd = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    const mdy = cleanDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (ymd) {
      year = Number(ymd[1])
      month = Number(ymd[2])
      day = Number(ymd[3])
    } else if (mdy) {
      month = Number(mdy[1])
      day = Number(mdy[2])
      year = Number(mdy[3])
    }

    const tm = cleanTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i)
    if (year > 0 && tm) {
      let hr = parseInt(tm[1], 10)
      const min = parseInt(tm[2], 10)
      const sec = tm[3] ? parseInt(tm[3], 10) : 0
      const ampm = tm[4] ? tm[4].toUpperCase() : null
      if (ampm === 'PM' && hr < 12) hr += 12
      if (ampm === 'AM' && hr === 12) hr = 0

      const baseDate = new Date(Date.UTC(year, month - 1, day))
      if (hr < 6) {
        baseDate.setUTCDate(baseDate.getUTCDate() - 1)
      }
      if (isNonExistentLaLocalTime(year, month, day, hr, min, sec)) {
        return {
          businessDate: baseDate.toISOString().slice(0, 10),
          placedIso: null,
          nonExistentDstLocalTime: true,
          unverifiedReason: 'NONEXISTENT_DST_LOCAL_TIME',
        }
      }
      return {
        businessDate: baseDate.toISOString().slice(0, 10),
        placedIso: localLaComponentsToIso(year, month, day, hr, min, sec),
        nonExistentDstLocalTime: false,
        unverifiedReason: null,
      }
    }
  }

  const combined = cleanTime ? `${cleanDate} ${cleanTime}` : cleanDate
  const isNonExistent = detectNonExistentDstTimestamp(combined)
  const businessDate = toOperationalBusinessDate(combined, fallbackDate)
  return {
    businessDate,
    placedIso: null,
    nonExistentDstLocalTime: isNonExistent,
    unverifiedReason: isNonExistent ? 'NONEXISTENT_DST_LOCAL_TIME' : null,
  }
}

/**
 * Convierte un timestamp ISO, fecha+hora local en `America/Los_Angeles`, o fecha pura
 * a la fecha operativa de Tacos Gavilan (6:00 AM a 5:59 AM America/Los_Angeles).
 */
export function toOperationalBusinessDate(isoOrDateStr: string | null | undefined, fallbackDate?: string): string {
  if (!isoOrDateStr) {
    if (fallbackDate) return fallbackDate
    return toOperationalBusinessDate(new Date().toISOString())
  }
  const trimmed = String(isoOrDateStr).trim()

  // 1. Si es YYYY-MM-DD puro sin hora, devolverlo tal cual (nunca restar 1 día por medianoche UTC)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  // 2. Si es MM/DD/YYYY puro sin hora, devolver YYYY-MM-DD tal cual (nunca restar 1 día)
  const pureMdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (pureMdy) {
    const mm = pureMdy[1].padStart(2, '0')
    const dd = pureMdy[2].padStart(2, '0')
    return `${pureMdy[3]}-${mm}-${dd}`
  }

  // 3. Si es fecha + hora local SIN zona horaria explícita (sin 'Z', 'GMT' ni offset ±HH:MM al final),
  // interpretarla directamente como hora local de America/Los_Angeles.
  const hasExplicitTz = /(?:Z|GMT|[+-]\d{2}:?\d{2})$/i.test(trimmed)
  if (!hasExplicitTz) {
    // Formato YYYY-MM-DD[T ]HH:mm(:ss)? (AM|PM)?
    const localYmdTime = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?$/i
    )
    if (localYmdTime) {
      const year = Number(localYmdTime[1])
      const month = Number(localYmdTime[2])
      const day = Number(localYmdTime[3])
      let hour = Number(localYmdTime[4])
      const ampm = localYmdTime[7] ? localYmdTime[7].toUpperCase() : null
      if (ampm === 'PM' && hour < 12) hour += 12
      if (ampm === 'AM' && hour === 12) hour = 0
      if (hour === 24) hour = 0
      const utcDate = new Date(Date.UTC(year, month - 1, day))
      if (hour < 6) {
        utcDate.setUTCDate(utcDate.getUTCDate() - 1)
      }
      return utcDate.toISOString().slice(0, 10)
    }

    // Formato MM/DD/YYYY(,)? HH:mm(:ss)? (AM|PM)?
    const localMdyTime = trimmed.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
    )
    if (localMdyTime) {
      const month = Number(localMdyTime[1])
      const day = Number(localMdyTime[2])
      const year = Number(localMdyTime[3])
      let hour = Number(localMdyTime[4])
      const ampm = localMdyTime[7] ? localMdyTime[7].toUpperCase() : null
      if (ampm === 'PM' && hour < 12) hour += 12
      if (ampm === 'AM' && hour === 12) hour = 0
      if (hour === 24) hour = 0
      const utcDate = new Date(Date.UTC(year, month - 1, day))
      if (hour < 6) {
        utcDate.setUTCDate(utcDate.getUTCDate() - 1)
      }
      return utcDate.toISOString().slice(0, 10)
    }
  }

  // 4. Timestamp con zona horaria explícita (ISO UTC o con offset) -> convertir a America/Los_Angeles
  const parsed = new Date(trimmed)
  if (isNaN(parsed.getTime())) {
    const mdyFallback = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (mdyFallback) {
      const mm = mdyFallback[1].padStart(2, '0')
      const dd = mdyFallback[2].padStart(2, '0')
      return `${mdyFallback[3]}-${mm}-${dd}`
    }
    return fallbackDate || toOperationalBusinessDate(new Date().toISOString())
  }

  const { year, month, day, hour } = extractLaPartsFromInstant(parsed)
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  // Si la orden entró entre las 12:00 AM y las 5:59 AM PT, pertenece al día operativo anterior
  if (hour < 6) {
    utcDate.setUTCDate(utcDate.getUTCDate() - 1)
  }
  return utcDate.toISOString().slice(0, 10)
}

/**
 * Genera el arreglo de fechas YYYY-MM-DD entre startDate y endDate (inclusive).
 */
export function listBusinessDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const curr = new Date(`${startDate}T12:00:00Z`)
  const end = new Date(`${endDate}T12:00:00Z`)
  if (isNaN(curr.getTime()) || isNaN(end.getTime())) return [startDate]
  let guard = 0
  while (curr <= end && guard < 120) {
    dates.push(curr.toISOString().slice(0, 10))
    curr.setUTCDate(curr.getUTCDate() + 1)
    guard++
  }
  return dates
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Calcula el Total Bruto Esperado de Toast según la regla fiscal de cada plataforma:
 * - DoorDash y Grubhub entregan el Sales Tax al restaurante -> Net Sales + Tax
 * - Uber Eats retiene y paga el Sales Tax directamente al estado -> Net Sales (sin Tax)
 */
export function calculateToastExpectedGross(
  platform: DeliveryPlatformCode,
  netSales: number,
  taxAmount: number
): number {
  if (platform === 'DOORDASH' || platform === 'GRUBHUB') {
    return round2(netSales + taxAmount)
  }
  // UBER_EATS
  return round2(netSales)
}

/**
 * Obtiene el catálogo de mapeo de las 15 sucursales desde Supabase.
 */
export async function getStorePlatformMappings(storeId?: number): Promise<StorePlatformMapping[]> {
  let query = supabaseAdmin.from('delivery_platform_store_mappings').select('*').order('store_name', { ascending: true })
  if (storeId && Number.isFinite(storeId)) {
    query = query.eq('store_id', storeId)
  }
  const { data, error } = await query
  if (error) {
    throw new Error(`Error fetching delivery_platform_store_mappings: ${error.message}`)
  }
  return (data || []) as StorePlatformMapping[]
}

/**
 * Extrae el identificador de orden de la plataforma desde el Tab Name o External ID de Toast POS.
 */
export function parseToastTabPlatformOrderId(
  platform: DeliveryPlatformCode,
  tabName: string,
  externalId?: string | null,
  rawOrder?: any
): string | null {
  const cleanTab = (tabName || '').trim()
  const cleanExt = (externalId || '').trim()

  if (platform === 'GRUBHUB') {
    const ghDigits = cleanTab.match(/#?(\d{8,20})/) || cleanExt.match(/(\d{8,20})/)
    if (ghDigits) return ghDigits[1]
  }

  if (platform === 'DOORDASH') {
    const ddHex = cleanTab.match(/\b(?:DD|DOORDASH|SF|STOREFRONT|CAV|CAVIAR)\s*#?([A-Za-z0-9]{5,16})\b/i)
    if (ddHex) return ddHex[1].toUpperCase()
    const ddDigits = cleanTab.match(/#(\d{6,20})/) || cleanExt.match(/(\d{6,20})/)
    if (ddDigits) return ddDigits[1]
  }

  if (platform === 'UBER_EATS') {
    const uberCode = cleanTab.match(/\bUBER(?:\s*EATS)?\s*#?([A-Za-z0-9]{4,10})\b/i)
    if (uberCode) return uberCode[1].toUpperCase()
    const leadingHash = cleanTab.match(/^#([A-Za-z0-9]{5})\b/i)
    if (leadingHash) return leadingHash[1].toUpperCase()
  }

  if (rawOrder) {
    const identity = extractPlatformOrderIdentity(rawOrder)
    if (identity.platformOrderKey) return identity.platformOrderKey
  }

  return cleanExt || null
}

/**
 * Consulta Toast POS `ordersBulk` para una sucursal y lista de fechas operativas,
 * aplicando estrictamente `getDiningOptionsMap` y la fórmula de Net Sales por selección.
 */
export async function fetchToastDeliveryOrdersForStoreAndDates(
  mapping: StorePlatformMapping,
  businessDates: string[]
): Promise<ToastDeliveryOrderRecord[]> {
  const token = (await getAuthToken()) || ''
  const diningMap = await getDiningOptionsMap(token, mapping.toast_restaurant_guid)
  const headers = {
    Authorization: `Bearer ${token}`,
    'Toast-Restaurant-External-ID': mapping.toast_restaurant_guid,
  }

  const fields = [
    'guid',
    'externalId',
    'displayNumber',
    'diningOption',
    'deliveryService',
    'source',
    'openedDate',
    'closedDate',
    'paidDate',
    'voidDate',
    'voided',
    'deleted',
    'checks.guid',
    'checks.tabName',
    'checks.voided',
    'checks.deleted',
    'checks.amount',
    'checks.taxAmount',
    'checks.totalAmount',
    'checks.appliedDiscounts',
    'checks.payments.amount',
    'checks.payments.tipAmount',
    'checks.payments.refundAmount',
    'checks.payments.voided',
    'checks.payments.paymentStatus',
    'checks.selections.displayName',
    'checks.selections.item.name',
    'checks.selections.quantity',
    'checks.selections.price',
    'checks.selections.preDiscountPrice',
    'checks.selections.tax',
    'checks.selections.taxInclusion',
    'checks.selections.voided',
    'checks.selections.deferred',
    'checks.selections.toastGiftCard',
    'checks.selections.refundDetails',
  ].join(',')

  const results: ToastDeliveryOrderRecord[] = []

  const fetchSingleDateOrders = async (bDate: string): Promise<ToastDeliveryOrderRecord[]> => {
    const dateResults: ToastDeliveryOrderRecord[] = []
    const formattedDate = bDate.replace(/-/g, '')
    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
      url.searchParams.set('businessDate', formattedDate)
      url.searchParams.set('pageSize', '100')
      url.searchParams.set('page', String(page))
      url.searchParams.set('fields', fields)

      let res: Response | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        res = await fetch(url.toString(), { headers })
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1500 * attempt))
          continue
        }
        break
      }

      if (!res || !res.ok) {
        break
      }

      const orders = await res.json().catch(() => [])
      if (!Array.isArray(orders) || orders.length === 0) {
        break
      }

      for (const order of orders) {
        if (order.deleted) continue

        const dOptionRaw = diningMap[order.diningOption?.guid] || order.diningOption?.name || ''
        const dService =
          typeof order.deliveryService === 'string'
            ? order.deliveryService
            : order.deliveryService?.name || order.deliveryService?.provider || ''
        const sourceRaw =
          typeof order.source === 'string' ? order.source : order.source?.name || ''
        const optName = `${dService} ${dOptionRaw} ${sourceRaw}`.toLowerCase()

        let platform: DeliveryPlatformCode | null = null
        if (optName.includes('uber') || optName.includes('postmates')) {
          platform = 'UBER_EATS'
        } else if (/\b(?:doordash|dd)\b/i.test(optName)) {
          platform = 'DOORDASH'
        } else if (optName.includes('grub')) {
          platform = 'GRUBHUB'
        }

        if (!platform) continue

        const fulfillmentType: 'DELIVERY' | 'PICKUP' =
          optName.includes('takeout') || optName.includes('take out') || optName.includes('pickup')
            ? 'PICKUP'
            : 'DELIVERY'

        let orderNetSales = 0
        let orderTaxAmount = 0
        let voidedSelectionsSum = 0
        let primaryTabName = ''
        const itemsSummary: Array<{ name: string; quantity: number; price: number }> = []
        const allChecks = Array.isArray(order.checks) ? order.checks : []
        const isOrderVoided =
          Boolean(order.voided) ||
          (allChecks.length > 0 && allChecks.every((c: any) => Boolean(c.voided || c.deleted)))

        for (const check of allChecks) {
          if (check.deleted) continue
          if (!primaryTabName && check.tabName) {
            primaryTabName = String(check.tabName).trim()
          }

          if (isOrderVoided || check.voided) {
            for (const sel of check.selections || []) {
              const isGiftCard = Boolean(
                sel.toastGiftCard || String(sel.displayName || '').toLowerCase().includes('gift card')
              )
              if (sel.deferred && !isGiftCard) continue
              let itemPrice = Number(sel.price ?? sel.preDiscountPrice ?? 0)
              if (sel.taxInclusion === 'INCLUDED') {
                itemPrice -= Number(sel.tax || 0)
              }
              if (!isGiftCard && itemPrice > 0) {
                voidedSelectionsSum += itemPrice
                itemsSummary.push({
                  name: sel.displayName || sel.item?.name || 'Item',
                  quantity: Number(sel.quantity || 1),
                  price: round2(itemPrice),
                })
              }
            }
            continue
          }

          let checkItemNetSum = 0
          let checkItemRefunds = 0

          for (const sel of check.selections || []) {
            if (sel.voided) continue
            const isGiftCard = Boolean(
              sel.toastGiftCard || String(sel.displayName || '').toLowerCase().includes('gift card')
            )
            if (sel.deferred && !isGiftCard) continue

            let itemPrice = Number(sel.price || 0)
            if (sel.taxInclusion === 'INCLUDED') {
              itemPrice -= Number(sel.tax || 0)
            }
            if (sel.refundDetails?.refundAmount) {
              checkItemRefunds += Number(sel.refundDetails.refundAmount)
            }

            if (!isGiftCard) {
              checkItemNetSum += itemPrice
              itemsSummary.push({
                name: sel.displayName || sel.item?.name || 'Item',
                quantity: Number(sel.quantity || 1),
                price: round2(itemPrice),
              })
            }
          }

          // Descontar descuentos aplicados a nivel de cuenta (`check.appliedDiscounts`) cuando reducen `check.amount`
          let checkLevelDiscount = 0
          if (
            check.amount !== undefined &&
            check.amount !== null &&
            Array.isArray(check.appliedDiscounts) &&
            check.appliedDiscounts.length > 0 &&
            checkItemNetSum - Number(check.amount) > 0.01
          ) {
            checkLevelDiscount = round2(checkItemNetSum - Number(check.amount))
          }

          let checkNet = checkItemNetSum - checkLevelDiscount - checkItemRefunds

          let paymentRefunds = 0
          for (const p of check.payments || []) {
            if (p.voided) continue
            paymentRefunds += Number(p.refundAmount || 0)
          }
          if (paymentRefunds > checkItemRefunds + 0.01) {
            checkNet -= paymentRefunds - checkItemRefunds
          }

          orderNetSales += checkNet
          orderTaxAmount += Number(check.taxAmount || 0)
        }

        orderNetSales = round2(orderNetSales)
        orderTaxAmount = round2(orderTaxAmount)
        voidedSelectionsSum = round2(voidedSelectionsSum)

        const extractedPlatformId = parseToastTabPlatformOrderId(
          platform,
          primaryTabName,
          order.externalId,
          order
        )

        if (isOrderVoided) {
          // Solo conservar órdenes anuladas (VOID) en Toast si tienen ID de plataforma para vincular y explicar casos como DELIVERY_FAILED pagados por Uber/DD/GH
          if (!extractedPlatformId) continue
          dateResults.push({
            storeId: mapping.store_id,
            platform,
            fulfillmentType,
            businessDate: bDate,
            toastOrderGuid: order.guid,
            toastDisplayNumber: String(order.displayNumber || ''),
            toastTabName: primaryTabName,
            extractedPlatformId,
            openedAt: order.openedDate || `${bDate}T18:00:00Z`,
            diningOptionName: dOptionRaw || platform,
            netSales: 0,
            taxAmount: 0,
            expectedGross: 0,
            itemsSummary,
            isVoidedInToast: true,
            voidedOriginalSubtotal: voidedSelectionsSum,
            voidDate: order.voidDate || null,
          })
          continue
        }

        if (orderNetSales <= 0 && orderTaxAmount <= 0 && itemsSummary.length === 0) continue

        const expectedGross = calculateToastExpectedGross(platform, orderNetSales, orderTaxAmount)

        dateResults.push({
          storeId: mapping.store_id,
          platform,
          fulfillmentType,
          businessDate: bDate,
          toastOrderGuid: order.guid,
          toastDisplayNumber: String(order.displayNumber || ''),
          toastTabName: primaryTabName,
          extractedPlatformId,
          openedAt: order.openedDate || `${bDate}T18:00:00Z`,
          diningOptionName: dOptionRaw || platform,
          netSales: orderNetSales,
          taxAmount: orderTaxAmount,
          expectedGross,
          itemsSummary,
          isVoidedInToast: false,
        })
      }

      if (orders.length < 100) {
        hasMore = false
      } else {
        page++
      }
    }
    return dateResults
  }

  // Consultar las fechas operativas en lotes paralelos de hasta 4 días simultáneos
  for (let i = 0; i < businessDates.length; i += 4) {
    const batchDates = businessDates.slice(i, i + 4)
    const batchChunks = await Promise.all(batchDates.map((d) => fetchSingleDateOrders(d)))
    for (const chunk of batchChunks) {
      results.push(...chunk)
    }
  }

  return results
}

/**
 * Autenticación directa con Grubhub for Restaurants API.
 * Las credenciales se leen exclusivamente desde variables de entorno (cero secretos hardcodeados).
 */
let cachedGrubhubToken: { token: string; expiresAt: number } | null = null

export async function getGrubhubMerchantToken(): Promise<string> {
  if (cachedGrubhubToken && Date.now() < cachedGrubhubToken.expiresAt) {
    return cachedGrubhubToken.token
  }

  const email = process.env.GRUBHUB_MERCHANT_EMAIL
  const password = process.env.GRUBHUB_MERCHANT_PASSWORD
  const clientId =
    process.env.GRUBHUB_CLIENT_ID || 'QhYEEP59t2QhjFCMvYhsvdN655YPsNCWzggzM8VoA3FNUhSQbSrixtNhLfCK8RVf'

  if (!email || !password) {
    throw new Error(
      'Grubhub credentials are not configured in environment variables (GRUBHUB_MERCHANT_EMAIL / GRUBHUB_MERCHANT_PASSWORD).'
    )
  }

  const res = await fetch(GRUBHUB_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://restaurant.grubhub.com',
      Referer: 'https://restaurant.grubhub.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      brand: 'GRUBHUB',
      client_id: clientId,
      email,
      password,
    }),
  })

  if (!res.ok) {
    throw new Error(`Grubhub Auth Error (${res.status})`)
  }

  const data = await res.json()
  const accessToken = data?.session_handle?.access_token
  if (!accessToken) {
    throw new Error('Grubhub Auth response did not contain session_handle.access_token')
  }

  cachedGrubhubToken = {
    token: accessToken,
    expiresAt: Date.now() + 20 * 60 * 1000, // 20 minutos
  }
  return accessToken
}

/**
 * Determina el periodo exacto (`period_start` y `period_end`) de un corte de Grubhub (`short_distribution_id`).
 *
 * Regla oficial de Grubhub:
 * 1. El ciclo semanal regular corre de Martes (`effectiveDate - 10 días`) a Lunes (`effectiveDate - 4 días`).
 * 2. Sin embargo, cuando una semana (Martes → Lunes) cruza el cierre de un mes calendario (ej. `Oct 31` o `Sep 30`),
 *    Grubhub divide la semana en DOS depósitos separados por sucursal:
 *    a) **Corte de Cierre de Mes (`^\d{6}01`, creado el último día del mes a las 9:59:59 PM PT / día 01 UTC a las 03:59:59Z o 04:59:59Z)**:
 *       - `periodEnd` = último día del mes que cierra (fecha calendario de `created_date` en `America/Los_Angeles`).
 *       - `periodStart` = el Martes igual o inmediatamente anterior a `periodEnd`.
 *       - Ejemplos:
 *         * `26110601...` (`created_date: 2026-11-01T04:59:59Z` = `2026-10-31 21:59:59 PT`) -> `2026-10-27` a `2026-10-31`.
 *         * `26100201...` (`created_date: 2026-10-01T04:59:59Z` = `2026-09-30 21:59:59 PT`) -> `2026-09-29` a `2026-09-30`.
 *         * `26090401...` (`created_date: 2026-09-01T04:59:59Z` = `2026-08-31 21:59:59 PT`) -> `2026-08-25` a `2026-08-31`.
 *    b) **Corte Regular de Nuevo Mes (creado el Miércoles siguiente, `Cc !== '01'`)**:
 *       - Si el Martes estándar (`effectiveDate - 10`) y el Lunes estándar (`effectiveDate - 4`) pertenecen a meses distintos,
 *         los días del mes anterior ya fueron liquidados en el corte `01`, por lo que este segundo corte cubre únicamente
 *         desde el día `01` del nuevo mes (`${stdEnd.slice(0, 7)}-01`) hasta el Lunes (`stdEnd`).
 *       - Ejemplos:
 *         * `26110604...` (`effectiveDate: 2026-11-06`, ciclo `10/27..11/02`) -> `2026-11-01` a `2026-11-02`.
 *         * `26100907...` (`effectiveDate: 2026-10-09`, ciclo `09/29..10/05`) -> `2026-10-01` a `2026-10-05`.
 */
export function resolveGrubhubDistributionPeriod(params: {
  shortDistributionId?: string | null
  effectiveDate?: string | null
  createdDateRaw?: string | null
  minTxDate?: string | null
  maxTxDate?: string | null
}): {
  periodStart: string
  periodEnd: string
  isMonthEndCutoff: boolean
  isNewMonthRemainder: boolean
  portalDepositDate: string | null
} {
  const shortId = String(params.shortDistributionId || '').trim()
  const effDate = params.effectiveDate ? String(params.effectiveDate).slice(0, 10) : null
  const createdRaw = params.createdDateRaw ? String(params.createdDateRaw).trim() : null

  let portalDepositDate: string | null = null
  if (createdRaw) {
    const parsedCreated = new Date(createdRaw)
    if (!Number.isNaN(parsedCreated.getTime())) {
      const la = extractLaPartsFromInstant(parsedCreated)
      portalDepositDate = `${la.year}-${String(la.month).padStart(2, '0')}-${String(la.day).padStart(2, '0')}`
    }
  }

  const isMonthEndById = /^\d{6}01/.test(shortId)
  const isMonthEndByCreated = Boolean(
    createdRaw && /^\d{4}-\d{2}-01T0[345]:59:59/.test(createdRaw)
  )
  const isMonthEndCutoff = isMonthEndById || isMonthEndByCreated

  if (isMonthEndCutoff) {
    let monthEndDay = portalDepositDate
    if (!monthEndDay && effDate) {
      const firstOfEffMonth = `${effDate.slice(0, 7)}-01`
      monthEndDay = addDaysToDateStr(firstOfEffMonth, -1)
    }
    if (monthEndDay) {
      const dow = new Date(`${monthEndDay}T12:00:00Z`).getUTCDay()
      const daysSinceTuesday = (dow - 2 + 7) % 7
      const tuesdayStart = addDaysToDateStr(monthEndDay, -daysSinceTuesday)
      return {
        periodStart: tuesdayStart,
        periodEnd: monthEndDay,
        isMonthEndCutoff: true,
        isNewMonthRemainder: false,
        portalDepositDate: portalDepositDate || monthEndDay,
      }
    }
  }

  if (effDate) {
    const stdStart = addDaysToDateStr(effDate, -10)
    const stdEnd = addDaysToDateStr(effDate, -4)
    if (stdStart.slice(0, 7) !== stdEnd.slice(0, 7)) {
      const firstOfNewMonth = `${stdEnd.slice(0, 7)}-01`
      return {
        periodStart: firstOfNewMonth,
        periodEnd: stdEnd,
        isMonthEndCutoff: false,
        isNewMonthRemainder: true,
        portalDepositDate: portalDepositDate || effDate,
      }
    }
    return {
      periodStart: stdStart,
      periodEnd: stdEnd,
      isMonthEndCutoff: false,
      isNewMonthRemainder: false,
      portalDepositDate: portalDepositDate || effDate,
    }
  }

  const fallbackStart = params.minTxDate || portalDepositDate || new Date().toISOString().slice(0, 10)
  const fallbackEnd = params.maxTxDate || fallbackStart
  return {
    periodStart: fallbackStart,
    periodEnd: fallbackEnd,
    isMonthEndCutoff: false,
    isNewMonthRemainder: false,
    portalDepositDate,
  }
}

/**
 * Extrae en vivo los depósitos (cortes) y las transacciones orden por orden desde Grubhub Accounting API
 * para una sucursal y rango de fechas.
 */
export async function fetchGrubhubLiveAccountingForStore(
  mapping: StorePlatformMapping,
  startDate: string,
  endDate: string
): Promise<{
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
}> {
  if (!mapping.grubhub_cust_id) {
    return { orders: [], payouts: [] }
  }

  const token = await getGrubhubMerchantToken()
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://restaurant.grubhub.com',
    Referer: 'https://restaurant.grubhub.com/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  }

  const custId = String(mapping.grubhub_cust_id).trim()
  // Extendemos endDate + 1 día para capturar órdenes entre 00:00 y 05:59 AM PT del día siguiente
  const queryEndDate = addDaysToDateStr(endDate, 1)
  // Para depósitos, consultamos únicamente depósitos liquidados desde startDate hasta endDate + 7 días (sin traer semanas pasadas)
  const rawDepStart = startDate
  const rawDepEnd = addDaysToDateStr(endDate, 7)
  const depWindows: Array<{ s: string; e: string }> = []
  let curWinStart = rawDepStart
  while (curWinStart <= rawDepEnd) {
    const candEnd = addDaysToDateStr(curWinStart, 25)
    const winEnd = candEnd < rawDepEnd ? candEnd : rawDepEnd
    depWindows.push({
      s: `${curWinStart}T00:00:00.000Z`,
      e: `${winEnd}T23:59:59.999Z`,
    })
    curWinStart = addDaysToDateStr(winEnd, 1)
  }

  const [txRes, ...depSumResponses] = await Promise.all([
    fetch(
      `${GRUBHUB_ACCOUNTING_HOST}/merchant/accounting/v1/${custId}/transactions?timeZone=America/Los_Angeles&channelGroup=MARKETPLACE&startDate=${startDate}&endDate=${queryEndDate}`,
      { headers: ghHeaders }
    ),
    ...depWindows.map((w) =>
      fetch(
        `${GRUBHUB_ACCOUNTING_HOST}/merchant/accounting/customers/${custId}/deposits/summary?startTime=${encodeURIComponent(
          w.s
        )}&endTime=${encodeURIComponent(w.e)}`,
        { headers: ghHeaders }
      )
    ),
  ])

  const txData = txRes.ok ? await txRes.json().catch(() => []) : []
  const rawTransactions: any[] = Array.isArray(txData)
    ? txData
    : Array.isArray(txData?.transactions)
    ? txData.transactions
    : []

  const rawDepositsMap = new Map<string, any>()
  for (const depRes of depSumResponses) {
    if (!depRes.ok) continue
    const depSumData = await depRes.json().catch(() => ({}))
    const list: any[] = Array.isArray(depSumData)
      ? depSumData
      : Array.isArray(depSumData?.[custId])
      ? depSumData[custId]
      : Array.isArray(depSumData?.deposits)
      ? depSumData.deposits
      : []
    for (const d of list) {
      const id = String(d.restaurant_distribution_id || d.short_distribution_id || '')
      if (id) rawDepositsMap.set(id, d)
    }
  }
  const rawDeposits = Array.from(rawDepositsMap.values())

  // Mapear qué transacción/orden fue pagada en qué depósito (corte) descargando los detalles en paralelo
  const orderToDepositMap = new Map<
    string,
    { payoutRef: string; payoutDate: string; bankLast4: string; periodStart?: string | null; periodEnd?: string | null }
  >()
  const payouts: Array<Record<string, any>> = []

  const depositsWithDetails = await Promise.all(
    rawDeposits.map(async (dep) => {
      const distId = String(dep.restaurant_distribution_id || '')
      if (!distId) return null
      let detailData: any = null
      try {
        const detRes = await fetch(
          `${GRUBHUB_ACCOUNTING_HOST}/merchant/accounting/customers/${custId}/deposits/${distId}`,
          { headers: ghHeaders }
        )
        if (detRes.ok) {
          detailData = await detRes.json()
        }
      } catch {
        // Fallback a resumen si falla detalle
      }
      return { dep, distId, detailData }
    })
  )

  for (const item of depositsWithDetails) {
    if (!item) continue
    const { dep, distId, detailData } = item

    const assocTxs: any[] = Array.isArray(detailData?.associated_transactions)
      ? detailData.associated_transactions
      : []

    const rawEffDate = dep.effective_date || detailData?.effective_date || dep.created_date || null
    const effectiveDate = rawEffDate ? String(rawEffDate).slice(0, 10) : null
    const bankLast4 =
      dep.bank_account_number_at_transfer_last_four ||
      detailData?.bank_account_number_at_transfer_last_four ||
      dep.bank_account_last_four ||
      null
    const payoutRefId = String(dep.short_distribution_id || distId)

    let minDate: string | null = null
    let maxDate: string | null = null

    let sumSubtotalCents = 0
    let sumTaxCents = 0
    let sumWithheldTaxCents = 0
    let sumGrossCents = 0
    let sumCommCents = 0
    let sumDelFeeCents = 0
    let sumProcFeeCents = 0
    let sumPromoCents = 0
    let sumTipCents = 0
    let sumErrorCents = 0
    let sumAdjCents = 0
    const crossPayoutRefunds: Array<{
      orderCode: string
      transactionId: string | null
      payoutRef: string
      periodStart: string
      periodEnd: string
      depositDate: string
      amount: number
      description: string
    }> = []

    for (const atx of assocTxs) {
      const ordNum = String(atx.order_number || '').trim()
      const txId = String(atx.transaction_id || '').trim()
      const atxBDate = atx.placed_at_time ? toOperationalBusinessDate(atx.placed_at_time) : null
      if (atxBDate && atxBDate >= startDate && atxBDate <= endDate) {
        if (txId && !rawTransactions.some((rt: any) => String(rt.transaction_id || '').trim() === txId)) {
          rawTransactions.push(atx)
        } else if (!txId && ordNum && !rawTransactions.some((rt: any) => String(rt.order_number || '').trim() === ordNum)) {
          rawTransactions.push(atx)
        }
      }

      const atxTypeUpper = String(atx.transaction_type || '').toUpperCase()
      const atxChanUpper = String(atx.order_channel || '').toUpperCase()
      const atxOrderTypeUpper = String(atx.order_type || '').toUpperCase()
      const isCreditAdjustment =
        atxChanUpper === 'MISCELLANEOUS' ||
        atxTypeUpper.includes('CREDIT') ||
        atxOrderTypeUpper.includes('ADJUSTMENT') ||
        (Number(atx.subtotal || 0) === 0 && Number(atx.net_amount || 0) > 0 && !atx.is_refund)

      if (ordNum && ((!isCreditAdjustment && !atx.is_refund) || !orderToDepositMap.has(ordNum))) {
        orderToDepositMap.set(ordNum, {
          payoutRef: payoutRefId,
          payoutDate: effectiveDate || '',
          bankLast4: bankLast4 || '',
        })
      }
      if (txId) {
        orderToDepositMap.set(txId, {
          payoutRef: payoutRefId,
          payoutDate: effectiveDate || '',
          bankLast4: bankLast4 || '',
        })
      }
      if (atx.placed_at_time) {
        const bDate = toOperationalBusinessDate(atx.placed_at_time)
        if (!minDate || bDate < minDate) minDate = bDate
        if (!maxDate || bDate > maxDate) maxDate = bDate
      }

      if (atx.is_refund || atxChanUpper === 'ADJUSTMENT') {
        sumErrorCents += Number(atx.net_amount || 0)
      } else if (isCreditAdjustment) {
        sumAdjCents += Number(atx.net_amount || 0)
      } else {
        const subC = Number(atx.subtotal || 0)
        const taxC = Number(atx.restaurant_sales_tax || 0) + Number(atx.delivery_sales_tax || 0)
        const whTaxC = Math.abs(Number(atx.withheld_sales_tax || 0))
        sumSubtotalCents += subC
        sumTaxCents += taxC
        sumWithheldTaxCents += whTaxC
        sumGrossCents += subC + taxC - whTaxC
        sumCommCents += Number(atx.advertising_fee || 0) + Number(atx.gh_plus_fee || 0)
        sumDelFeeCents += Number(atx.grubhub_delivery_fee || 0)
        sumProcFeeCents += Number(atx.processing_fee || 0)
        sumPromoCents += Number(atx.restaurant_funded_promo || 0) + Number(atx.restaurant_funded_reward || 0)
        sumTipCents += Number(atx.restaurant_tip || 0)
      }
    }

    const subtotalSales = round2(sumSubtotalCents / 100)
    const taxCollected = round2(sumTaxCents / 100)
    const taxWithheld = round2(sumWithheldTaxCents / 100)
    const taxPaidToMerchant = round2(taxCollected - taxWithheld)
    const platformGrossReceivable = round2(sumGrossCents / 100)
    const commissionFees = round2(sumCommCents / 100)
    const deliveryFees = round2(sumDelFeeCents / 100)
    const processingFees = round2(sumProcFeeCents / 100)
    const marketingFees = round2(sumPromoCents / 100)
    const tipsAmount = round2(sumTipCents / 100)
    const errorCharges = round2(sumErrorCents / 100)
    const adjustmentsAmount = round2(sumAdjCents / 100)
    const netPayoutAmount = round2(Number(detailData?.total ?? dep.total ?? dep.net_amount ?? 0) / 100)

    // Determinar el periodo oficial del corte de Grubhub respetando los cortes de cierre de mes (ej. 10/27..10/31 y 11/01..11/02)
    const rawCreatedDate = dep.created_date || detailData?.created_date || null
    const ghPeriod = resolveGrubhubDistributionPeriod({
      shortDistributionId: dep.short_distribution_id || distId,
      effectiveDate,
      createdDateRaw: rawCreatedDate,
      minTxDate: minDate,
      maxTxDate: maxDate,
    })

    for (const atx of assocTxs) {
      const ordNum = String(atx.order_number || '').trim()
      const atxTxId = String(atx.transaction_id || '').trim()
      if (atxTxId) {
        const depEntry = orderToDepositMap.get(atxTxId)
        if (depEntry && depEntry.payoutRef === payoutRefId) {
          depEntry.periodStart = ghPeriod.periodStart
          depEntry.periodEnd = ghPeriod.periodEnd
        }
      }
      const atxTypeUpper = String(atx.transaction_type || '').toUpperCase()
      const atxChanUpper = String(atx.order_channel || '').toUpperCase()
      const atxOrderTypeUpper = String(atx.order_type || '').toUpperCase()
      const isCreditAdjustment =
        atxChanUpper === 'MISCELLANEOUS' ||
        atxTypeUpper.includes('CREDIT') ||
        atxOrderTypeUpper.includes('ADJUSTMENT') ||
        (Number(atx.subtotal || 0) === 0 && Number(atx.net_amount || 0) > 0 && !atx.is_refund)
      if (isCreditAdjustment && ordNum && Number(atx.net_amount || 0) > 0) {
        crossPayoutRefunds.push({
          orderCode: ordNum,
          transactionId: atxTxId || null,
          payoutRef: payoutRefId,
          periodStart: ghPeriod.periodStart,
          periodEnd: ghPeriod.periodEnd,
          depositDate: effectiveDate || '',
          amount: round2(Number(atx.net_amount || 0) / 100),
          description: String(
            atx.transaction_type_description ||
              atx.transaction_type ||
              'Crédito / Recuperación de Disputa Grubhub'
          ),
        })
      }
    }

    if (
      ghPeriod.periodStart &&
      ghPeriod.periodEnd &&
      (ghPeriod.periodStart > endDate || ghPeriod.periodEnd < startDate)
    ) {
      continue
    }

    const baseRawPayload = detailData || dep || {}
    payouts.push({
      store_id: mapping.store_id,
      platform: 'GRUBHUB',
      payout_reference_id: dep.short_distribution_id || distId,
      period_start: ghPeriod.periodStart,
      period_end: ghPeriod.periodEnd,
      payout_date: effectiveDate,
      orders_count: assocTxs.length,
      subtotal_sales: subtotalSales,
      tax_collected: taxCollected,
      tax_remitted_by_platform: taxWithheld,
      tax_paid_to_merchant: taxPaidToMerchant,
      platform_gross_receivable: platformGrossReceivable,
      commission_fees: commissionFees,
      delivery_fees: deliveryFees,
      processing_fees: processingFees,
      marketing_fees: marketingFees,
      error_charges: errorCharges,
      adjustments_amount: adjustmentsAmount,
      tips_amount: tipsAmount,
      net_payout_amount: netPayoutAmount,
      bank_account_last4: bankLast4,
      status: 'POSTED',
      source_type: 'API',
      raw_payload: {
        ...baseRawPayload,
        portal_deposit_date: ghPeriod.portalDepositDate,
        is_month_end_cutoff: ghPeriod.isMonthEndCutoff,
        is_new_month_remainder: ghPeriod.isNewMonthRemainder,
        ...(crossPayoutRefunds.length > 0 ? { cross_payout_refunds: crossPayoutRefunds } : {}),
      },
    })
  }

  // Agrupar transacciones por order_number para consolidar la orden con posibles ajustes/reembolsos
  // Excluir filas de transferencia bancaria / distribución ACH (ej. transaction_type === 'DISTRIBUTION' o IDs BAI... sin order_number)
  const groupedByOrderNum = new Map<string, any[]>()
  for (const tx of rawTransactions) {
    const txTypeUpper = String(tx.transaction_type || tx.order_channel || '').toUpperCase()
    if (txTypeUpper.includes('DISTRIBUTION') || txTypeUpper.includes('TRANSFER') || txTypeUpper.includes('DEPOSIT')) {
      continue
    }
    const txIdStr = String(tx.transaction_id || '').trim()
    if (!tx.order_number && txIdStr.startsWith('BAI')) {
      continue
    }
    const ordKey = String(tx.order_number || tx.transaction_id || tx.billing_id || '').trim()
    if (!ordKey) continue
    const list = groupedByOrderNum.get(ordKey) || []
    list.push(tx)
    groupedByOrderNum.set(ordKey, list)
  }

  const orders: PlatformOrderInput[] = []

  for (const [ordKey, txList] of groupedByOrderNum.entries()) {
    const primaryTx =
      txList.find((t) => !t.is_refund && Number(t.subtotal || 0) > 0) ||
      txList.find((t) => !t.is_refund && t.order_channel !== 'ADJUSTMENT') ||
      txList[0]
    const refundTxs = txList.filter(
      (t) => t !== primaryTx && (t.is_refund || t.order_channel === 'ADJUSTMENT' || Number(t.net_amount || 0) < 0)
    )
    const recoveryTxs = txList.filter(
      (t) =>
        t !== primaryTx &&
        !t.is_refund &&
        Number(t.subtotal || 0) === 0 &&
        Number(t.net_amount || 0) > 0
    )

    const placedAt = primaryTx.placed_at_time || primaryTx.transaction_time || null
    const businessDate = toOperationalBusinessDate(placedAt, primaryTx.business_date || startDate)

    const depInfo =
      orderToDepositMap.get(String(primaryTx.transaction_id || '')) ||
      orderToDepositMap.get(String(primaryTx.order_number || ''))

    // Filtrar solo órdenes dentro del rango operativo solicitado [startDate, endDate],
    // EXCEPTO cuando la orden pertenece oficialmente a uno de los depósitos/cortes extraídos (`depInfo.payoutRef`),
    // para garantizar cobertura 100% de órdenes vinculadas por `payout_reference_id`.
    if (!depInfo?.payoutRef && (businessDate < startDate || businessDate > endDate)) {
      continue
    }

    const subtotal = round2(Number(primaryTx.subtotal || 0) / 100)
    const tax = round2(
      (Number(primaryTx.restaurant_sales_tax || 0) + Number(primaryTx.delivery_sales_tax || 0)) / 100
    )
    const taxWithheld = round2(Math.abs(Number(primaryTx.withheld_sales_tax || 0)) / 100)
    const taxPaidToMerchant = round2(tax - taxWithheld)
    const txTypeUpper = String(primaryTx.transaction_type || '').toUpperCase()
    const orderTypeUpper = String(primaryTx.order_type || '').toUpperCase()
    const isCreditOrAdjustment =
      txTypeUpper.includes('CREDIT') ||
      orderTypeUpper.includes('ADJUSTMENT') ||
      (subtotal === 0 && tax === 0 && Number(primaryTx.net_amount || 0) !== 0 && !primaryTx.is_refund)

    // Excluir propina (restaurant_tip) y créditos sin venta de platform_gross_receivable para comparar exactamente Subtotal + Tax contra Toast
    const grossReceivable = isCreditOrAdjustment ? 0 : round2(subtotal + taxPaidToMerchant)

    const commissionFee = round2(
      (Number(primaryTx.advertising_fee || 0) + Number(primaryTx.gh_plus_fee || 0)) / 100
    )
    const deliveryFee = round2(Number(primaryTx.grubhub_delivery_fee || 0) / 100)
    const processingFee = round2(Number(primaryTx.processing_fee || 0) / 100)
    const marketingFee = round2(
      (Number(primaryTx.restaurant_funded_promo || 0) + Number(primaryTx.restaurant_funded_reward || 0)) / 100
    )
    const tipAmount = round2(Number(primaryTx.restaurant_tip || primaryTx.tip || 0) / 100)
    let errorCharge = 0
    let adjustmentAmount = 0
    let netPayout = round2(Number(primaryTx.net_amount || 0) / 100)

    if (primaryTx.is_refund || primaryTx.order_channel === 'ADJUSTMENT') {
      errorCharge = round2(Number(primaryTx.net_amount || 0) / 100)
    } else if (isCreditOrAdjustment) {
      adjustmentAmount = netPayout
    }

    for (const rtx of refundTxs) {
      const rNet = round2(Number(rtx.net_amount || 0) / 100)
      errorCharge = round2(errorCharge + rNet)
      netPayout = round2(netPayout + rNet)
    }

    const fulfillmentType: 'DELIVERY' | 'PICKUP' =
      primaryTx.delivery === false ||
      String(primaryTx.delivery_type || '').toUpperCase().includes('PICKUP')
        ? 'PICKUP'
        : 'DELIVERY'

    const hasRefund = primaryTx.is_refund || refundTxs.length > 0 || errorCharge < -0.01
    // Defecto 4: cada crédito de recuperación conserva su propio transaction ID, payout, importe y fecha
    const recoveryCredits = buildGrubhubRecoveryCredits(
      recoveryTxs,
      orderToDepositMap,
      String(primaryTx.order_number || ordKey)
    )
    const latestRecovery = [...recoveryCredits].sort((a, b) =>
      String(b.deposit_date || '').localeCompare(String(a.deposit_date || ''))
    )[0]

    orders.push({
      storeId: mapping.store_id,
      platform: 'GRUBHUB',
      businessDate,
      placedAt,
      platformOrderId: String(primaryTx.order_number || ordKey),
      platformTransactionId: String(primaryTx.transaction_id || ordKey),
      payoutReferenceId: depInfo?.payoutRef || null,
      payoutDate: depInfo?.payoutDate || null,
      fulfillmentType,
      transactionType: hasRefund ? 'REFUND' : isCreditOrAdjustment ? 'ADJUSTMENT' : 'ORDER',
      platformSubtotal: subtotal,
      platformTax: tax,
      platformTaxWithheld: taxWithheld,
      platformTaxPaidToMerchant: taxPaidToMerchant,
      platformGrossReceivable: grossReceivable,
      commissionFee,
      deliveryFee,
      processingFee,
      marketingFee,
      errorCharge,
      adjustmentAmount,
      tipAmount,
      netPayout,
      disputeReason: hasRefund
        ? primaryTx.transaction_type_description ||
          refundTxs[0]?.transaction_type_description ||
          'Ajuste / Reembolso Grubhub'
        : isCreditOrAdjustment
        ? primaryTx.transaction_type_description || 'Crédito / Recuperación de Disputa Grubhub'
        : null,
      rawPayload: {
        primary: primaryTx,
        refunds: refundTxs,
        recoveries: recoveryTxs,
        ...(!depInfo?.payoutRef ? { pending_next_payout: true } : {}),
        ...(recoveryCredits.length > 0
          ? {
              recovery_credits: recoveryCredits,
              // Campos históricos de compatibilidad: describen el crédito más reciente (NO el total de todos los créditos)
              reimbursement_payout_ref: latestRecovery.payout_reference_id,
              reimbursement_deposit_date: latestRecovery.deposit_date,
              reimbursement_amount: latestRecovery.amount,
              reimbursement_transaction_id: latestRecovery.transaction_id,
              reimbursement_description: latestRecovery.description,
            }
          : {}),
      },
    })
  }

  return {
    orders: orders.filter((o) => o.businessDate >= startDate && o.businessDate <= endDate),
    payouts,
  }
}

/**
 * Parser CSV universal con soporte para comillas escapadas.
 */
export function parseCsvRows(csvText: string): Array<Record<string, string>> {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i]
    const next = csvText[i + 1]
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++
      if (current.trim().length > 0) lines.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim().length > 0) lines.push(current)
  if (lines.length < 2) return []

  const splitLine = (line: string): string[] => {
    const cols: string[] = []
    let cell = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      const n = line[i + 1]
      if (c === '"') {
        if (q && n === '"') {
          cell += '"'
          i++
        } else {
          q = !q
        }
      } else if (c === ',' && !q) {
        cols.push(cell.trim())
        cell = ''
      } else {
        cell += c
      }
    }
    cols.push(cell.trim())
    return cols
  }

  // Encontrar la primera fila que parezca encabezado real (para saltar banners iniciales de Uber/DoorDash)
  let headerIdx = 0
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const lower = lines[i].toLowerCase()
    if (
      lower.includes('subtotal') ||
      lower.includes('order id') ||
      lower.includes('doordash') ||
      lower.includes('payout') ||
      lower.includes('sales') ||
      lower.includes('order_number')
    ) {
      headerIdx = i
      break
    }
  }

  const rawHeaders = splitLine(lines[headerIdx]).map((h) => h.replace(/^\uFEFF/, '').trim())
  const rows: Array<Record<string, string>> = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const vals = splitLine(lines[i])
    if (vals.every((v) => !v)) continue
    const obj: Record<string, string> = {}
    for (let c = 0; c < rawHeaders.length; c++) {
      if (rawHeaders[c]) {
        obj[rawHeaders[c]] = vals[c] ?? ''
      }
    }
    rows.push(obj)
  }

  return rows
}

function parseCurrencyVal(val: any): number {
  if (typeof val === 'number') return round2(val)
  if (!val) return 0
  const str = String(val).trim()
  if (!str) return 0
  const isParenNeg = /^\(.*\)$/.test(str)
  const cleaned = str.replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleaned)
  if (!Number.isFinite(num)) return 0
  return round2(isParenNeg ? -Math.abs(num) : num)
}

function findColumnValue(row: Record<string, any>, candidates: string[]): string {
  const keys = Object.keys(row)
  for (const cand of candidates) {
    const exact = keys.find((k) => k.toLowerCase().trim() === cand.toLowerCase().trim())
    if (exact && row[exact] !== undefined && row[exact] !== '') return String(row[exact])
  }
  for (const cand of candidates) {
    const partial = keys.find((k) => k.toLowerCase().includes(cand.toLowerCase()))
    if (partial && row[partial] !== undefined && row[partial] !== '') return String(row[partial])
  }
  return ''
}

export interface ManualStoreOverrideOptions {
  confirmStoreAssignment?: boolean
  confirmedByUserId?: number | string | null
  confirmedByEmail?: string | null
  confirmedAt?: string | null
}

/**
 * Parsea respuestas JSON nativas de los endpoints internos de DoorDash Merchant Portal:
 * - `/merchant-analytics-service/api/v2/payout_summaries` (`summariesList`)
 * - `/merchant-analytics-service/api/v1/payout_transactions` (`columns` + `transactions` array de celdas `{name, value}`)
 * - `/merchant-analytics-service/api/v1/get_orders` (`orders`)
 */
export function parseDoorDashNativeApiObject(
  payload: Record<string, any>,
  mappings: StorePlatformMapping[],
  byDoorDashStoreId: Map<string, StorePlatformMapping>,
  defaultStoreId?: number,
  overrideOptions?: ManualStoreOverrideOptions
): {
  detectedPlatform: DeliveryPlatformCode
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
} {
  const orders: PlatformOrderInput[] = []
  const payoutsMap = new Map<string, Record<string, any>>()
  const manualOverrideAllowed = Boolean(
    defaultStoreId &&
      overrideOptions?.confirmStoreAssignment === true &&
      mappings.some((m) => m.store_id === defaultStoreId)
  )
  const buildOverrideAudit = () => ({
    confirmed: true,
    assigned_store_id: defaultStoreId,
    confirmed_by_user_id: overrideOptions?.confirmedByUserId ?? null,
    confirmed_by_email: overrideOptions?.confirmedByEmail ?? null,
    confirmed_at: overrideOptions?.confirmedAt || new Date().toISOString(),
  })

  const resolveDdStore = (
    ddStoreId?: string | number | null,
    storeName?: string | null
  ): { storeId: number; usedManualOverride: boolean } => {
    if (ddStoreId !== undefined && ddStoreId !== null && String(ddStoreId).trim() !== '') {
      const m = byDoorDashStoreId.get(String(ddStoreId).trim())
      if (m) return { storeId: m.store_id, usedManualOverride: false }
    }
    if (storeName) {
      const lower = storeName.toLowerCase()
      for (const m of mappings) {
        if (lower.includes(m.store_name.toLowerCase()) || lower.includes(m.store_code.toLowerCase())) {
          return { storeId: m.store_id, usedManualOverride: false }
        }
      }
      if (lower.includes('imperial') || lower.includes('lynwood')) return { storeId: 14, usedManualOverride: false }
      if (lower.includes('firestone') || lower.includes('south gate')) return { storeId: 15, usedManualOverride: false }
      if (lower.includes('bell') || lower.includes('4406')) return { storeId: 13, usedManualOverride: false }
      if (lower.includes('huntington') || lower.includes('2425')) return { storeId: 11, usedManualOverride: false }
      if (lower.includes('downey') || lower.includes('7947')) return { storeId: 16, usedManualOverride: false }
      if (lower.includes('norwalk') || lower.includes('rosecrans')) return { storeId: 12, usedManualOverride: false }
      if (lower.includes('la puente') || lower.includes('valley')) return { storeId: 10, usedManualOverride: false }
      if (lower.includes('santa ana') || lower.includes('17th')) return { storeId: 9, usedManualOverride: false }
      if (lower.includes('hollywood') || lower.includes('sunset')) return { storeId: 8, usedManualOverride: false }
      if (lower.includes('slauson') || lower.includes('5833')) return { storeId: 7, usedManualOverride: false }
      if (lower.includes('central') || lower.includes('1900')) return { storeId: 6, usedManualOverride: false }
      if (lower.includes('broadway') || lower.includes('4380')) return { storeId: 5, usedManualOverride: false }
      if (lower.includes('azusa') && (lower.includes('887') || lower.includes('arrow')))
        return { storeId: 4, usedManualOverride: false }
      if (lower.includes('west covina') || lower.includes('101')) return { storeId: 3, usedManualOverride: false }
      if (lower.includes('rialto') || lower.includes('baseline')) return { storeId: 1, usedManualOverride: false }
    }
    if (manualOverrideAllowed && defaultStoreId) {
      return { storeId: defaultStoreId, usedManualOverride: true }
    }
    // Prohibido asignar automáticamente a Lynwood #14 o usar defaultStoreId sin confirmación explícita
    return { storeId: 0, usedManualOverride: false }
  }

  // 1. Procesar `summariesList` (payout_summaries) — SIN estimar impuestos con 1.1025 ni asumir ciclo de Grubhub
  if (Array.isArray(payload.summariesList)) {
    for (const s of payload.summariesList) {
      const payoutRef = String(s.payoutId || '').trim()
      if (!payoutRef) continue
      const { storeId, usedManualOverride } = resolveDdStore(s.storeId, s.storeName)
      const payoutDate = toOperationalBusinessDate(s.payoutDate)
      const grossSales = parseCurrencyVal(s.sales)
      const amendments = parseCurrencyVal(s.amendments)
      const commAndFees = parseCurrencyVal(s.commissionAndFees)
      const mktSpend = parseCurrencyVal(s.marketingSpend)
      const netPayout = parseCurrencyVal(s.netPayout)

      const hasAtomicSubtotal = s.subtotal !== undefined && s.subtotal !== null && String(s.subtotal).trim() !== ''
      const hasAtomicTax =
        (s.tax !== undefined && s.tax !== null && String(s.tax).trim() !== '') ||
        (s.subtotalTaxPassedToMerchant !== undefined && s.subtotalTaxPassedToMerchant !== null)
      const taxBreakdownVerified = hasAtomicSubtotal && hasAtomicTax

      const atomicSubtotal = hasAtomicSubtotal ? parseCurrencyVal(s.subtotal) : 0
      const atomicTax = hasAtomicTax ? parseCurrencyVal(s.tax ?? s.subtotalTaxPassedToMerchant) : 0

      const explicitStart = s.periodStartDate || s.payoutStartDate || s.startDate || null
      const explicitEnd = s.periodEndDate || s.payoutEndDate || s.endDate || null
      const periodVerified = Boolean(explicitStart && explicitEnd)
      const fallbackDdCycle = resolveDoorDashCycleFromPayoutDate(payoutDate)

      payoutsMap.set(`${storeId}:${payoutRef}`, {
        store_id: storeId,
        platform: 'DOORDASH',
        payout_reference_id: payoutRef,
        period_start: explicitStart ? toOperationalBusinessDate(explicitStart) : fallbackDdCycle.periodStart,
        period_end: explicitEnd ? toOperationalBusinessDate(explicitEnd) : fallbackDdCycle.periodEnd,
        payout_date: payoutDate,
        orders_count: Number(s.ordersCount || 0),
        subtotal_sales: atomicSubtotal,
        tax_collected: atomicTax,
        tax_remitted_by_platform: 0,
        tax_paid_to_merchant: atomicTax,
        platform_gross_receivable: grossSales,
        commission_fees: commAndFees > 0 ? -commAndFees : commAndFees,
        delivery_fees: 0,
        processing_fees: 0,
        marketing_fees: mktSpend > 0 ? -mktSpend : mktSpend,
        error_charges: amendments < 0 ? amendments : 0,
        adjustments_amount: amendments > 0 ? amendments : 0,
        tips_amount: 0,
        net_payout_amount: netPayout,
        status:
          storeId === 0 || !taxBreakdownVerified
            ? 'REQUIRES_REVIEW'
            : s.payoutStatus === 2 || s.payoutStatus === 1
            ? 'POSTED'
            : 'PENDING',
        source_type: 'API',
        raw_payload: {
          ...s,
          tax_breakdown_verified: taxBreakdownVerified,
          period_verified: periodVerified,
          unassigned_store: storeId === 0,
          unverified_reason: !taxBreakdownVerified
            ? 'MISSING_DOORDASH_PAYOUT_TRANSACTIONS_BREAKDOWN'
            : storeId === 0
            ? 'UNASSIGNED_STORE'
            : null,
          ...(usedManualOverride ? { manual_store_override_audit: buildOverrideAudit() } : {}),
        },
      })
    }
  }

  // Acumulador de transacciones reales por payout para enriquecer el corte con cifras atómicas reales
  const txPayoutAgg = new Map<
    string,
    {
      storeId: number
      payoutId: string
      minDate: string
      maxDate: string
      ordersCount: number
      allTaxVerified: boolean
      subtotal: number
      tax: number
      gross: number
      commission: number
      processing: number
      marketing: number
      errorCharge: number
      adjustment: number
      tips: number
      netTotal: number
      crossPayoutRefunds: Array<{
        orderCode: string
        transactionId: string | null
        payoutRef: string
        depositDate: string
        amount: number
        description: string
      }>
    }
  >()

  // 2. Procesar `transactions` (payout_transactions)
  if (Array.isArray(payload.transactions)) {
    for (const txCells of payload.transactions) {
      if (!Array.isArray(txCells)) continue
      const cellById = new Map<number, any>()
      for (const c of txCells) {
        if (c && typeof c.name === 'number') {
          cellById.set(c.name, c)
        }
      }
      const getVal = (id: number): string => String(cellById.get(id)?.value || '').trim()
      const txId = getVal(1)
      const dateStr = getVal(2)
      const timeStr = getVal(3)
      const orderCell = cellById.get(4)
      const orderShortCode = String(orderCell?.value || '').trim()
      const actionData = orderCell?.action?.payload?.data || {}
      const deliveryUuid = String(actionData.deliveryUuid || '').trim()
      const ddStoreId = actionData.storeId || payload.storeId
      const cellPayoutId = getVal(23)
      const payoutId = String(actionData.payoutId || cellPayoutId || payload.payoutId || '').trim() || null
      const isDateRangeTx = Boolean((txCells as any)._fromDateRangeTransactions)
      const isPendingNextPayout = !payoutId && (isDateRangeTx || cellById.has(23))
      const channelStr = getVal(5)
      const storeName = getVal(6)
      const txTypeStr = getVal(7).toUpperCase()
      const description = getVal(8)

      const hasSubtotalCell = cellById.has(10) && getVal(10) !== ''
      const hasTaxCell = cellById.has(11) && getVal(11) !== ''
      const subtotal = parseCurrencyVal(getVal(10))
      const tax = parseCurrencyVal(getVal(11))
      const tips = parseCurrencyVal(getVal(14))
      const commission = parseCurrencyVal(getVal(15))
      const merchantFees = parseCurrencyVal(getVal(17)) + parseCurrencyVal(getVal(18))
      const errorCharge = parseCurrencyVal(getVal(19))
      const adjustmentAmount = parseCurrencyVal(getVal(20))
      const marketingFee =
        parseCurrencyVal(getVal(30)) + parseCurrencyVal(getVal(29)) + parseCurrencyVal(getVal(27))
      const netTotal = parseCurrencyVal(getVal(22))

      const { storeId, usedManualOverride } = resolveDdStore(ddStoreId, storeName)
      // Parseo único en America/Los_Angeles (05:59 AM -> día anterior; 06:00 AM -> mismo día, sin doble resta)
      const { businessDate, placedIso, nonExistentDstLocalTime } = parseLocalLaDateTime(dateStr, timeStr)
      if (
        isDateRangeTx &&
        !payoutId &&
        payload.startDate &&
        payload.endDate &&
        (businessDate < String(payload.startDate) || businessDate > String(payload.endDate))
      ) {
        continue
      }

      // DoorDash entrega el Sales Tax al restaurante (MERCHANT_TAX_REMIT)
      const taxWithheld = 0
      const taxPaidToMerchant = tax
      const grossReceivable = round2(subtotal + taxPaidToMerchant)

      let transactionType: PlatformOrderInput['transactionType'] = 'ORDER'
      if (txTypeStr.includes('ERROR') || errorCharge < -0.01) {
        transactionType = 'ERROR_CHARGE'
      } else if (txTypeStr.includes('REFUND')) {
        transactionType = 'REFUND'
      } else if (txTypeStr.includes('ADJUST') || txTypeStr.includes('FEE')) {
        transactionType = 'ADJUSTMENT'
      }

      const fulfillmentType: 'DELIVERY' | 'PICKUP' =
        channelStr.toUpperCase().includes('PICKUP') ? 'PICKUP' : 'DELIVERY'

      const taxVerified = hasSubtotalCell && hasTaxCell && !nonExistentDstLocalTime

      const resolvedOrderId = orderShortCode || (deliveryUuid ? deliveryUuid.slice(0, 8) : '') || txId
      const resolvedTxId = txId || deliveryUuid || `${orderShortCode}-${dateStr}`
      const candidateOrder: PlatformOrderInput = {
        storeId,
        platform: 'DOORDASH',
        businessDate,
        placedAt: placedIso,
        platformOrderId: resolvedOrderId,
        platformTransactionId: resolvedTxId,
        payoutReferenceId: payoutId,
        payoutDate: null,
        fulfillmentType,
        transactionType,
        platformSubtotal: subtotal,
        platformTax: tax,
        platformTaxWithheld: taxWithheld,
        platformTaxPaidToMerchant: taxPaidToMerchant,
        platformGrossReceivable: grossReceivable,
        commissionFee: commission > 0 ? -commission : commission,
        deliveryFee: 0,
        processingFee: merchantFees > 0 ? -merchantFees : merchantFees,
        marketingFee: marketingFee > 0 ? -marketingFee : marketingFee,
        errorCharge: errorCharge > 0 ? -errorCharge : errorCharge,
        adjustmentAmount,
        tipAmount: tips,
        netPayout: netTotal,
        taxBreakdownVerified: taxVerified,
        unverifiedReason: nonExistentDstLocalTime
          ? 'NONEXISTENT_DST_LOCAL_TIME'
          : !hasSubtotalCell || !hasTaxCell
          ? 'MISSING_ATOMIC_TAX_CELL_IN_DOORDASH_TX'
          : storeId === 0
          ? 'UNASSIGNED_STORE'
          : null,
        unassignedStoreRaw: storeId === 0 ? `${ddStoreId || ''} ${storeName || ''}`.trim() : null,
        disputeReason:
          errorCharge < -0.01 || transactionType === 'ERROR_CHARGE'
            ? description || 'DoorDash Error Charge / Ajuste a Cliente'
            : null,
        rawPayload: {
          cells: txCells,
          deliveryUuid,
          payoutId,
          ...(isPendingNextPayout ? { pending_next_payout: true } : {}),
          tax_breakdown_verified: taxVerified,
          non_existent_dst_local_time: Boolean(nonExistentDstLocalTime),
          unassigned_store: storeId === 0,
          ...(usedManualOverride ? { manual_store_override_audit: buildOverrideAudit() } : {}),
        },
      }

      // Consolidar líneas del mismo pedido DoorDash (ej. Order + Error charge / Refund del mismo `orderShortCode`)
      const existingSameOrder = orderShortCode
        ? orders.find(
            (ex) =>
              ex.storeId === storeId &&
              ex.payoutReferenceId === payoutId &&
              ex.platformOrderId.toUpperCase() === orderShortCode.toUpperCase()
          )
        : undefined

      if (existingSameOrder) {
        if (subtotal > 0 && existingSameOrder.platformSubtotal === 0) {
          existingSameOrder.platformTransactionId = resolvedTxId
          existingSameOrder.businessDate = businessDate
          existingSameOrder.placedAt = placedIso
          existingSameOrder.fulfillmentType = fulfillmentType
        }
        existingSameOrder.platformSubtotal = round2(existingSameOrder.platformSubtotal + candidateOrder.platformSubtotal)
        existingSameOrder.platformTax = round2(existingSameOrder.platformTax + candidateOrder.platformTax)
        existingSameOrder.platformTaxPaidToMerchant = round2(
          existingSameOrder.platformTaxPaidToMerchant + candidateOrder.platformTaxPaidToMerchant
        )
        existingSameOrder.platformGrossReceivable = round2(
          existingSameOrder.platformGrossReceivable + candidateOrder.platformGrossReceivable
        )
        existingSameOrder.commissionFee = round2(existingSameOrder.commissionFee + candidateOrder.commissionFee)
        existingSameOrder.processingFee = round2(existingSameOrder.processingFee + candidateOrder.processingFee)
        existingSameOrder.marketingFee = round2(existingSameOrder.marketingFee + candidateOrder.marketingFee)
        existingSameOrder.errorCharge = round2(existingSameOrder.errorCharge + candidateOrder.errorCharge)
        existingSameOrder.adjustmentAmount = round2(
          existingSameOrder.adjustmentAmount + candidateOrder.adjustmentAmount
        )
        existingSameOrder.tipAmount = round2(existingSameOrder.tipAmount + candidateOrder.tipAmount)
        existingSameOrder.netPayout = round2(existingSameOrder.netPayout + candidateOrder.netPayout)
        if (!taxVerified) {
          existingSameOrder.taxBreakdownVerified = false
          existingSameOrder.unverifiedReason = candidateOrder.unverifiedReason
          if (existingSameOrder.rawPayload) {
            existingSameOrder.rawPayload.tax_breakdown_verified = false
          }
        }
        if (candidateOrder.transactionType === 'ERROR_CHARGE' || existingSameOrder.errorCharge < -0.01) {
          existingSameOrder.transactionType = 'ERROR_CHARGE'
        } else if (candidateOrder.transactionType === 'REFUND') {
          existingSameOrder.transactionType = 'REFUND'
        }
        if (candidateOrder.disputeReason && !existingSameOrder.disputeReason) {
          existingSameOrder.disputeReason = candidateOrder.disputeReason
        }
      } else {
        orders.push(candidateOrder)
      }

      if (payoutId && !isDateRangeTx) {
        const aggKey = `${storeId}:${payoutId}`
        const cur = txPayoutAgg.get(aggKey) || {
          storeId,
          payoutId,
          minDate: businessDate,
          maxDate: businessDate,
          ordersCount: 0,
          allTaxVerified: true,
          subtotal: 0,
          tax: 0,
          gross: 0,
          commission: 0,
          processing: 0,
          marketing: 0,
          errorCharge: 0,
          adjustment: 0,
          tips: 0,
          netTotal: 0,
          crossPayoutRefunds: [],
        }
        if (businessDate < cur.minDate) cur.minDate = businessDate
        if (businessDate > cur.maxDate) cur.maxDate = businessDate
        cur.ordersCount += 1
        cur.allTaxVerified = cur.allTaxVerified && taxVerified
        cur.subtotal = round2(cur.subtotal + subtotal)
        cur.tax = round2(cur.tax + tax)
        cur.gross = round2(cur.gross + grossReceivable)
        cur.commission = round2(cur.commission + (commission > 0 ? -commission : commission))
        cur.processing = round2(cur.processing + (merchantFees > 0 ? -merchantFees : merchantFees))
        cur.marketing = round2(cur.marketing + (marketingFee > 0 ? -marketingFee : marketingFee))
        cur.errorCharge = round2(cur.errorCharge + (errorCharge > 0 ? -errorCharge : errorCharge))
        cur.adjustment = round2(cur.adjustment + adjustmentAmount)
        cur.tips = round2(cur.tips + tips)
        cur.netTotal = round2(cur.netTotal + netTotal)
        // Capturar créditos/ajustes positivos identificables por orden en el settlement DoorDash
        const creditAmt = round2(adjustmentAmount > 0 ? adjustmentAmount : subtotal === 0 && netTotal > 0 ? netTotal : 0)
        if (
          orderShortCode &&
          Math.abs(subtotal) < 0.005 &&
          errorCharge >= -0.005 &&
          creditAmt > 0
        ) {
          cur.crossPayoutRefunds.push({
            orderCode: orderShortCode,
            transactionId: resolvedTxId || null,
            payoutRef: payoutId,
            depositDate: businessDate,
            amount: creditAmt,
            description: description || txTypeStr || 'DoorDash Credit / Dispute Recovery',
          })
        }
        txPayoutAgg.set(aggKey, cur)
      }
    }
  }

  // Enriquecer o crear los payouts en `payoutsMap` con las transacciones atómicas reales
  for (const [aggKey, agg] of txPayoutAgg.entries()) {
    const existing = payoutsMap.get(aggKey)
    const payoutTaxVerified = agg.allTaxVerified && agg.ordersCount > 0
    if (existing) {
      if (existing.period_start === existing.period_end) {
        existing.period_start = agg.minDate
        existing.period_end = agg.maxDate
      }
      existing.orders_count = agg.ordersCount
      existing.subtotal_sales = agg.subtotal
      existing.tax_collected = agg.tax
      existing.tax_paid_to_merchant = agg.tax
      existing.platform_gross_receivable = agg.gross
      existing.tips_amount = agg.tips
      existing.status = agg.storeId === 0 || !payoutTaxVerified ? 'REQUIRES_REVIEW' : 'POSTED'
      existing.raw_payload = {
        ...(existing.raw_payload || {}),
        tax_breakdown_verified: payoutTaxVerified,
        period_verified: true,
        unassigned_store: agg.storeId === 0,
        unverified_reason: !payoutTaxVerified
          ? 'PAYOUT_CONTAINS_ORDER_WITHOUT_ATOMIC_TAX'
          : agg.storeId === 0
          ? 'UNASSIGNED_STORE'
          : null,
        ...(agg.crossPayoutRefunds.length > 0 ? { cross_payout_refunds: agg.crossPayoutRefunds } : {}),
      }
    }
  }

  // 3. Procesar `orders` (`get_orders`) — CERO estimaciones de tax (0.1025) ni comisiones (0.20)
  if (Array.isArray(payload.orders)) {
    for (const o of payload.orders) {
      const shortCode = String(o.deliveryShortCode || o.orderId || '').trim()
      const deliveryUuid = String(o.deliveryUuid || shortCode).trim()
      if (!shortCode && !deliveryUuid) continue
      const { storeId, usedManualOverride } = resolveDdStore(
        o.store?.id ?? o.storeId,
        o.store?.name ?? o.storeName
      )
      const placedAt = o.createdAt || o.storeOrderConfirmedTime || o.pickupTime || null
      const nonExistentDst = detectNonExistentDstTimestamp(placedAt)
      const businessDate = toOperationalBusinessDate(placedAt)
      const subtotal = parseCurrencyVal(
        o.subtotal ?? o.orderValue?.displayString ?? (o.orderValue?.unitAmount ? o.orderValue.unitAmount / 100 : 0)
      )
      const hasAtomicTax =
        !nonExistentDst && o.taxAmount !== undefined && o.taxAmount !== null && String(o.taxAmount).trim() !== ''
      const tax = hasAtomicTax ? parseCurrencyVal(o.taxAmount) : 0
      const grossReceivable = hasAtomicTax ? round2(subtotal + tax) : subtotal

      const hasAtomicNet = o.netPayout !== undefined && o.netPayout !== null && String(o.netPayout).trim() !== ''
      const netPayout = hasAtomicNet ? parseCurrencyVal(o.netPayout) : 0
      const hasAtomicComm = o.commission !== undefined && o.commission !== null && String(o.commission).trim() !== ''
      const atomicComm = hasAtomicComm ? -Math.abs(parseCurrencyVal(o.commission)) : 0
      const hasAtomicError =
        o.errorChargeAmount !== undefined && o.errorChargeAmount !== null && String(o.errorChargeAmount).trim() !== ''
      const atomicError = hasAtomicError ? -Math.abs(parseCurrencyVal(o.errorChargeAmount)) : 0

      const isCancelled =
        Boolean(o.cancelledOrderCategory) ||
        String(o.orderStatusValue || '').toUpperCase().includes('CANCEL')
      const hasError = Boolean(o.containsErrorCharge) || atomicError < -0.01
      const fTypeRaw = String(
        o.orderFilterType || o.fulfillmentDetails?.fulfillmentType || ''
      ).toUpperCase()
      const payoutRef = o.payoutId ? String(o.payoutId).trim() : null

      orders.push({
        storeId,
        platform: 'DOORDASH',
        businessDate,
        placedAt: nonExistentDst ? null : placedAt,
        platformOrderId: shortCode || deliveryUuid.slice(0, 8),
        platformTransactionId: deliveryUuid,
        payoutReferenceId: payoutRef,
        payoutDate: null,
        fulfillmentType: fTypeRaw.includes('PICKUP') ? 'PICKUP' : 'DELIVERY',
        transactionType: isCancelled ? 'CANCELLATION' : hasError ? 'ERROR_CHARGE' : 'ORDER',
        platformSubtotal: subtotal,
        platformTax: tax,
        platformTaxWithheld: 0,
        platformTaxPaidToMerchant: tax,
        platformGrossReceivable: grossReceivable,
        commissionFee: atomicComm,
        deliveryFee: 0,
        processingFee: 0,
        marketingFee: 0,
        errorCharge: atomicError,
        adjustmentAmount: 0,
        tipAmount: 0,
        netPayout,
        taxBreakdownVerified: hasAtomicTax,
        unverifiedReason: nonExistentDst
          ? 'NONEXISTENT_DST_LOCAL_TIME'
          : !hasAtomicTax
          ? 'MISSING_ATOMIC_TAX_DOORDASH_LIVE_ORDER'
          : storeId === 0
          ? 'UNASSIGNED_STORE'
          : null,
        unassignedStoreRaw:
          storeId === 0 ? `${o.store?.id ?? o.storeId ?? ''} ${o.store?.name ?? o.storeName ?? ''}`.trim() : null,
        disputeReason: hasError
          ? 'Orden con Error Charge reportado en DoorDash'
          : isCancelled
          ? `Orden cancelada (${o.cancelledOrderCategory || o.orderStatusDisplay || 'CANCELLED'})`
          : null,
        rawPayload: {
          ...o,
          tax_breakdown_verified: hasAtomicTax,
          non_existent_dst_local_time: nonExistentDst,
          unassigned_store: storeId === 0,
          ...(usedManualOverride ? { manual_store_override_audit: buildOverrideAudit() } : {}),
        },
      })

      if (payoutRef && !hasAtomicTax) {
        const pEntry = payoutsMap.get(`${storeId}:${payoutRef}`)
        if (pEntry) {
          pEntry.status = 'REQUIRES_REVIEW'
          pEntry.raw_payload = {
            ...(pEntry.raw_payload || {}),
            tax_breakdown_verified: false,
            unverified_reason: 'PAYOUT_CONTAINS_ORDER_WITHOUT_ATOMIC_TAX',
          }
        }
      }
    }
  }

  return {
    detectedPlatform: 'DOORDASH',
    orders,
    payouts: Array.from(payoutsMap.values()),
  }
}

/**
 * Parsea respuestas JSON nativas de los endpoints internos de Uber Eats Manager:
 * - `/manager/api/listPayoutsHistory` (`payPeriods`)
 * - `/manager/api/getNetSalesByOrder` (`rows` con `fareLineItems`)
 * - `/manager/api/getHistoricOrders` (`orders`)
 */
export function parseUberEatsNativeApiObject(
  uberRoot: Record<string, any>,
  mappings: StorePlatformMapping[],
  byUberUuid: Map<string, StorePlatformMapping>,
  byUberOrgUuid: Map<string, StorePlatformMapping>,
  defaultStoreId?: number,
  overrideOptions?: ManualStoreOverrideOptions
): {
  detectedPlatform: DeliveryPlatformCode
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
} {
  const orders: PlatformOrderInput[] = []
  const payouts: Array<Record<string, any>> = []
  const manualOverrideAllowed = Boolean(
    defaultStoreId &&
      overrideOptions?.confirmStoreAssignment === true &&
      mappings.some((m) => m.store_id === defaultStoreId)
  )
  const buildOverrideAudit = () => ({
    confirmed: true,
    assigned_store_id: defaultStoreId,
    confirmed_by_user_id: overrideOptions?.confirmedByUserId ?? null,
    confirmed_by_email: overrideOptions?.confirmedByEmail ?? null,
    confirmed_at: overrideOptions?.confirmedAt || new Date().toISOString(),
  })

  const resolveUberStore = (
    locUuid?: string | null,
    orgUuid?: string | null,
    name?: string | null
  ): { storeId: number; usedManualOverride: boolean } => {
    if (locUuid) {
      const m = byUberUuid.get(String(locUuid).trim().toLowerCase())
      if (m) return { storeId: m.store_id, usedManualOverride: false }
    }
    if (orgUuid) {
      const m = byUberOrgUuid.get(String(orgUuid).trim().toLowerCase())
      if (m) return { storeId: m.store_id, usedManualOverride: false }
    }
    if (name) {
      const lower = name.toLowerCase()
      for (const m of mappings) {
        if (lower.includes(m.store_name.toLowerCase()) || lower.includes(m.store_code.toLowerCase())) {
          return { storeId: m.store_id, usedManualOverride: false }
        }
      }
      if (lower.includes('imperial') || lower.includes('lynwood')) return { storeId: 14, usedManualOverride: false }
      if (lower.includes('firestone') || lower.includes('south gate')) return { storeId: 15, usedManualOverride: false }
      if (lower.includes('bell') || lower.includes('4406')) return { storeId: 13, usedManualOverride: false }
      if (lower.includes('huntington') || lower.includes('2425')) return { storeId: 11, usedManualOverride: false }
      if (lower.includes('downey') || lower.includes('7947')) return { storeId: 16, usedManualOverride: false }
      if (lower.includes('norwalk') || lower.includes('rosecrans')) return { storeId: 12, usedManualOverride: false }
      if (lower.includes('la puente') || lower.includes('valley')) return { storeId: 10, usedManualOverride: false }
      if (lower.includes('santa ana') || lower.includes('17th')) return { storeId: 9, usedManualOverride: false }
      if (lower.includes('hollywood') || lower.includes('sunset')) return { storeId: 8, usedManualOverride: false }
      if (lower.includes('slauson') || lower.includes('5833')) return { storeId: 7, usedManualOverride: false }
      if (lower.includes('central') || lower.includes('1900')) return { storeId: 6, usedManualOverride: false }
      if (lower.includes('broadway') || lower.includes('4380')) return { storeId: 5, usedManualOverride: false }
      if (lower.includes('azusa') && (lower.includes('887') || lower.includes('arrow')))
        return { storeId: 4, usedManualOverride: false }
      if (lower.includes('west covina') || lower.includes('101')) return { storeId: 3, usedManualOverride: false }
      if (lower.includes('rialto') || lower.includes('baseline')) return { storeId: 1, usedManualOverride: false }
    }
    if (manualOverrideAllowed && defaultStoreId) {
      return { storeId: defaultStoreId, usedManualOverride: true }
    }
    // Prohibido asignar automáticamente a Lynwood #14 o usar defaultStoreId sin confirmación explícita
    return { storeId: 0, usedManualOverride: false }
  }

  const cleanUberSettlementRef = (val: any): string => {
    const s = String(val || '').trim()
    if (!s || s === '--' || s === '-' || s.toUpperCase() === 'N/A' || s === 'null' || s === 'undefined') return ''
    return s
  }

  // 1. Procesar `payPeriods` (`listPayoutsHistory` + `getEarningsBreakdown`)
  if (Array.isArray(uberRoot.payPeriods)) {
    for (const p of uberRoot.payPeriods) {
      const settlementRef = cleanUberSettlementRef(p.transactionID) || cleanUberSettlementRef(p.settlementUUID)
      if (!settlementRef) continue
      const { storeId, usedManualOverride } = resolveUberStore(uberRoot.locationUuid, uberRoot.orgUUID)
      const marketing = parseCurrencyVal(p.marketing)
      const uberFees = parseCurrencyVal(p.uberFees)
      const netPayout = parseCurrencyVal(p.netPayout)

      let subtotalSales = 0
      let taxCollected = 0
      let taxRemittedByPlatform = 0
      let tipsAmount = 0
      let errorCharges = 0
      let adjustmentsAmount = 0
      let ordersCount = 0
      let hasTaxonomySubtotal = false
      const crossPayoutRefunds: Array<{
        orderCode: string
        orderDate: string | null
        amount: number
        description: string
        payoutRef: string
        periodStart: string
        periodEnd: string
        depositDate: string
      }> = []

      const periodStart = p.startIso || toOperationalBusinessDate(p.periodStartDate)
      const periodEnd = p.endIso || toOperationalBusinessDate(p.periodEndDate)
      const payoutDate = toOperationalBusinessDate(p.depositDate || p.periodEndDate)

      // Si viene enriquecido con `breakdown` (`getEarningsBreakdown`), extraer montos exactos del árbol contable
      if (p.breakdown && Array.isArray(p.breakdown.taxonomyNodes)) {
        const walkTaxonomy = (nodes: any[]) => {
          for (const node of nodes || []) {
            const cat = String(node?.categoryName?.text || '').trim()
            const desc = String(node?.displayText?.description?.text || '').trim()
            const amt =
              typeof node?.categoryAmount === 'number'
                ? Number(node.categoryAmount)
                : parseCurrencyVal(node?.categoryTotal?.text)

            if (cat === 'SubtotalExclTax') {
              subtotalSales = round2(Math.abs(amt))
              hasTaxonomySubtotal = true
            } else if (cat === 'TaxOnSubtotal') taxCollected = round2(Math.abs(amt))
            else if (cat === 'Tips') tipsAmount = round2(Math.abs(amt))
            else if (cat === 'MarketplaceFacilitatorTax') taxRemittedByPlatform = round2(Math.abs(amt))
            else if (cat === 'Chargebacks' || cat === 'NetCustomerRefunds' || cat === 'ChargebacksInclTax') {
              errorCharges = amt > 0 ? -amt : amt
            } else if (cat === 'ChargebacksExclTax' && errorCharges === 0) errorCharges = amt > 0 ? -amt : amt
            else if (cat === 'OtherPayments') adjustmentsAmount = round2(adjustmentsAmount + amt)
            else if (cat === 'MISC_ITEM' && amt > 0 && desc) {
              const mOrder = desc.match(/#([A-Z0-9]{4,8})\b/i)
              const mDate = desc.match(/\b(20\d{2})(\d{2})(\d{2})\b/)
              if (mOrder) {
                crossPayoutRefunds.push({
                  orderCode: mOrder[1].toUpperCase(),
                  orderDate: mDate ? `${mDate[1]}-${mDate[2]}-${mDate[3]}` : null,
                  amount: round2(amt),
                  description: desc,
                  payoutRef: settlementRef,
                  periodStart,
                  periodEnd,
                  depositDate: payoutDate,
                })
              }
            }

            // Extraer conteo de órdenes de las líneas de comisión ("Delivery, powered by Uber - 244 orders")
            if (
              ['DELIVERY', 'POSTMATES_DELIVERY', 'PICKUP', 'POSTMATES_PICKUP', 'WHITELABEL_ONLINE_ORDERING'].includes(
                cat
              ) &&
              desc
            ) {
              const mOrdersCnt = desc.match(/-\s*(\d+)\s*orders?/i)
              if (mOrdersCnt) {
                ordersCount += parseInt(mOrdersCnt[1], 10)
              }
            }

            if (Array.isArray(node?.childSummaryNodes)) {
              walkTaxonomy(node.childSummaryNodes)
            }
          }
        }
        walkTaxonomy(p.breakdown.taxonomyNodes)
      }

      // Prohibido estimar tax o subtotal restando `amendments` de `earnings` cuando falta el breakdown real
      const statusUpper = String(p.status || '').toUpperCase()
      const isSettled = statusUpper.includes('PAID') || statusUpper.includes('SETTLED')

      payouts.push({
        store_id: storeId,
        platform: 'UBER_EATS',
        payout_reference_id: settlementRef,
        period_start: periodStart,
        period_end: periodEnd,
        payout_date: payoutDate,
        orders_count: ordersCount,
        subtotal_sales: hasTaxonomySubtotal ? subtotalSales : 0,
        tax_collected: hasTaxonomySubtotal ? taxCollected : 0,
        tax_remitted_by_platform: hasTaxonomySubtotal ? taxRemittedByPlatform : 0,
        // Uber es Marketplace Facilitator: Tax Paid to Merchant SIEMPRE es $0.00
        tax_paid_to_merchant: 0,
        // En Uber Eats, Expected Gross = Subtotal sin tax (nunca incluir propinas ni tax residual)
        platform_gross_receivable: hasTaxonomySubtotal ? subtotalSales : 0,
        commission_fees: uberFees > 0 ? -uberFees : uberFees,
        delivery_fees: 0,
        processing_fees: 0,
        marketing_fees: marketing > 0 ? -marketing : marketing,
        error_charges: errorCharges,
        adjustments_amount: adjustmentsAmount,
        tips_amount: tipsAmount,
        net_payout_amount: netPayout,
        status:
          storeId === 0 || !hasTaxonomySubtotal
            ? 'REQUIRES_REVIEW'
            : isSettled
            ? 'POSTED'
            : 'PENDING',
        source_type: 'API',
        raw_payload: {
          ...p,
          cross_payout_refunds: crossPayoutRefunds,
          tax_breakdown_verified: hasTaxonomySubtotal,
          unassigned_store: storeId === 0,
          unverified_reason: !hasTaxonomySubtotal
            ? 'MISSING_UBER_EARNINGS_TAXONOMY_BREAKDOWN'
            : storeId === 0
            ? 'UNASSIGNED_STORE'
            : null,
          ...(usedManualOverride ? { manual_store_override_audit: buildOverrideAudit() } : {}),
        },
      })
    }
  }

  // 2. Procesar `rows` (`getNetSalesByOrder`)
  if (Array.isArray(uberRoot.rows)) {
    for (const r of uberRoot.rows) {
      const orderId = String(r.orderId || '').trim()
      const workflowUUID = String(r.workflowUUID || r.orderUUID || orderId).trim()
      if (!orderId && !workflowUUID) continue
      const { storeId, usedManualOverride } = resolveUberStore(
        r.locationUuid || uberRoot.locationUuid,
        r.orgUUID || uberRoot.orgUUID
      )

      const fareMap = new Map<string, number>()
      if (Array.isArray(r.fareLineItems)) {
        for (const item of r.fareLineItems) {
          if (item?.fareDescription) {
            fareMap.set(String(item.fareDescription), parseCurrencyVal(item.amount))
          }
        }
      }

      const nonExistentDst = detectNonExistentDstTimestamp(r.dateTime)
      const hasSalesExclTax = !nonExistentDst && fareMap.has('salesExclTax')
      const subtotal = fareMap.get('salesExclTax') ?? 0
      const taxOnSales = fareMap.get('taxOnSales') ?? 0
      const uberFees = fareMap.get('uberFees') ?? 0
      const chargebacks = fareMap.get('chargebacks') ?? 0
      const otherAmendments = fareMap.get('otherAmendments') ?? -taxOnSales
      const netPayout = parseCurrencyVal(r.netPayout)

      // Uber Eats retiene el 100% del Sales Tax (Marketplace Facilitator -> taxPaidToMerchant = 0)
      const taxWithheld = taxOnSales
      const taxPaidToMerchant = 0
      const grossReceivable = subtotal
      const extraAdjustment = round2(otherAmendments + taxOnSales)

      const businessDate = toOperationalBusinessDate(r.dateTime)
      let placedIso: string | null = null
      if (r.dateTime && !nonExistentDst) {
        const localMdy = String(r.dateTime).match(
          /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
        )
        if (localMdy) {
          placedIso = parseLocalLaDateTime(
            `${localMdy[1]}/${localMdy[2]}/${localMdy[3]}`,
            `${localMdy[4]}:${localMdy[5]}${localMdy[6] ? `:${localMdy[6]}` : ''} ${localMdy[7] || ''}`.trim()
          ).placedIso
        } else {
          const parsed = new Date(r.dateTime)
          if (!isNaN(parsed.getTime())) placedIso = parsed.toISOString()
        }
      }

      const statusUpper = String(r.orderStatus || '').toUpperCase()
      const hasChargeback = chargebacks < -0.01

      orders.push({
        storeId,
        platform: 'UBER_EATS',
        businessDate,
        placedAt: placedIso,
        platformOrderId: orderId || workflowUUID.slice(0, 8),
        platformTransactionId: workflowUUID,
        payoutReferenceId: r.settlementUUID || r.payoutId || uberRoot.settlementUUID || null,
        payoutDate: null,
        fulfillmentType: String(r.fulfillmentType || '').toUpperCase().includes('PICKUP')
          ? 'PICKUP'
          : 'DELIVERY',
        transactionType: hasChargeback
          ? 'ERROR_CHARGE'
          : statusUpper.includes('CANCEL') || statusUpper.includes('UNFULFILLED')
          ? 'CANCELLATION'
          : 'ORDER',
        platformSubtotal: subtotal,
        platformTax: taxOnSales,
        platformTaxWithheld: taxWithheld,
        platformTaxPaidToMerchant: taxPaidToMerchant,
        platformGrossReceivable: grossReceivable,
        commissionFee: uberFees > 0 ? -uberFees : uberFees,
        deliveryFee: 0,
        processingFee: 0,
        marketingFee: 0,
        errorCharge: chargebacks > 0 ? -chargebacks : chargebacks,
        adjustmentAmount: extraAdjustment,
        tipAmount: 0,
        netPayout,
        taxBreakdownVerified: hasSalesExclTax,
        unverifiedReason: nonExistentDst
          ? 'NONEXISTENT_DST_LOCAL_TIME'
          : !hasSalesExclTax
          ? 'MISSING_SALES_EXCL_TAX_IN_UBER_FARE_ITEMS'
          : storeId === 0
          ? 'UNASSIGNED_STORE'
          : null,
        disputeReason: hasChargeback
          ? 'Reembolso / Chargeback en Uber Eats'
          : statusUpper.includes('UNFULFILLED')
          ? 'Orden no completada (UNFULFILLED)'
          : null,
        rawPayload: {
          ...r,
          tax_breakdown_verified: hasSalesExclTax,
          non_existent_dst_local_time: nonExistentDst,
          unassigned_store: storeId === 0,
          ...(usedManualOverride ? { manual_store_override_audit: buildOverrideAudit() } : {}),
        },
      })
    }
  }

  // 3. Procesar `orders` (`getHistoricOrders`) — CERO estimaciones con 1.1025 ni 0.1025
  if (Array.isArray(uberRoot.orders)) {
    for (const o of uberRoot.orders) {
      const shortCode = String(o.orderId || o.shortCode || '').trim()
      const uuid = String(o.workflowUuid || o.orderUuid || o.uuid || shortCode).trim()
      if (!shortCode && !uuid) continue
      const { storeId, usedManualOverride } = resolveUberStore(
        o.restaurant?.uuid || o.location?.uuid || uberRoot.locationUuid,
        uberRoot.orgUUID,
        o.restaurant?.name || o.location?.name
      )
      const rawPlaced = o.requestedAt || o.orderTimestamp || null
      const nonExistentDst = detectNonExistentDstTimestamp(rawPlaced)
      const businessDate = toOperationalBusinessDate(rawPlaced)
      let placedIso: string | null = null

      if (rawPlaced && !nonExistentDst) {
        const localMatch = String(rawPlaced).match(
          /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i
        )
        if (localMatch) {
          placedIso = parseLocalLaDateTime(
            `${localMatch[1]}/${localMatch[2]}/${localMatch[3]}`,
            `${localMatch[4]}:${localMatch[5]} ${localMatch[6]}`
          ).placedIso
        } else {
          const parsed = new Date(rawPlaced)
          if (!isNaN(parsed.getTime())) placedIso = parsed.toISOString()
        }
      }

      // En `getHistoricOrders`, `salesTotal` es el subtotal atómico sin tax (ej. "$240.99").
      // Prohibido dividir `orderTotal / 1.1025` ni multiplicar `subtotal * 0.1025`.
      const hasSalesTotal =
        !nonExistentDst && o.salesTotal !== undefined && o.salesTotal !== null && String(o.salesTotal).trim() !== ''
      const subtotal = hasSalesTotal ? parseCurrencyVal(o.salesTotal) : 0
      const hasExplicitTax = o.taxTotal !== undefined && o.taxTotal !== null && String(o.taxTotal).trim() !== ''
      const atomicTax = hasExplicitTax ? parseCurrencyVal(o.taxTotal) : 0
      const chargebackTotal = parseCurrencyVal(o.chargebackTotal)
      const netPayout = parseCurrencyVal(o.netPayout ?? o.payout)

      const statusUpper = String(o.orderStatus || '').toUpperCase()
      const isCancelled =
        Boolean(o.canceledBy) ||
        Boolean(o.missedBy) ||
        statusUpper.includes('CANCEL') ||
        statusUpper.includes('MISSED') ||
        statusUpper.includes('UNFULFILLED')
      const hasIssue = Boolean(o.issueType) || Math.abs(chargebackTotal) > 0.01

      const errorCharge = chargebackTotal > 0 ? -chargebackTotal : chargebackTotal
      // Solo registrar comisión si viene explícita o si el subtotal y el chargeback se anulan al centavo (cuando el cargo absorbe el 100% del subtotal y el neto queda negativo por la comisión retenida)
      const hasExplicitUberFee =
        (o.uberFee !== undefined && o.uberFee !== null) ||
        (o.marketplaceFee !== undefined && o.marketplaceFee !== null)
      const commissionFee = hasExplicitUberFee
        ? -Math.abs(parseCurrencyVal(o.uberFee ?? o.marketplaceFee))
        : hasSalesTotal &&
          Math.abs(chargebackTotal) > 0.01 &&
          Math.abs(subtotal - Math.abs(chargebackTotal)) <= 0.01 &&
          netPayout < 0
        ? netPayout
        : 0

      // Vínculo a payout: asignar `payoutReferenceId` si existe referencia explícita o si el `payPeriod` oficial de la misma tienda en `listPayoutsHistory` es único e inequívoco.
      const explicitSettlementRef =
        cleanUberSettlementRef(o.transactionID) ||
        cleanUberSettlementRef(o.settlementUUID) ||
        cleanUberSettlementRef(o.payoutId) ||
        cleanUberSettlementRef(uberRoot.settlementUUID) ||
        null
      const candidatePayoutsForStore =
        storeId > 0
          ? payouts.filter(
              (pay) =>
                pay.store_id === storeId &&
                pay.period_start &&
                pay.period_end &&
                businessDate >= pay.period_start &&
                businessDate <= pay.period_end
            )
          : []
      const candidateByDatePayout =
        explicitSettlementRef
          ? payouts.find((pay) => pay.store_id === storeId && pay.payout_reference_id === explicitSettlementRef) ||
            (candidatePayoutsForStore.length === 1 ? candidatePayoutsForStore[0] : null)
          : candidatePayoutsForStore.length === 1
          ? candidatePayoutsForStore[0]
          : null
      const resolvedUberPayoutRef =
        explicitSettlementRef || candidateByDatePayout?.payout_reference_id || null

      const itemsSummary: Array<{ name: string; quantity: number; price: number }> = []
      if (Array.isArray(o.orderDetails?.items)) {
        for (const it of o.orderDetails.items) {
          itemsSummary.push({
            name: String(it.title || 'Item'),
            quantity: Number(it.quantity || 1),
            price: parseCurrencyVal(it.price),
          })
        }
      }

      orders.push({
        storeId,
        platform: 'UBER_EATS',
        businessDate,
        placedAt: placedIso,
        platformOrderId: shortCode || uuid.slice(0, 8),
        platformTransactionId: uuid,
        payoutReferenceId: resolvedUberPayoutRef,
        payoutDate: resolvedUberPayoutRef ? candidateByDatePayout?.payout_date || null : null,
        fulfillmentType: String(o.fulfillmentType || '').toUpperCase().includes('PICKUP')
          ? 'PICKUP'
          : 'DELIVERY',
        transactionType: hasIssue
          ? 'ERROR_CHARGE'
          : isCancelled
          ? 'CANCELLATION'
          : 'ORDER',
        platformSubtotal: subtotal,
        platformTax: atomicTax,
        platformTaxWithheld: atomicTax,
        // Uber es Marketplace Facilitator -> Tax Paid to Merchant = $0.00
        platformTaxPaidToMerchant: 0,
        platformGrossReceivable: subtotal,
        commissionFee: commissionFee < 0 ? commissionFee : 0,
        deliveryFee: 0,
        processingFee: 0,
        marketingFee: 0,
        errorCharge,
        adjustmentAmount: 0,
        tipAmount: 0,
        netPayout,
        taxBreakdownVerified: hasSalesTotal,
        unverifiedReason: nonExistentDst
          ? 'NONEXISTENT_DST_LOCAL_TIME'
          : !hasSalesTotal
          ? 'MISSING_SUBTOTAL_EXCL_TAX_UBER_HISTORIC'
          : storeId === 0
          ? 'UNASSIGNED_STORE'
          : null,
        unassignedStoreRaw:
          storeId === 0 ? String(o.restaurant?.name || o.location?.name || o.restaurant?.uuid || '') : null,
        disputeReason: hasIssue
          ? `Uber Eats Disputa/Error: ${o.issueType || 'Chargeback'} ${
              o.issueItemsInvolvedFormatted ? `(${o.issueItemsInvolvedFormatted})` : ''
            }`.trim()
          : isCancelled
          ? `Orden cancelada/perdida en Uber Eats (${o.canceledBy || o.missedBy || statusUpper})`
          : null,
        itemsSummary: itemsSummary.length > 0 ? itemsSummary : undefined,
        rawPayload: {
          ...o,
          tax_breakdown_verified: hasSalesTotal,
          non_existent_dst_local_time: nonExistentDst,
          candidate_payout_ref: candidateByDatePayout?.payout_reference_id || null,
          ...(!resolvedUberPayoutRef ? { pending_next_payout: true } : {}),
          unassigned_store: storeId === 0,
          ...(usedManualOverride ? { manual_store_override_audit: buildOverrideAudit() } : {}),
        },
      })
    }
  }

  for (const pay of payouts) {
    const linked = orders.filter(
      (o) => o.storeId === pay.store_id && o.payoutReferenceId === pay.payout_reference_id
    )
    if (linked.some((o) => o.taxBreakdownVerified === false)) {
      pay.status = 'REQUIRES_REVIEW'
      pay.raw_payload = {
        ...(pay.raw_payload || {}),
        tax_breakdown_verified: false,
        unverified_reason: 'PAYOUT_CONTAINS_ORDER_WITHOUT_ATOMIC_TAX',
      }
    }
  }

  return {
    detectedPlatform: 'UBER_EATS',
    orders,
    payouts,
  }
}

/**
 * Parsea un reporte CSV o JSON de DoorDash, Uber Eats o Grubhub y devuelve las órdenes y cortes normalizados.
 */
export async function parsePlatformReportPayload(
  rawContent: string,
  forcedPlatform?: DeliveryPlatformCode | 'AUTO',
  defaultStoreId?: number,
  overrideOptions?: ManualStoreOverrideOptions
): Promise<{
  detectedPlatform: DeliveryPlatformCode
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
}> {
  const mappings = await getStorePlatformMappings()
  const byDoorDashStoreId = new Map<string, StorePlatformMapping>()
  const byGrubhubCustId = new Map<string, StorePlatformMapping>()
  const byUberUuid = new Map<string, StorePlatformMapping>()
  const byUberOrgUuid = new Map<string, StorePlatformMapping>()

  for (const m of mappings) {
    if (m.doordash_store_id) byDoorDashStoreId.set(String(m.doordash_store_id).trim(), m)
    if (m.grubhub_cust_id) byGrubhubCustId.set(String(m.grubhub_cust_id).trim(), m)
    if (m.ubereats_store_uuid) byUberUuid.set(String(m.ubereats_store_uuid).trim().toLowerCase(), m)
    if (m.ubereats_org_uuid) byUberOrgUuid.set(String(m.ubereats_org_uuid).trim().toLowerCase(), m)
  }

  let rows: Array<Record<string, any>> = []
  const trimmed = rawContent.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsedJson = JSON.parse(trimmed)

    // 1. Detectar formato nativo de DoorDash Merchant API (payout_transactions / payout_summaries / get_orders)
    if (
      parsedJson &&
      !Array.isArray(parsedJson) &&
      (Array.isArray(parsedJson.summariesList) ||
        (Array.isArray(parsedJson.transactions) &&
          Array.isArray(parsedJson.transactions[0]) &&
          parsedJson.transactions[0][0]?.name !== undefined) ||
        (Array.isArray(parsedJson.orders) &&
          (parsedJson.orders[0]?.deliveryShortCode !== undefined ||
            parsedJson.orders[0]?.deliveryUuid !== undefined)))
    ) {
      return parseDoorDashNativeApiObject(
        parsedJson,
        mappings,
        byDoorDashStoreId,
        defaultStoreId,
        overrideOptions
      )
    }

    // 2. Detectar formato nativo de Uber Eats Manager API (listPayoutsHistory / getNetSalesByOrder / getHistoricOrders)
    const uberRoot = parsedJson?.data || parsedJson
    if (
      uberRoot &&
      !Array.isArray(uberRoot) &&
      (Array.isArray(uberRoot.payPeriods) ||
        (Array.isArray(uberRoot.rows) && uberRoot.rows[0]?.fareLineItems !== undefined) ||
        (Array.isArray(uberRoot.orders) &&
          (uberRoot.orders[0]?.shortCode !== undefined ||
            uberRoot.orders[0]?.workflowUuid !== undefined ||
            uberRoot.orders[0]?.salesTotal !== undefined)))
    ) {
      return parseUberEatsNativeApiObject(
        uberRoot,
        mappings,
        byUberUuid,
        byUberOrgUuid,
        defaultStoreId,
        overrideOptions
      )
    }

    rows = Array.isArray(parsedJson)
      ? parsedJson
      : parsedJson.transactions || parsedJson.orders || parsedJson.data || [parsedJson]
  } else {
    rows = parseCsvRows(trimmed)
  }

  if (rows.length === 0) {
    return {
      detectedPlatform: forcedPlatform && forcedPlatform !== 'AUTO' ? forcedPlatform : 'DOORDASH',
      orders: [],
      payouts: [],
    }
  }

  const headerJoined = Object.keys(rows[0]).join(' | ').toLowerCase()
  let platform: DeliveryPlatformCode = 'DOORDASH'
  if (forcedPlatform && forcedPlatform !== 'AUTO') {
    platform = forcedPlatform
  } else if (
    headerJoined.includes('doordash') ||
    headerJoined.includes('error charges') ||
    headerJoined.includes('dasher') ||
    headerJoined.includes('merchant delivery id')
  ) {
    platform = 'DOORDASH'
  } else if (
    headerJoined.includes('uber') ||
    headerJoined.includes('marketplace facilitator') ||
    headerJoined.includes('workflow') ||
    headerJoined.includes('sales (excl. tax)')
  ) {
    platform = 'UBER_EATS'
  } else if (headerJoined.includes('grubhub') || headerJoined.includes('grubhub_delivery_fee')) {
    platform = 'GRUBHUB'
  }

  const manualOverrideAllowed = Boolean(
    defaultStoreId &&
      overrideOptions?.confirmStoreAssignment === true &&
      mappings.some((m) => m.store_id === defaultStoreId)
  )
  const buildOverrideAudit = () => ({
    confirmed: true,
    assigned_store_id: defaultStoreId,
    confirmed_by_user_id: overrideOptions?.confirmedByUserId ?? null,
    confirmed_by_email: overrideOptions?.confirmedByEmail ?? null,
    confirmed_at: overrideOptions?.confirmedAt || new Date().toISOString(),
  })

  const resolveStoreId = (row: Record<string, any>): { storeId: number; usedManualOverride: boolean } => {
    const extStoreId = findColumnValue(row, [
      'Store ID',
      'store_id',
      'storeId',
      'Merchant Store ID',
      'Shop ID',
      'Restaurant ID',
      'cust_id',
    ]).trim()

    if (extStoreId) {
      if (byDoorDashStoreId.has(extStoreId))
        return { storeId: byDoorDashStoreId.get(extStoreId)!.store_id, usedManualOverride: false }
      if (byGrubhubCustId.has(extStoreId))
        return { storeId: byGrubhubCustId.get(extStoreId)!.store_id, usedManualOverride: false }
      if (byUberUuid.has(extStoreId.toLowerCase()))
        return { storeId: byUberUuid.get(extStoreId.toLowerCase())!.store_id, usedManualOverride: false }
      const numId = Number(extStoreId)
      if (mappings.some((m) => m.store_id === numId)) return { storeId: numId, usedManualOverride: false }
    }

    const storeNameVal = findColumnValue(row, ['Store Name', 'store_name', 'Restaurant Name', 'Location']).toLowerCase()
    if (storeNameVal) {
      for (const m of mappings) {
        if (
          storeNameVal.includes(m.store_name.toLowerCase()) ||
          storeNameVal.includes(m.store_code.toLowerCase())
        ) {
          return { storeId: m.store_id, usedManualOverride: false }
        }
      }
      if (storeNameVal.includes('imperial') || storeNameVal.includes('lynwood'))
        return { storeId: 14, usedManualOverride: false }
      if (storeNameVal.includes('firestone') || storeNameVal.includes('south gate'))
        return { storeId: 15, usedManualOverride: false }
      if (storeNameVal.includes('bell') || storeNameVal.includes('4406'))
        return { storeId: 13, usedManualOverride: false }
      if (storeNameVal.includes('huntington') || storeNameVal.includes('2425'))
        return { storeId: 11, usedManualOverride: false }
      if (storeNameVal.includes('downey') || storeNameVal.includes('7947'))
        return { storeId: 16, usedManualOverride: false }
      if (storeNameVal.includes('norwalk') || storeNameVal.includes('rosecrans'))
        return { storeId: 12, usedManualOverride: false }
      if (storeNameVal.includes('la puente') || storeNameVal.includes('valley'))
        return { storeId: 10, usedManualOverride: false }
      if (storeNameVal.includes('santa ana') || storeNameVal.includes('17th'))
        return { storeId: 9, usedManualOverride: false }
      if (storeNameVal.includes('hollywood') || storeNameVal.includes('sunset'))
        return { storeId: 8, usedManualOverride: false }
      if (storeNameVal.includes('slauson') || storeNameVal.includes('5833'))
        return { storeId: 7, usedManualOverride: false }
      if (storeNameVal.includes('central') || storeNameVal.includes('1900'))
        return { storeId: 6, usedManualOverride: false }
      if (storeNameVal.includes('broadway') || storeNameVal.includes('4380'))
        return { storeId: 5, usedManualOverride: false }
      if (storeNameVal.includes('azusa') && (storeNameVal.includes('887') || storeNameVal.includes('arrow')))
        return { storeId: 4, usedManualOverride: false }
      if (storeNameVal.includes('west covina') || storeNameVal.includes('101'))
        return { storeId: 3, usedManualOverride: false }
      if (storeNameVal.includes('rialto') || storeNameVal.includes('baseline'))
        return { storeId: 1, usedManualOverride: false }
    }

    if (manualOverrideAllowed && defaultStoreId) {
      return { storeId: defaultStoreId, usedManualOverride: true }
    }
    // Prohibido asignar automáticamente a Lynwood #14 o usar defaultStoreId sin confirmación explícita
    return { storeId: 0, usedManualOverride: false }
  }

  const orders: PlatformOrderInput[] = []
  const payoutsAccumulator = new Map<
    string,
    {
      store_id: number
      platform: DeliveryPlatformCode
      payout_reference_id: string
      period_start: string
      period_end: string
      payout_date: string
      orders_count: number
      all_tax_verified: boolean
      used_manual_override: boolean
      subtotal_sales: number
      tax_collected: number
      tax_remitted_by_platform: number
      tax_paid_to_merchant: number
      platform_gross_receivable: number
      commission_fees: number
      delivery_fees: number
      processing_fees: number
      marketing_fees: number
      error_charges: number
      adjustments_amount: number
      tips_amount: number
      net_payout_amount: number
    }
  >()

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]
    const { storeId, usedManualOverride } = resolveStoreId(row)

    const orderIdRaw = findColumnValue(row, [
      'DoorDash order ID',
      'Order ID',
      'Order Number',
      'order_number',
      'Merchant delivery ID',
      'Workflow UUID',
      'External ID',
      'Transaction ID',
    ]).trim()

    const txIdRaw =
      findColumnValue(row, [
        'DoorDash transaction ID',
        'Transaction ID',
        'transaction_id',
        'Merchant delivery ID',
      ]).trim() ||
      orderIdRaw ||
      `ROW-${idx + 1}`

    if (!orderIdRaw && !txIdRaw) continue

    const localDate = findColumnValue(row, [
      'Timestamp local date',
      'Order Date',
      'Date',
      'business_date',
      'Transaction Date',
    ])
    const localTime = findColumnValue(row, ['Timestamp local time', 'Order Time', 'Time'])
    const combinedTimestamp =
      localDate && localTime ? `${localDate} ${localTime}` : localDate || new Date().toISOString().slice(0, 10)
    const parsedDt = parseLocalLaDateTime(localDate, localTime)
    const nonExistentDst = Boolean(parsedDt.nonExistentDstLocalTime || detectNonExistentDstTimestamp(combinedTimestamp))
    const businessDate = toOperationalBusinessDate(combinedTimestamp)

    const payoutId =
      findColumnValue(row, ['Payout ID', 'payout_id', 'Payment ID', 'restaurant_distribution_id']).trim() || null
    const payoutDateRaw = findColumnValue(row, ['Payout date', 'Payout Date', 'effective_date', 'Payment Date'])
    const payoutDate = payoutDateRaw ? toOperationalBusinessDate(payoutDateRaw) : null

    const txTypeStr = findColumnValue(row, [
      'Transaction type',
      'Transaction Type',
      'Order Status',
      'Type',
      'order_channel',
    ]).toUpperCase()

    const channelStr = findColumnValue(row, [
      'Order channel',
      'Channel',
      'Fulfillment Type',
      'Dining Option',
      'fulfillment_type',
    ]).toUpperCase()
    const fulfillmentType: 'DELIVERY' | 'PICKUP' =
      channelStr.includes('PICKUP') || channelStr.includes('TAKEOUT') ? 'PICKUP' : 'DELIVERY'

    const subtotalRawStr = findColumnValue(row, [
      'Subtotal',
      'Sales (excl. tax)',
      'Food Sales (excl. tax)',
      'subtotal',
      'Order Subtotal',
    ])
    const taxRawStr = findColumnValue(row, [
      'Tax',
      'Subtotal Tax Passed by DoorDash to Merchant',
      'Tax (subtotal)',
      'Tax on Sales',
      'Sales Tax',
      'restaurant_sales_tax',
    ])
    const hasSubtotalCol = subtotalRawStr !== ''
    const hasTaxCol = taxRawStr !== ''

    const subtotal = parseCurrencyVal(subtotalRawStr)
    const taxTotal = parseCurrencyVal(taxRawStr)
    const taxRemittedByStateCol = Math.abs(
      parseCurrencyVal(
        findColumnValue(row, [
          'Tax remitted by DoorDash to state',
          'Marketplace Facilitator Tax',
          'Tax Withheld',
          'withheld_sales_tax',
        ])
      )
    )

    // Aplicar regla fiscal de Tacos Gavilan (sin estimar nunca impuestos)
    let taxWithheld = taxRemittedByStateCol
    let taxPaidToMerchant = round2(taxTotal - taxWithheld)
    if (platform === 'UBER_EATS') {
      // Uber Eats retiene el 100% del Sales Tax como Marketplace Facilitator
      taxWithheld = taxTotal > 0 ? taxTotal : taxRemittedByStateCol
      taxPaidToMerchant = 0
    } else {
      // DoorDash y Grubhub entregan el Sales Tax al restaurante
      if (taxPaidToMerchant < 0) taxPaidToMerchant = taxTotal
    }

    const taxBreakdownVerified = !nonExistentDst && hasSubtotalCol && (platform === 'UBER_EATS' || hasTaxCol)
    const grossReceivable = round2(subtotal + taxPaidToMerchant)

    const rawCommission = parseCurrencyVal(
      findColumnValue(row, ['Commission', 'Marketplace Fee', 'Uber Fee', 'advertising_fee', 'Commission with tax'])
    )
    const commissionFee = rawCommission > 0 ? -rawCommission : rawCommission

    const rawDeliveryFee = parseCurrencyVal(
      findColumnValue(row, ['Delivery fee', 'grubhub_delivery_fee', 'Delivery Commission'])
    )
    const deliveryFee = rawDeliveryFee > 0 ? -rawDeliveryFee : rawDeliveryFee

    const rawProcessingFee = parseCurrencyVal(
      findColumnValue(row, ['Merchant fees', 'Processing fee', 'processing_fee', 'Credit card fees'])
    )
    const processingFee = rawProcessingFee > 0 ? -rawProcessingFee : rawProcessingFee

    const rawMarketingFee = parseCurrencyVal(
      findColumnValue(row, ['Marketing fees', 'Fees', 'Marketing & Promotions', 'merchant_funded_promotion'])
    )
    const marketingFee = rawMarketingFee > 0 ? -rawMarketingFee : rawMarketingFee

    const rawErrorCharge = parseCurrencyVal(
      findColumnValue(row, [
        'Error charges',
        'Error Charge',
        'Customer Refunds',
        'Order Error Adjustments',
        'error_charge',
      ])
    )
    const errorCharge = rawErrorCharge > 0 ? -rawErrorCharge : rawErrorCharge

    const adjustmentAmount = parseCurrencyVal(
      findColumnValue(row, ['Adjustments', 'Adjustment', 'Price Adjustments', 'Other payments'])
    )
    const tipAmount = parseCurrencyVal(findColumnValue(row, ['Tips', 'Staff tip', 'Tip', 'tip']))

    const explicitNet = findColumnValue(row, [
      'Net total',
      'Net payout',
      'Net Payout',
      'Total payout',
      'Total Payout',
      'net_amount',
    ])
    const netPayout = explicitNet
      ? parseCurrencyVal(explicitNet)
      : round2(
          grossReceivable +
            tipAmount +
            commissionFee +
            deliveryFee +
            processingFee +
            marketingFee +
            errorCharge +
            adjustmentAmount
        )

    let transactionType: PlatformOrderInput['transactionType'] = 'ORDER'
    if (txTypeStr.includes('ERROR') || errorCharge < -0.01) {
      transactionType = 'ERROR_CHARGE'
    } else if (txTypeStr.includes('REFUND')) {
      transactionType = 'REFUND'
    } else if (txTypeStr.includes('ADJUST')) {
      transactionType = 'ADJUSTMENT'
    } else if (txTypeStr.includes('CANCEL')) {
      transactionType = 'CANCELLATION'
    }

    orders.push({
      storeId,
      platform,
      businessDate,
      placedAt: nonExistentDst ? null : parsedDt.placedIso,
      platformOrderId: orderIdRaw || txIdRaw,
      platformTransactionId: txIdRaw,
      payoutReferenceId: payoutId,
      payoutDate,
      fulfillmentType,
      transactionType,
      platformSubtotal: subtotal,
      platformTax: taxTotal,
      platformTaxWithheld: taxWithheld,
      platformTaxPaidToMerchant: taxPaidToMerchant,
      platformGrossReceivable: grossReceivable,
      commissionFee,
      deliveryFee,
      processingFee,
      marketingFee,
      errorCharge,
      adjustmentAmount,
      tipAmount,
      netPayout,
      taxBreakdownVerified,
      unverifiedReason: nonExistentDst
        ? 'NONEXISTENT_DST_LOCAL_TIME'
        : !taxBreakdownVerified
        ? 'MISSING_ATOMIC_TAX_COLUMN_IN_REPORT'
        : storeId === 0
        ? 'UNASSIGNED_STORE'
        : null,
      unassignedStoreRaw:
        storeId === 0
          ? findColumnValue(row, ['Store ID', 'Store Name', 'Restaurant Name', 'Location']) || 'UNASSIGNED_STORE'
          : null,
      disputeReason:
        errorCharge < -0.01
          ? findColumnValue(row, ['Description', 'Error reason', 'Adjustment reason', 'Transaction type']) ||
            'Cargo por error / Reembolso en plataforma'
          : null,
      rawPayload: {
        ...row,
        tax_breakdown_verified: taxBreakdownVerified,
        non_existent_dst_local_time: nonExistentDst,
        unassigned_store: storeId === 0,
        ...(usedManualOverride ? { manual_store_override_audit: buildOverrideAudit() } : {}),
      },
    })

    if (payoutId) {
      const pKey = `${storeId}:${platform}:${payoutId}`
      const existing = payoutsAccumulator.get(pKey) || {
        store_id: storeId,
        platform,
        payout_reference_id: payoutId,
        period_start: businessDate,
        period_end: businessDate,
        payout_date: payoutDate || businessDate,
        orders_count: 0,
        all_tax_verified: true,
        used_manual_override: usedManualOverride,
        subtotal_sales: 0,
        tax_collected: 0,
        tax_remitted_by_platform: 0,
        tax_paid_to_merchant: 0,
        platform_gross_receivable: 0,
        commission_fees: 0,
        delivery_fees: 0,
        processing_fees: 0,
        marketing_fees: 0,
        error_charges: 0,
        adjustments_amount: 0,
        tips_amount: 0,
        net_payout_amount: 0,
      }
      if (businessDate < existing.period_start) existing.period_start = businessDate
      if (businessDate > existing.period_end) existing.period_end = businessDate
      existing.orders_count += 1
      existing.all_tax_verified = existing.all_tax_verified && taxBreakdownVerified
      existing.used_manual_override = existing.used_manual_override || usedManualOverride
      existing.subtotal_sales = round2(existing.subtotal_sales + subtotal)
      existing.tax_collected = round2(existing.tax_collected + taxTotal)
      existing.tax_remitted_by_platform = round2(existing.tax_remitted_by_platform + taxWithheld)
      existing.tax_paid_to_merchant = round2(existing.tax_paid_to_merchant + taxPaidToMerchant)
      existing.platform_gross_receivable = round2(existing.platform_gross_receivable + grossReceivable)
      existing.commission_fees = round2(existing.commission_fees + commissionFee)
      existing.delivery_fees = round2(existing.delivery_fees + deliveryFee)
      existing.processing_fees = round2(existing.processing_fees + processingFee)
      existing.marketing_fees = round2(existing.marketing_fees + marketingFee)
      existing.error_charges = round2(existing.error_charges + errorCharge)
      existing.adjustments_amount = round2(existing.adjustments_amount + adjustmentAmount)
      existing.tips_amount = round2(existing.tips_amount + tipAmount)
      existing.net_payout_amount = round2(existing.net_payout_amount + netPayout)
      payoutsAccumulator.set(pKey, existing)
    }
  }

  const payouts = Array.from(payoutsAccumulator.values()).map((p) => {
    const { all_tax_verified, used_manual_override, ...restPayout } = p
    return {
      ...restPayout,
      status: p.store_id === 0 || !all_tax_verified ? 'REQUIRES_REVIEW' : 'POSTED',
      source_type: 'CSV_IMPORT',
      raw_payload: {
        tax_breakdown_verified: all_tax_verified,
        period_verified: true,
        unassigned_store: p.store_id === 0,
        unverified_reason: !all_tax_verified
          ? 'PAYOUT_CONTAINS_ORDER_WITHOUT_ATOMIC_TAX'
          : p.store_id === 0
          ? 'UNASSIGNED_STORE'
          : null,
        ...(used_manual_override ? { manual_store_override_audit: buildOverrideAudit() } : {}),
      },
    }
  })

  return { detectedPlatform: platform, orders, payouts }
}

const UBER_STORE_TO_ORG_UUID_MAP: Record<string, string> = {
  'b839f644-08fd-4bea-9d3e-d6ba52a26628': '02c60936-1cbc-42b2-a4f0-875dcb0db133', // South Gate (5800 Firestone Blvd)
  '2d974982-cc50-44a6-8059-477a0bec5153': 'a40c185a-ef74-4f6d-ad2f-1642c399c392', // LA Broadway (4380 S Broadway)
  '4486d476-bd92-5abd-a729-7e0fb0477559': '25c8205d-9090-439b-ad04-caff7a5dfcfb', // Slauson (5833 S Broadway)
  'f4dc4c71-2c3d-4d69-9a45-9044521dbb00': 'c74ac07a-04fe-4988-b937-37e73c326fb2', // West Covina (101 S Azusa Ave)
  'd29610d5-4fc8-445b-bbcf-6823d97e8100': '7fa00d0f-c6f2-45ad-98ec-1e6054f0110e', // Santa Ana (1258 17th St)
  '73a1dd8c-a455-4f33-9646-339b73211acf': '3d34fbfe-3882-4471-8151-d90705db4073', // La Puente (13009 Valley Blvd)
  '9e643fbc-eb02-4592-b30c-4f6516bafad7': 'dc470a66-0189-4c6e-9abb-14ec92e39ea8', // Azusa (887 S Azusa Ave)
  '8113a027-6e40-4faf-b056-8f9567678586': '5e8d7202-cd81-4d38-9782-398344c41805', // LA Central (1900 S Central Ave)
  '016a534e-3244-43cf-8b8f-6d5c93e5a1e2': 'ad3aeddc-ba10-4655-97ec-b0bde1a5379c', // Bell (4406 E Florence Ave)
  '94c1a255-6d39-4965-a35e-529c2dc14a0e': '568945c4-4441-4a30-ad76-c9059f67bf63', // Downey (7947 Florence Ave)
  '7e8da3ee-28a0-4f64-8279-013b982a542c': 'f3744f89-89a7-4007-b303-461fa49dad21', // Huntington Park (2425 E Florence Ave)
  '4b69329d-b878-4544-b77a-51099846d0f2': 'd4cd7259-f362-4cd2-a155-a8ed64c66019', // Lynwood (3220 E Imperial Hwy)
  '05444339-469b-4ee3-8924-5e7a144764cc': '608a5581-826c-438f-a090-9d57e255c80f', // Rialto (115 E Base Line Rd)
  '16d68a8a-789d-4ce1-a3e9-524e0a2ff947': 'bc7441a7-69ca-4d5c-a15c-2420cffc6dae', // Norwalk (10968 Rosecrans Ave)
  'a0ac666a-d9ce-4c51-9237-bba8afa44a57': 'd492fdae-6e8a-45f6-8c51-e68e0b47c954', // Hollywood (7070 W Sunset Blvd)
}

export type CoverageStatusCode = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NOT_CONNECTED'

export interface PlatformStoreCoverageItem {
  store_id: number
  store_name: string
  platform: DeliveryPlatformCode
  status: CoverageStatusCode
  cause: string
  timestamp: string
  orders_count: number
  payouts_count: number
  next_action: string
}

/**
 * Resuelve de forma determinística y exacta la vinculación de un reembolso en corte posterior (`cross_payout_refunds`).
 * - Prohibido usar match parcial (`ilike`) o actualizar múltiples órdenes.
 * - Si hay exactamente 1 coincidencia exacta -> `UNIQUE_MATCH`.
 * - Si hay >1 coincidencia -> `AMBIGUOUS_MATCH` (las órdenes deben marcarse `REQUIRES_REVIEW`).
 */
export function resolveCrossPayoutRecoveryMatch<T extends Record<string, any>>(
  orderCode: string,
  candidates: T[]
): {
  status: 'UNIQUE_MATCH' | 'AMBIGUOUS_MATCH' | 'NO_MATCH'
  matchedOrder: T | null
  ambiguousOrders: T[]
} {
  const normTarget = String(orderCode || '')
    .trim()
    .replace(/^#/, '')
    .toUpperCase()
  if (!normTarget) {
    return { status: 'NO_MATCH', matchedOrder: null, ambiguousOrders: [] }
  }
  const exactMatches = (candidates || []).filter((c) => {
    const normCand = String(c.platform_order_id || '')
      .trim()
      .replace(/^#/, '')
      .toUpperCase()
    return normCand === normTarget
  })
  if (exactMatches.length === 1) {
    return { status: 'UNIQUE_MATCH', matchedOrder: exactMatches[0], ambiguousOrders: [] }
  }
  if (exactMatches.length > 1) {
    return { status: 'AMBIGUOUS_MATCH', matchedOrder: null, ambiguousOrders: exactMatches }
  }
  return { status: 'NO_MATCH', matchedOrder: null, ambiguousOrders: [] }
}

const ddSummariesMemCache = new Map<string, { ts: number; summariesList: any[]; truncated: boolean }>()
const cookieSavedMemCache: { uberTs: number; ddTs: number } = { uberTs: 0, ddTs: 0 }

/**
 * Extrae en vivo DoorDash (payout_summaries + payout_transactions) y Uber Eats (listPayoutsHistory + getEarningsBreakdown + getHistoricOrders)
 * directamente desde las sesiones autenticadas de Chrome DevTools locales o sesiones cifradas con `INTEGRATION_ENCRYPTION_KEY`.
 * - Si `INTEGRATION_ENCRYPTION_KEY` no está configurada, aborta con estado `FAILED` y mensaje explícito.
 * - Sin límites silenciosos de 2 o 4 payouts ni fechas históricas hardcodeadas de 2026.
 * - En sincronización automática, jamás usa `defaultStoreId` si el payload no identifica la tienda.
 */
async function fetchChromeLiveDoorDashAndUberForStores(
  targetMappings: StorePlatformMapping[],
  allMappings: StorePlatformMapping[],
  startDate: string,
  endDate: string,
  targetPlatform: 'ALL' | DeliveryPlatformCode = 'ALL'
): Promise<{
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
  extraBusinessDates: string[]
  encryptionKeyMissing: boolean
  uberError?: string
  doordashError?: string
  uberPartialReason?: string
  doordashPartialReason?: string
}> {
  const orders: PlatformOrderInput[] = []
  const payouts: Array<Record<string, any>> = []
  const extraBusinessDatesSet = new Set<string>()

  if (!hasDedicatedIntegrationEncryptionKey()) {
    const errMsg =
      'INTEGRATION_ENCRYPTION_KEY no está configurada en el servidor (mínimo 16 caracteres). Sincronización de DoorDash y Uber Eats abortada por seguridad (FAILED).'
    return {
      orders,
      payouts,
      extraBusinessDates: [],
      encryptionKeyMissing: true,
      uberError: errMsg,
      doordashError: errMsg,
    }
  }

  let uberError: string | undefined
  let doordashError: string | undefined
  let uberPartialReason: string | undefined
  let doordashPartialReason: string | undefined
  let uberAuthFailed = false
  let doordashAuthFailed = false
  const lookbackStartDate = startDate
  const payoutQueryEndDate = addDaysToDateStr(endDate, 8)
  const wantUber = targetPlatform === 'ALL' || targetPlatform === 'UBER_EATS'
  const wantDd = targetPlatform === 'ALL' || targetPlatform === 'DOORDASH'
  const syncedUberStoreIds = new Set<number>()
  const syncedDdStoreIds = new Set<number>()

  const byDoorDashStoreId = new Map<string, StorePlatformMapping>()
  const byUberUuid = new Map<string, StorePlatformMapping>()
  const byUberOrgUuid = new Map<string, StorePlatformMapping>()
  for (const m of allMappings) {
    if (m.doordash_store_id) byDoorDashStoreId.set(String(m.doordash_store_id).trim(), m)
    if (m.ubereats_store_uuid) {
      const locLower = String(m.ubereats_store_uuid).trim().toLowerCase()
      byUberUuid.set(locLower, m)
      const resolvedOrg = m.ubereats_org_uuid || UBER_STORE_TO_ORG_UUID_MAP[locLower]
      if (resolvedOrg) {
        m.ubereats_org_uuid = resolvedOrg
        byUberOrgUuid.set(String(resolvedOrg).trim().toLowerCase(), m)
      }
    }
  }

  try {
    const fs = await import('fs')
    const portFile = 'C:/Users/pedro/AppData/Local/Google/Chrome/User Data/DevToolsActivePort'
    if (fs.existsSync(portFile)) {
      const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
      if (lines.length >= 2) {
        const wsUrl = `ws://127.0.0.1:${lines[0]}${lines[1]}`

        await new Promise<void>((resolve) => {
          const ws = new WebSocket(wsUrl)
          let msgId = 1
          const globalTimer = setTimeout(() => {
            try {
              ws.close()
            } catch {}
            resolve()
          }, 120000)

          const send = (method: string, params: any = {}, sessionId?: string): Promise<any> =>
            new Promise((res, rej) => {
              const cur = msgId++
              const t = setTimeout(() => rej(new Error(`CDP Timeout: ${method}`)), 25000)
              const h = (e: any) => {
                try {
                  const m = JSON.parse(e.data)
                  if (m.id === cur) {
                    clearTimeout(t)
                    ws.removeEventListener('message', h)
                    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
                  }
                } catch {}
              }
              ws.addEventListener('message', h)
              ws.send(JSON.stringify({ id: cur, method, params, ...(sessionId ? { sessionId } : {}) }))
            })

          ws.onerror = () => {
            clearTimeout(globalTimer)
            resolve()
          }

          ws.onopen = async () => {
            let createdUberTargetId: string | null = null
            let createdDdTargetId: string | null = null
            try {
              const { targetInfos } = await send('Target.getTargets')
              let uberTab = (targetInfos || []).find(
                (t: any) => t.type === 'page' && String(t.url || '').includes('merchants.ubereats.com')
              )
              let ddTab = (targetInfos || []).find(
                (t: any) =>
                  t.type === 'page' &&
                  (String(t.url || '').includes('www.doordash.com/merchant') ||
                    String(t.url || '').includes('merchant-portal.doordash.com'))
              )

              // Nunca abrir pestañas nuevas (`Target.createTarget`) en el navegador del usuario;
              // si no hay pestaña abierta, el motor usa directamente la sesión cifrada Server-to-Server en Supabase.

              const storesForOrders = new Set(targetMappings.map((m) => m.store_id))

              if (uberTab && wantUber) {
                const uberTabUrlLower = String(uberTab.url || '').toLowerCase()
                const uberTabIsLogin =
                  uberTabUrlLower.includes('auth.uber.com') || uberTabUrlLower.includes('/login')
                if (uberTabIsLogin) {
                  uberAuthFailed = true
                  uberError =
                    'Sesión de Uber Eats Manager cerrada en Chrome. Inicia sesión nuevamente en tu pestaña abierta de Uber Eats Manager y vuelve a sincronizar.'
                } else {
                  const { sessionId: uberSession } = await send('Target.attachToTarget', {
                    targetId: uberTab.targetId,
                    flatten: true,
                  })

                  if (Date.now() - cookieSavedMemCache.uberTs > 180000) {
                    const ckRes = await send(
                      'Network.getCookies',
                      { urls: ['https://merchants.ubereats.com'] },
                      uberSession
                    ).catch(() => null)
                    if (Array.isArray(ckRes?.cookies) && ckRes.cookies.length > 0) {
                      cookieSavedMemCache.uberTs = Date.now()
                      const cookieHeader = ckRes.cookies
                        .filter((c: any) => c.name !== 'selectedRestaurant')
                        .map((c: any) => `${c.name}=${c.value}`)
                        .join('; ')
                      const encryptedCookie = encryptIntegrationSecret(cookieHeader)
                      const maxExp = Math.max(...ckRes.cookies.map((c: any) => c.expires || 0))
                      const expiresAt =
                        maxExp > 0
                          ? new Date(maxExp * 1000).toISOString()
                          : new Date(Date.now() + 7 * 86400000).toISOString()
                      const { data: existingInt } = await supabaseAdmin
                        .from('integrations')
                        .select('id')
                        .eq('service_name', 'ubereats_merchant')
                        .maybeSingle()
                      if (existingInt?.id) {
                        await supabaseAdmin
                          .from('integrations')
                          .update({
                            access_token: encryptedCookie,
                            expires_at: expiresAt,
                            updated_at: new Date().toISOString(),
                          })
                          .eq('id', existingInt.id)
                      } else {
                        await supabaseAdmin.from('integrations').insert({
                          service_name: 'ubereats_merchant',
                          realm_id: 'all_15_stores',
                          access_token: encryptedCookie,
                          refresh_token: 'encrypted_cookie_session',
                          token_type: 'Cookie',
                          expires_at: expiresAt,
                          updated_at: new Date().toISOString(),
                        })
                      }
                    }
                  }

                  // Restaurar `selectedRestaurant` si la URL de la pestaña de Uber Eats tiene `?restaurantUUID=` para no desfasar nunca la vista del usuario en Chrome.
                  // Las llamadas de sincronización de Uber Eats se ejecutan abajo vía Server-to-Server con headers `Cookie` aislados por petición, sin tocar `document.cookie` del navegador.
                  const urlRestMatch = String(uberTab.url || '').match(/[?&]restaurantUUID=([0-9a-f-]{36})/i)
                  if (urlRestMatch?.[1]) {
                    await send(
                      'Network.setCookie',
                      {
                        name: 'selectedRestaurant',
                        value: urlRestMatch[1],
                        domain: 'merchants.ubereats.com',
                        path: '/',
                      },
                      uberSession
                    ).catch(() => null)
                  }
                }
              }

              if (ddTab && wantDd) {
                const ddTabUrlLower = String(ddTab.url || '').toLowerCase()
                const ddTabIsLogin =
                  ddTabUrlLower.includes('/identity/') ||
                  ddTabUrlLower.includes('/login') ||
                  ddTabUrlLower.includes('/authn')
                if (ddTabIsLogin) {
                  doordashAuthFailed = true
                  doordashError =
                    'Sesión de DoorDash Merchant cerrada en Chrome. Inicia sesión nuevamente en tu pestaña abierta de DoorDash Merchant Portal y vuelve a sincronizar.'
                  await supabaseAdmin
                    .from('integrations')
                    .update({ expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
                    .eq('service_name', 'doordash_merchant')
                } else {
                  const { sessionId: ddSession } = await send('Target.attachToTarget', {
                    targetId: ddTab.targetId,
                    flatten: true,
                  })

                  // 1. Obtener en lote paginado completo los `payout_summaries` de DoorDash PRIMERO (antes de guardar cookies) para verificar que la sesión esté autenticada
                  const ddCacheKey = `${lookbackStartDate}_${payoutQueryEndDate}`
                  const cachedDd = ddSummariesMemCache.get(ddCacheKey)
                  let allDdSummaries: any[] = []
                  let cdpDdHttpStatus = 200
                  if (cachedDd && Date.now() - cachedDd.ts < 90000 && cachedDd.summariesList.length > 0) {
                    allDdSummaries = cachedDd.summariesList
                    if (cachedDd.truncated) {
                      doordashPartialReason = 'Límite técnico de paginación alcanzado en payout_summaries de DoorDash.'
                    }
                  } else {
                    const ddSummariesEval = await send(
                      'Runtime.evaluate',
                      {
                        expression: `(async () => {
                      const summariesList = [];
                      let truncated = false;
                      for (let offset = 0; offset < 500; offset += 50) {
                        const sumRes = await fetch('https://merchant-portal.doordash.com/merchant-analytics-service/api/v2/payout_summaries', {
                          method: 'POST',
                          credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            storeIds: [],
                            businessIds: [137616],
                            organizations: [],
                            dateRange: {
                              startDate: ${JSON.stringify(`${lookbackStartDate}T07:00:00.000Z`)},
                              endDate: ${JSON.stringify(`${payoutQueryEndDate}T23:59:59.999Z`)}
                            },
                            filtersList: [{ channelsList: [3] }],
                            storeFilterGranularity: null,
                            page: { offset, limit: 50 }
                          })
                        });
                        if (!sumRes.ok) {
                          return { summariesList, truncated, httpStatus: sumRes.status };
                        }
                        const sumJson = await sumRes.json().catch(() => ({}));
                        const batch = sumJson?.summariesList || [];
                        summariesList.push(...batch);
                        if (batch.length < 50) break;
                        if (offset + 50 >= 500) truncated = true;
                      }
                      return { summariesList, truncated, httpStatus: 200 };
                    })()`,
                        awaitPromise: true,
                        returnByValue: true,
                      },
                      ddSession
                    ).catch(() => null)

                    cdpDdHttpStatus = Number(ddSummariesEval?.result?.value?.httpStatus || 200)
                    if (cdpDdHttpStatus === 401 || cdpDdHttpStatus === 403) {
                      doordashAuthFailed = true
                      doordashError = `Sesión de DoorDash Merchant expirada o cerrada (HTTP ${cdpDdHttpStatus}). Inicia sesión nuevamente en tu pestaña abierta de DoorDash Merchant Portal y vuelve a sincronizar.`
                      await supabaseAdmin
                        .from('integrations')
                        .update({ expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
                        .eq('service_name', 'doordash_merchant')
                    } else {
                      const tr = Boolean(ddSummariesEval?.result?.value?.truncated)
                      if (tr) {
                        doordashPartialReason = 'Límite técnico de paginación alcanzado en payout_summaries de DoorDash.'
                      }
                      allDdSummaries = ddSummariesEval?.result?.value?.summariesList || []
                      if (allDdSummaries.length > 0) {
                        ddSummariesMemCache.set(ddCacheKey, { ts: Date.now(), summariesList: allDdSummaries, truncated: tr })
                      }
                    }
                  }

                  if (!doordashAuthFailed && Date.now() - cookieSavedMemCache.ddTs > 180000) {
                    const ddCkRes = await send(
                      'Network.getCookies',
                      { urls: ['https://merchant-portal.doordash.com', 'https://www.doordash.com'] },
                      ddSession
                    ).catch(() => null)
                    if (Array.isArray(ddCkRes?.cookies) && ddCkRes.cookies.length > 0) {
                      cookieSavedMemCache.ddTs = Date.now()
                      const ddCookieHeader = ddCkRes.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ')
                      const encryptedDdCookie = encryptIntegrationSecret(ddCookieHeader)
                      const maxDdExp = Math.max(...ddCkRes.cookies.map((c: any) => c.expires || 0))
                      const ddExpiresAt =
                        maxDdExp > 0
                          ? new Date(maxDdExp * 1000).toISOString()
                          : new Date(Date.now() + 7 * 86400000).toISOString()
                      const { data: existingDdInt } = await supabaseAdmin
                        .from('integrations')
                        .select('id')
                        .eq('service_name', 'doordash_merchant')
                        .maybeSingle()
                      if (existingDdInt?.id) {
                        await supabaseAdmin
                          .from('integrations')
                          .update({
                            access_token: encryptedDdCookie,
                            expires_at: ddExpiresAt,
                            updated_at: new Date().toISOString(),
                          })
                          .eq('id', existingDdInt.id)
                      } else {
                        await supabaseAdmin.from('integrations').insert({
                          service_name: 'doordash_merchant',
                          realm_id: 'all_15_stores',
                          access_token: encryptedDdCookie,
                          refresh_token: 'encrypted_cookie_session',
                          token_type: 'Cookie',
                          expires_at: ddExpiresAt,
                          updated_at: new Date().toISOString(),
                        })
                      }
                    }
                  }

                  // 2. Obtener `payout_transactions` únicamente para los payouts cuyo periodo se solapa con `[startDate, endDate]`
                  for (const m of doordashAuthFailed ? [] : targetMappings) {
                  if (!m.doordash_store_id || !storesForOrders.has(m.store_id)) continue
                  const ddStoreId = String(m.doordash_store_id).trim()
                  const storeSummaries = allDdSummaries.filter((s: any) => {
                    if (String(s?.storeId || '').trim() !== ddStoreId) return false
                    const pDate = toOperationalBusinessDate(s.payoutDate)
                    const explicitStart = s.periodStartDate || s.payoutStartDate || s.startDate || null
                    const explicitEnd = s.periodEndDate || s.payoutEndDate || s.endDate || null
                    const fallbackCyc = resolveDoorDashCycleFromPayoutDate(pDate)
                    const cycStart = explicitStart ? toOperationalBusinessDate(explicitStart) : fallbackCyc.periodStart
                    const cycEnd = explicitEnd ? toOperationalBusinessDate(explicitEnd) : fallbackCyc.periodEnd
                    return cycStart <= endDate && cycEnd >= startDate
                  })
                  const matchingPayoutIds: string[] = []
                  for (const s of storeSummaries) {
                    const pId = String(s?.payoutId || s?.payout?.id || '').trim()
                    if (pId) matchingPayoutIds.push(pId)
                  }

                  const storeCombinedTransactions: any[] = []
                  for (const pId of matchingPayoutIds) {
                    const evalRes = await send(
                      'Runtime.evaluate',
                      {
                        expression: `(async () => {
                      const transactions = [];
                      let truncated = false;
                      for (let offset = 0; offset < 2000; offset += 100) {
                        const txRes = await fetch('https://merchant-portal.doordash.com/merchant-analytics-service/api/v1/payout_transactions?businessId=137616&entityType=business&limit=100&offset=' + offset + '&payoutId=' + ${JSON.stringify(pId)} + '&storeId=${ddStoreId}', {
                          credentials: 'include'
                        });
                        const txJson = await txRes.json().catch(() => ({}));
                        const batch = txJson?.transactions || [];
                        for (const r of batch) transactions.push(r);
                        if (batch.length < 100) break;
                        if (offset + 100 >= 2000) truncated = true;
                      }
                      return { transactions, storeId: '${ddStoreId}', payoutId: ${JSON.stringify(pId)}, truncated };
                    })()`,
                        awaitPromise: true,
                        returnByValue: true,
                      },
                      ddSession
                    ).catch(() => null)

                    const val = evalRes?.result?.value
                    if (val?.truncated) {
                      doordashPartialReason = `Límite técnico de paginación alcanzado en payout_transactions de DoorDash (payout ${pId}).`
                    }
                    if (val && Array.isArray(val.transactions)) {
                      storeCombinedTransactions.push(...val.transactions)
                    }
                  }

                  // Extraer también `/api/v1/transactions` por rango de fechas para capturar órdenes nocturnas (ej. domingo > 10:45 PM PT)
                  // o de la semana en curso que ya fueron cobradas en DoorDash pero entran en el siguiente corte semanal (`payoutId === ''`)
                  const seenDdTxIds = new Set<string>()
                  for (const txCells of storeCombinedTransactions) {
                    if (!Array.isArray(txCells)) continue
                    const idCell = txCells.find((c: any) => c && c.name === 1)
                    const txIdVal = String(idCell?.value || '').trim()
                    if (txIdVal) seenDdTxIds.add(txIdVal)
                  }
                  const rangeStartIso = `${startDate}T06:00:00.000Z`
                  const rangeEndIso = `${addDaysToDateStr(endDate, 1)}T15:00:00.000Z`
                  const rangeEvalRes = await send(
                    'Runtime.evaluate',
                    {
                      expression: `(async () => {
                    const transactions = [];
                    for (let offset = 0; offset < 2000; offset += 100) {
                      const txRes = await fetch('https://merchant-portal.doordash.com/merchant-analytics-service/api/v1/transactions?entityType=store&storeId=' + encodeURIComponent(${JSON.stringify(ddStoreId)}) + '&startTime=' + encodeURIComponent(${JSON.stringify(rangeStartIso)}) + '&endTime=' + encodeURIComponent(${JSON.stringify(rangeEndIso)}) + '&businessId=137616&limit=100&offset=' + offset, {
                        credentials: 'include'
                      });
                      if (!txRes.ok) break;
                      const txJson = await txRes.json().catch(() => ({}));
                      const batch = txJson?.transactions || [];
                      for (const r of batch) transactions.push(r);
                      if (batch.length < 100) break;
                    }
                    return { transactions };
                  })()`,
                      awaitPromise: true,
                      returnByValue: true,
                    },
                    ddSession
                  ).catch(() => null)
                  const rangeTxs = rangeEvalRes?.result?.value?.transactions
                  if (Array.isArray(rangeTxs)) {
                    for (const r of rangeTxs) {
                      if (!Array.isArray(r)) continue
                      const idCell = r.find((c: any) => c && c.name === 1)
                      const txIdVal = String(idCell?.value || '').trim()
                      if (txIdVal && seenDdTxIds.has(txIdVal)) continue
                      if (txIdVal) seenDdTxIds.add(txIdVal)
                      ;(r as any)._fromDateRangeTransactions = true
                      storeCombinedTransactions.push(r)
                    }
                  }

                  // P1-10: Prohibido pasar defaultStoreId en sincronización automática
                  const parsedStoreDd = parseDoorDashNativeApiObject(
                    {
                      summariesList: storeSummaries,
                      transactions: storeCombinedTransactions,
                      storeId: ddStoreId,
                      startDate,
                      endDate,
                    },
                    allMappings,
                    byDoorDashStoreId,
                    undefined
                  )
                  orders.push(...parsedStoreDd.orders)
                  payouts.push(...parsedStoreDd.payouts)
                  if (parsedStoreDd.payouts.length > 0 || parsedStoreDd.orders.length > 0) {
                    syncedDdStoreIds.add(m.store_id)
                  }
                }
                }
              }
            } catch (chromeInnerErr: any) {
              // Registrar error si falla extracción Chrome
            } finally {
              if (createdUberTargetId) {
                await send('Target.closeTarget', { targetId: createdUberTargetId }).catch(() => null)
              }
              if (createdDdTargetId) {
                await send('Target.closeTarget', { targetId: createdDdTargetId }).catch(() => null)
              }
              clearTimeout(globalTimer)
              try {
                ws.close()
              } catch {}
              resolve()
            }
          }
        })
      }
    }
  } catch {
    // Fallback a sesión cifrada en servidor si no hay sesión local de Chrome DevTools
  }

  // Fallback Headless Server-to-Server para Uber Eats con sesión cifrada (`integrations.service_name = 'ubereats_merchant'`)
  const pendingUberMappings =
    wantUber && !uberAuthFailed
      ? targetMappings.filter((m) => Boolean(m.ubereats_store_uuid) && !syncedUberStoreIds.has(m.store_id))
      : []
  if (pendingUberMappings.length > 0) {
    try {
      const { data: uberInt } = await supabaseAdmin
        .from('integrations')
        .select('access_token, expires_at')
        .eq('service_name', 'ubereats_merchant')
        .maybeSingle()

      if (!uberInt?.access_token) {
        uberError = 'Sesión de Uber Eats no conectada en servidor.'
      } else {
        const isExpired =
          uberInt?.expires_at && !isNaN(new Date(uberInt.expires_at).getTime())
            ? new Date(uberInt.expires_at).getTime() < Date.now()
            : false

        if (isExpired) {
          uberError = `Sesión de Uber Eats expirada (${uberInt.expires_at}). Requiere reconexión.`
        } else {
          const rawUberCookie = decryptIntegrationSecret(uberInt.access_token)
          if (!rawUberCookie) {
            uberError =
              'No se pudo descifrar la sesión de Uber Eats con INTEGRATION_ENCRYPTION_KEY (formato inválido o clave incorrecta).'
          } else {
            const cleanUberCookie = rawUberCookie
              .split(';')
              .map((s: string) => s.trim())
              .filter((s: string) => s && !s.startsWith('selectedRestaurant='))
              .join('; ')
            const storesForOrders = new Set(targetMappings.map((m) => m.store_id))
            const toIsoDate = (str: any) => {
              const d = new Date(str)
              if (Number.isNaN(d.getTime())) return null
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            }

            // FASE 1 (Server-to-Server): Extraer PRIMERO todos los cortes semanales oficiales (`listPayoutsHistory` + `getEarningsBreakdown`) de todas las sucursales
            const s2sRefundDatesByStore = new Map<number, string[]>()
            const s2sEnrichedPeriodsByStore = new Map<number, any[]>()
            for (const m of pendingUberMappings) {
              if (!m.ubereats_store_uuid) continue
              const locUuid = String(m.ubereats_store_uuid).trim()
              const orgUuid = m.ubereats_org_uuid || UBER_STORE_TO_ORG_UUID_MAP[locUuid.toLowerCase()] || null

              const postUberNodeApi = async (ep: string, body: Record<string, any>) => {
                for (let attempt = 1; attempt <= 4; attempt++) {
                  const res = await fetch(`https://merchants.ubereats.com/manager/api/${ep}?localeCode=en`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-csrf-token': 'x',
                      'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                      Cookie: `${cleanUberCookie}; selectedRestaurant=${locUuid}`,
                    },
                    body: JSON.stringify(body),
                  })
                  if (res.status >= 500 || (res.status === 429 && ep !== 'getHistoricOrders')) {
                    await new Promise((r) => setTimeout(r, 1500 * attempt))
                    continue
                  }
                  if (!res.ok) return { __httpError: res.status }
                  return await res.json().catch(() => ({}))
                }
                return { __httpError: 429 }
              }

              const payPeriods: any[] = []
              if (orgUuid) {
                for (let offset = 0; offset < 250; offset += 25) {
                  const payRes: any = await postUberNodeApi('listPayoutsHistory', {
                    orgUUIDs: [orgUuid],
                    isOngoingSettlementRequired: false,
                    locale: 'en',
                    startDate: lookbackStartDate,
                    endDate: payoutQueryEndDate,
                    pagination: { pageSize: 25, offset },
                  })
                  if (payRes?.__httpError) {
                    if (payRes.__httpError === 401 || payRes.__httpError === 403) {
                      uberAuthFailed = true
                      uberError = `Sesión de Uber Eats Manager expirada o cerrada (HTTP ${payRes.__httpError}). Inicia sesión nuevamente en tu pestaña abierta de Uber Eats Manager y vuelve a sincronizar.`
                      await supabaseAdmin
                        .from('integrations')
                        .update({ expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
                        .eq('service_name', 'ubereats_merchant')
                    } else {
                      uberError = `Uber Eats API devolvió HTTP ${payRes.__httpError} en listPayoutsHistory.`
                    }
                    break
                  }
                  const batch: any[] = Array.isArray(payRes?.data?.payPeriods) ? payRes.data.payPeriods : []
                  payPeriods.push(...batch)
                  if (batch.length < 25) break
                  const oldestEnd = toIsoDate(batch[batch.length - 1]?.periodEndDate)
                  if (oldestEnd && oldestEnd < lookbackStartDate) break
                  if (offset + 25 >= 250) {
                    uberPartialReason = 'Límite técnico de paginación alcanzado en listPayoutsHistory de Uber Eats.'
                  }
                }
              }

              const filteredPeriods = payPeriods.filter((p: any) => {
                const sIso = toIsoDate(p.periodStartDate)
                const eIso = toIsoDate(p.periodEndDate)
                if (!sIso || !eIso) return false
                return sIso <= endDate && eIso >= lookbackStartDate
              })

              const discoveredRefundDates: string[] = []
              const enrichedPeriods = await Promise.all(
                filteredPeriods.map(async (p: any) => {
                  const sIso = toIsoDate(p.periodStartDate)
                  const eIso = toIsoDate(p.periodEndDate)
                  let breakdown: any = null
                  if (sIso && eIso && p.settlementUUID) {
                    const eb: any = await postUberNodeApi('getEarningsBreakdown', {
                      orgUUIDs: [orgUuid],
                      startDate: sIso,
                      endDate: eIso,
                      locale: 'en',
                      settlementUUID: p.settlementUUID,
                    })
                    breakdown = eb?.data || null
                    const walk = (nodes: any[]) => {
                      for (const n of nodes || []) {
                        const cat = n?.categoryName?.text || ''
                        const desc = n?.displayText?.description?.text || ''
                        const amt = Number(n?.categoryAmount || 0)
                        if (cat === 'MISC_ITEM' && amt > 0 && desc) {
                          const mDate = desc.match(/\b(20\d{2})(\d{2})(\d{2})\b/)
                          if (mDate) discoveredRefundDates.push(`${mDate[1]}-${mDate[2]}-${mDate[3]}`)
                        }
                        if (Array.isArray(n?.childSummaryNodes)) walk(n.childSummaryNodes)
                      }
                    }
                    if (breakdown?.taxonomyNodes) walk(breakdown.taxonomyNodes)
                  }
                  return { ...p, startIso: sIso, endIso: eIso, breakdown }
                })
              )

              s2sRefundDatesByStore.set(m.store_id, discoveredRefundDates)
              s2sEnrichedPeriodsByStore.set(m.store_id, enrichedPeriods)
              if (enrichedPeriods.length > 0) {
                const parsedPayoutsOnly = parseUberEatsNativeApiObject(
                  {
                    orders: [],
                    payPeriods: enrichedPeriods,
                    locationUuid: locUuid,
                    orgUUID: orgUuid,
                  },
                  allMappings,
                  byUberUuid,
                  byUberOrgUuid,
                  undefined
                )
                payouts.push(...parsedPayoutsOnly.payouts)
              }
            }

            // FASE 2 (Server-to-Server): Extraer el detalle de órdenes (`getHistoricOrders`) por sucursal
            let s2sOrdersRateLimited = false
            for (const m of pendingUberMappings) {
              if (!m.ubereats_store_uuid || s2sOrdersRateLimited) continue
              const locUuid = String(m.ubereats_store_uuid).trim()
              const orgUuid = m.ubereats_org_uuid || UBER_STORE_TO_ORG_UUID_MAP[locUuid.toLowerCase()] || null
              const discoveredRefundDates = s2sRefundDatesByStore.get(m.store_id) || []

              const postUberNodeApi = async (ep: string, body: Record<string, any>) => {
                const res = await fetch(`https://merchants.ubereats.com/manager/api/${ep}?localeCode=en`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': 'x',
                    'User-Agent':
                      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    Cookie: `${cleanUberCookie}; selectedRestaurant=${locUuid}`,
                  },
                  body: JSON.stringify(body),
                })
                if (!res.ok) return { __httpError: res.status }
                return await res.json().catch(() => ({}))
              }

              const primaryMaxPages = 50
              const dateWindows: Array<{ s: string; e: string; maxPages: number }> = storesForOrders.has(m.store_id)
                ? [{ s: startDate, e: endDate, maxPages: primaryMaxPages }]
                : []

              const storeRawOrders: any[] = []
              for (const win of dateWindows) {
                if (s2sOrdersRateLimited) break
                let cursor = ''
                let nextTable = 'liveOrders'
                for (let page = 0; page < win.maxPages; page++) {
                  const j: any = await postUberNodeApi('getHistoricOrders', {
                    filters: {
                      currentTab: '',
                      displayCurrencyCode: '',
                      locationConstraints: {
                        cities: [],
                        countries: [],
                        locationUuids: [locUuid],
                      },
                      dateFilter: {
                        startDate: `${win.s} 00:00:00`,
                        endDate: `${addDaysToDateStr(win.e, 1)} 06:00:00`,
                        lastUpdatedAt: '',
                      },
                      isEatsPassSubscriber: false,
                      search: null,
                      orderIssuesV2: [],
                      issueOrderStatusFilter: [],
                      displayByocIssues: false,
                    },
                    sort: {
                      sortColumn: 'SORT_COLUMN_ORDER_COMPLETED_AT',
                      sortDirection: 'SORT_DIRECTION_DESC',
                    },
                    pagingInfo: {
                      cursor,
                      limit: 50,
                      nextTable,
                    },
                    pagination: {
                      cursor,
                      nextTable,
                      limit: 50,
                    },
                  })

                  if (j?.__httpError === 429) {
                    s2sOrdersRateLimited = true
                    uberPartialReason =
                      'Uber Eats limitó temporalmente getHistoricOrders (HTTP 429); todos los cortes semanales oficiales fueron sincronizados.'
                    break
                  }

                  const batch: any[] = Array.isArray(j?.data?.orders) ? j.data.orders : []
                  const nextCursor = j?.data?.paginationResult?.nextCursor || ''
                  const returnedNextTable = j?.data?.paginationResult?.nextTable || 'historyOrders'
                  if (batch.length === 0 && !nextCursor) break

                  const disputedInBatch = batch.filter(
                    (o) => o.issueType || (o.chargebackTotal && o.chargebackTotal !== '$0.00')
                  )
                  await Promise.all(
                    disputedInBatch.map(async (o) => {
                      const det: any = await postUberNodeApi('getOrderDetails', {
                        workflowUuid: o.workflowUuid,
                        orderUuid: o.orderUuid,
                        restaurantUuid: locUuid,
                      })
                      if (det?.data) o.orderDetails = det.data
                    })
                  )

                  storeRawOrders.push(...batch)
                  if (!nextCursor) break
                  if (page + 1 >= win.maxPages) {
                    uberPartialReason = 'Límite técnico de paginación alcanzado en getHistoricOrders de Uber Eats.'
                  }
                  cursor = nextCursor
                  nextTable = returnedNextTable
                }
              }

              // P1-10: Prohibido pasar defaultStoreId en sincronización automática
              // Pasar `enrichedPeriods` de la misma tienda para resolver `payoutReferenceId` de forma determinística
              const parsed = parseUberEatsNativeApiObject(
                {
                  orders: storeRawOrders,
                  payPeriods: s2sEnrichedPeriodsByStore.get(m.store_id) || [],
                  locationUuid: locUuid,
                  orgUUID: orgUuid,
                },
                allMappings,
                byUberUuid,
                byUberOrgUuid,
                undefined
              )
              orders.push(...parsed.orders)
            }
          }
        }
      }
    } catch (uErr: any) {
      uberError = `Error sincronizando Uber Eats: ${uErr.message}`
    }
  }

  // Fallback Headless Server-to-Server para DoorDash con sesión cifrada (`integrations.service_name = 'doordash_merchant'`)
  const pendingDdMappings =
    wantDd && !doordashAuthFailed
      ? targetMappings.filter((m) => Boolean(m.doordash_store_id) && !syncedDdStoreIds.has(m.store_id))
      : []
  if (pendingDdMappings.length > 0) {
    try {
      const { data: ddInt } = await supabaseAdmin
        .from('integrations')
        .select('access_token, expires_at')
        .eq('service_name', 'doordash_merchant')
        .maybeSingle()

      if (!ddInt?.access_token) {
        doordashError = 'Sesión de DoorDash no conectada en servidor.'
      } else {
        const isDdExpired =
          ddInt?.expires_at && !isNaN(new Date(ddInt.expires_at).getTime())
            ? new Date(ddInt.expires_at).getTime() < Date.now()
            : false

        if (isDdExpired) {
          doordashError = `Sesión de DoorDash expirada (${ddInt.expires_at}). Requiere reconexión.`
        } else {
          const rawDdCookie = decryptIntegrationSecret(ddInt.access_token)
          if (!rawDdCookie) {
            doordashError =
              'No se pudo descifrar la sesión de DoorDash con INTEGRATION_ENCRYPTION_KEY (formato inválido o clave incorrecta).'
          } else {
            const ddHeaders = {
              'Content-Type': 'application/json',
              Cookie: rawDdCookie,
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Origin: 'https://www.doordash.com',
              Referer: 'https://www.doordash.com/',
            }

            const ddCacheKey = `${lookbackStartDate}_${payoutQueryEndDate}`
            const cachedDd = ddSummariesMemCache.get(ddCacheKey)
            const allDdSummaries: any[] = []
            if (cachedDd && Date.now() - cachedDd.ts < 90000 && cachedDd.summariesList.length > 0) {
              allDdSummaries.push(...cachedDd.summariesList)
              if (cachedDd.truncated) {
                doordashPartialReason = 'Límite técnico de paginación alcanzado en payout_summaries de DoorDash.'
              }
            } else {
              let tr = false
              for (let offset = 0; offset < 500; offset += 50) {
                const sumRes = await fetch(
                  'https://merchant-portal.doordash.com/merchant-analytics-service/api/v2/payout_summaries',
                  {
                    method: 'POST',
                    headers: ddHeaders,
                    body: JSON.stringify({
                      storeIds: [],
                      businessIds: [137616],
                      organizations: [],
                      dateRange: {
                        startDate: `${lookbackStartDate}T07:00:00.000Z`,
                        endDate: `${payoutQueryEndDate}T23:59:59.999Z`,
                      },
                      filtersList: [{ channelsList: [3] }],
                      storeFilterGranularity: null,
                      page: { offset, limit: 50 },
                    }),
                  }
                ).catch(() => null)
                if (!sumRes || !sumRes.ok) {
                  if (sumRes && !sumRes.ok && offset === 0) {
                    if (sumRes.status === 401 || sumRes.status === 403) {
                      doordashAuthFailed = true
                      doordashError = `Sesión de DoorDash Merchant expirada o cerrada (HTTP ${sumRes.status}). Inicia sesión nuevamente en tu pestaña abierta de DoorDash Merchant Portal y vuelve a sincronizar.`
                      await supabaseAdmin
                        .from('integrations')
                        .update({ expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
                        .eq('service_name', 'doordash_merchant')
                    } else {
                      doordashError = `DoorDash API devolvió HTTP ${sumRes.status} en payout_summaries.`
                    }
                  }
                  break
                }
                const sumJson: any = await sumRes.json().catch(() => ({}))
                const batch: any[] = Array.isArray(sumJson?.summariesList) ? sumJson.summariesList : []
                allDdSummaries.push(...batch)
                if (batch.length < 50) break
                if (offset + 50 >= 500) {
                  tr = true
                  doordashPartialReason = 'Límite técnico de paginación alcanzado en payout_summaries de DoorDash.'
                }
              }
              if (allDdSummaries.length > 0) {
                ddSummariesMemCache.set(ddCacheKey, { ts: Date.now(), summariesList: allDdSummaries, truncated: tr })
              }
            }

            const { data: dbDdPayouts } = await supabaseAdmin
              .from('delivery_platform_payouts')
              .select('store_id, payout_reference_id, payout_date, period_start, period_end, raw_payload')
              .eq('platform', 'DOORDASH')
              .gte('period_end', startDate)
              .lte('period_start', endDate)

            for (const m of doordashAuthFailed ? [] : pendingDdMappings) {
              if (!m.doordash_store_id) continue
              const ddStoreId = String(m.doordash_store_id).trim()
              const storeSummaries = allDdSummaries.filter((s: any) => {
                if (String(s?.storeId || '').trim() !== ddStoreId) return false
                const pDate = toOperationalBusinessDate(s.payoutDate)
                const explicitStart = s.periodStartDate || s.payoutStartDate || s.startDate || null
                const explicitEnd = s.periodEndDate || s.payoutEndDate || s.endDate || null
                const fallbackCyc = resolveDoorDashCycleFromPayoutDate(pDate)
                const cycStart = explicitStart ? toOperationalBusinessDate(explicitStart) : fallbackCyc.periodStart
                const cycEnd = explicitEnd ? toOperationalBusinessDate(explicitEnd) : fallbackCyc.periodEnd
                return cycStart <= endDate && cycEnd >= startDate
              })
              const matchingPayoutIdsSet = new Set<string>()
              for (const s of storeSummaries) {
                const pId = String(s?.payoutId || s?.payout?.id || '').trim()
                if (pId) matchingPayoutIdsSet.add(pId)
              }
              for (const dbp of dbDdPayouts || []) {
                if (Number(dbp.store_id) === m.store_id && dbp.payout_reference_id) {
                  matchingPayoutIdsSet.add(String(dbp.payout_reference_id).trim())
                  if (storeSummaries.length === 0 && dbp.raw_payload?.payoutId) {
                    storeSummaries.push(dbp.raw_payload)
                  }
                }
              }

              // P1-8: Sin límite silencioso .slice(0, 2)
              const targetPayoutIds = Array.from(matchingPayoutIdsSet)
              const storeCombinedTransactions: any[] = []
              for (const pId of targetPayoutIds) {
                for (let offset = 0; offset < 2000; offset += 100) {
                  const txRes = await fetch(
                    `https://merchant-portal.doordash.com/merchant-analytics-service/api/v1/payout_transactions?businessId=137616&entityType=business&limit=100&offset=${offset}&payoutId=${encodeURIComponent(
                      pId
                    )}&storeId=${encodeURIComponent(ddStoreId)}`,
                    { headers: ddHeaders }
                  ).catch(() => null)
                  if (!txRes || !txRes.ok) break
                  const txJson: any = await txRes.json().catch(() => ({}))
                  const batch: any[] = Array.isArray(txJson?.transactions) ? txJson.transactions : []
                  storeCombinedTransactions.push(...batch)
                  if (batch.length < 100) break
                  if (offset + 100 >= 2000) {
                    doordashPartialReason = `Límite técnico de paginación alcanzado en payout_transactions de DoorDash (payout ${pId}).`
                  }
                }
              }

              // Extraer también `/api/v1/transactions` por rango de fechas para capturar órdenes nocturnas (ej. domingo > 10:45 PM PT)
              // o de la semana en curso que ya fueron cobradas en DoorDash pero entran en el siguiente corte semanal (`payoutId === ''`)
              const seenDdTxIds = new Set<string>()
              for (const txCells of storeCombinedTransactions) {
                if (!Array.isArray(txCells)) continue
                const idCell = txCells.find((c: any) => c && c.name === 1)
                const txIdVal = String(idCell?.value || '').trim()
                if (txIdVal) seenDdTxIds.add(txIdVal)
              }
              const rangeStartIso = `${startDate}T06:00:00.000Z`
              const rangeEndIso = `${addDaysToDateStr(endDate, 1)}T15:00:00.000Z`
              for (let offset = 0; offset < 2000; offset += 100) {
                const txRes = await fetch(
                  `https://merchant-portal.doordash.com/merchant-analytics-service/api/v1/transactions?entityType=store&storeId=${encodeURIComponent(
                    ddStoreId
                  )}&startTime=${encodeURIComponent(rangeStartIso)}&endTime=${encodeURIComponent(
                    rangeEndIso
                  )}&businessId=137616&limit=100&offset=${offset}`,
                  { headers: ddHeaders }
                ).catch(() => null)
                if (!txRes || !txRes.ok) break
                const txJson: any = await txRes.json().catch(() => ({}))
                const batch: any[] = Array.isArray(txJson?.transactions) ? txJson.transactions : []
                for (const r of batch) {
                  if (!Array.isArray(r)) continue
                  const idCell = r.find((c: any) => c && c.name === 1)
                  const txIdVal = String(idCell?.value || '').trim()
                  if (txIdVal && seenDdTxIds.has(txIdVal)) continue
                  if (txIdVal) seenDdTxIds.add(txIdVal)
                  ;(r as any)._fromDateRangeTransactions = true
                  storeCombinedTransactions.push(r)
                }
                if (batch.length < 100) break
              }

              if (storeSummaries.length > 0 || storeCombinedTransactions.length > 0) {
                // P1-10: Prohibido pasar defaultStoreId en sincronización automática
                const parsedStoreDd = parseDoorDashNativeApiObject(
                  {
                    summariesList: storeSummaries,
                    transactions: storeCombinedTransactions,
                    storeId: ddStoreId,
                    startDate,
                    endDate,
                  },
                  allMappings,
                  byDoorDashStoreId,
                  undefined
                )
                orders.push(...parsedStoreDd.orders)
                payouts.push(...parsedStoreDd.payouts)
              }
            }
          }
        }
      }
    } catch (ddErr: any) {
      doordashError = `Error sincronizando DoorDash: ${ddErr.message}`
    }
  }

  return {
    orders: orders.filter((o) => o.businessDate >= startDate && o.businessDate <= endDate),
    payouts: payouts.filter((p) => {
      const pStart = String(p.period_start || p.payout_date || '')
      const pEnd = String(p.period_end || p.payout_date || '')
      if (!pStart || !pEnd) return true
      return pStart <= endDate && pEnd >= startDate
    }),
    extraBusinessDates: [],
    encryptionKeyMissing: false,
    uberError,
    doordashError,
    uberPartialReason,
    doordashPartialReason,
  }
}

/**
 * Almacena y recupera registros en cuarentena con tienda desconocida (`store_id = 0` / `UNASSIGNED_STORE`)
 * para no contaminar la tabla `stores` ni violar la llave foránea `store_id_fkey`, bloqueando su publicación.
 */
export async function saveQuarantinedUnassignedRecords(
  unassignedOrders: PlatformOrderInput[],
  unassignedPayouts: Array<Record<string, any>>
): Promise<void> {
  if (unassignedOrders.length === 0 && unassignedPayouts.length === 0) return
  const existing = await getQuarantinedUnassignedRecords()
  const ordersByKey = new Map<string, any>()
  for (const o of existing.orders) {
    ordersByKey.set(`${o.platform}:${o.platform_transaction_id}`, o)
  }
  for (const inp of unassignedOrders) {
    const row = buildReconciledOrderRow(inp, null, 'PLATFORM_ONLY', undefined)
    row.id = `quarantine-ord-${inp.platform}-${inp.platformTransactionId}`
    row.store_id = 0
    row.reconciliation_status = 'REQUIRES_REVIEW'
    ordersByKey.set(`${inp.platform}:${inp.platformTransactionId}`, row)
  }

  const payoutsByKey = new Map<string, any>()
  for (const p of existing.payouts) {
    payoutsByKey.set(`${p.platform}:${p.payout_reference_id}`, p)
  }
  for (const p of unassignedPayouts) {
    payoutsByKey.set(`${p.platform}:${p.payout_reference_id}`, {
      ...p,
      id: `quarantine-pay-${p.platform}-${p.payout_reference_id}`,
      store_id: 0,
      status: 'REQUIRES_REVIEW',
    })
  }

  const payloadStr = JSON.stringify({
    orders: Array.from(ordersByKey.values()).slice(-500),
    payouts: Array.from(payoutsByKey.values()).slice(-200),
    updatedAt: new Date().toISOString(),
  })

  const { data: qRow } = await supabaseAdmin
    .from('integrations')
    .select('id')
    .eq('service_name', 'delivery_unassigned_quarantine')
    .maybeSingle()

  if (qRow?.id) {
    await supabaseAdmin
      .from('integrations')
      .update({
        access_token: payloadStr,
        updated_at: new Date().toISOString(),
      })
      .eq('id', qRow.id)
  } else {
    await supabaseAdmin.from('integrations').insert({
      service_name: 'delivery_unassigned_quarantine',
      realm_id: 'unassigned_store_0',
      access_token: payloadStr,
      refresh_token: 'quarantine',
      token_type: 'JSON',
      updated_at: new Date().toISOString(),
    })
  }
}

export async function getQuarantinedUnassignedRecords(): Promise<{
  orders: Array<Record<string, any>>
  payouts: Array<Record<string, any>>
}> {
  try {
    const { data } = await supabaseAdmin
      .from('integrations')
      .select('access_token')
      .eq('service_name', 'delivery_unassigned_quarantine')
      .maybeSingle()
    if (!data?.access_token) return { orders: [], payouts: [] }
    const parsed = JSON.parse(data.access_token)
    return {
      orders: Array.isArray(parsed?.orders) ? parsed.orders : [],
      payouts: Array.isArray(parsed?.payouts) ? parsed.payouts : [],
    }
  } catch {
    return { orders: [], payouts: [] }
  }
}

/**
 * Deduplica cortes (payouts) preservando estrictamente la identidad compuesta:
 * `platform + store_id + payout_reference_id`.
 * Prohibido eliminar o sobrescribir el corte de otra sucursal aunque comparta `payout_reference_id`.
 */
export function deduplicatePayoutRecords(payouts: Array<Record<string, any>>): Array<Record<string, any>> {
  const uniquePayoutsMap = new Map<string, Record<string, any>>()
  for (const p of payouts) {
    const ref = String(p.payout_reference_id || '').trim()
    if (!ref) continue
    const storeKey = Number(p.store_id ?? 0)
    const platKey = String(p.platform || '').toUpperCase()
    uniquePayoutsMap.set(`${platKey}:${storeKey}:${ref}`, p)
  }
  return Array.from(uniquePayoutsMap.values())
}

/**
 * Motor determinístico de cruce de órdenes de plataforma contra órdenes de Toast POS para una sucursal:
 * - PASADA 1: requiere identificador confiable de plataforma (`EXACT_ID`).
 *   Si más de un candidato de Toast coincide con el ID -> marca `AMBIGUOUS` (`REQUIRES_REVIEW`), nunca escoge el primero.
 * - PASADA 2: si no hay match por ID pero existen órdenes en la misma fecha operativa con el mismo subtotal (±$0.10):
 *   * Si hay >1 candidato con mismo subtotal -> marca `AMBIGUOUS` (`REQUIRES_REVIEW`).
 *   * Si hay 1 candidato -> marca `UNVERIFIED_NO_ID` (`REQUIRES_REVIEW`). Prohibido auto-conciliar (`MATCHED`) solo por fecha + subtotal.
 */
export function matchPlatformAndToastOrdersForStore(
  storePlatformOrders: PlatformOrderInput[],
  toastOrders: ToastDeliveryOrderRecord[],
  auditByToastGuid: Map<string, string> = new Map(),
  existingManualByTxKey: Map<string, Record<string, any>> = new Map()
): {
  rowsToUpsert: Array<Record<string, any>>
  matchedToastGuids: Set<string>
} {
  const matchedToastGuids = new Set<string>()
  const matchedPlatformTxKeys = new Set<string>()
  const rowsToUpsert: Array<Record<string, any>> = []

  const normalizeId = (id: string | null | undefined) =>
    String(id || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()

  // PASADA 1: Match por Identificador Confiable de Plataforma
  // Priorizar siempre órdenes primarias con subtotal positivo y IDs numéricos oficiales sobre reembolsos/reversos ($0 o negativos) o filas UUID antiguas
  const pass1PlatformOrders = [...storePlatformOrders].sort((a, b) => {
    const aPos = Number(a.platformSubtotal || 0) > 0 ? 0 : 1
    const bPos = Number(b.platformSubtotal || 0) > 0 ? 0 : 1
    if (aPos !== bPos) return aPos - bPos
    const aNum = /^\d+$/.test(String(a.platformTransactionId || '')) ? 0 : 1
    const bNum = /^\d+$/.test(String(b.platformTransactionId || '')) ? 0 : 1
    return aNum - bNum
  })

  for (const pOrd of pass1PlatformOrders) {
    const pKey = `${pOrd.platform}:${pOrd.platformTransactionId}`
    const normPId = normalizeId(pOrd.platformOrderId)
    const normTxId = normalizeId(pOrd.platformTransactionId)
    // Si el ID de orden es genérico (ej. ROW-1) o demasiado corto (<4), no se considera ID confiable
    const hasReliableId =
      normPId.length >= 4 && !normPId.startsWith('ROW') && !normPId.startsWith('UNVERIFIED')

    if (!hasReliableId) continue

    const exactCandidates = toastOrders.filter((t) => {
      if (matchedToastGuids.has(t.toastOrderGuid)) return false
      if (t.platform !== pOrd.platform) return false
      const normTId = normalizeId(t.extractedPlatformId)
      const normTab = normalizeId(t.toastTabName)
      const effectiveTId =
        normTId.length >= 14
          ? normTId
          : String(t.toastTabName || '').match(/\d{14,16}/)?.[0] || normTId
      if (effectiveTId && effectiveTId.length >= 4) {
        if (effectiveTId === normPId || normPId.endsWith(effectiveTId) || effectiveTId.endsWith(normPId)) {
          return true
        }
        if (normTxId && normTxId.length >= 6 && (effectiveTId === normTxId || normTxId.endsWith(effectiveTId))) {
          return true
        }
        // Grubhub 15-digit order root (primeros 13 dígitos idénticos, o epoch de 4 dígitos pos 4..8 idéntico del POS Relay con subtotal/tax exactos)
        if (
          pOrd.platform === 'GRUBHUB' &&
          normPId.length >= 14 &&
          effectiveTId.length >= 14 &&
          t.businessDate === pOrd.businessDate &&
          Math.abs(t.netSales - pOrd.platformSubtotal) <= 0.02
        ) {
          if (normPId.slice(0, 13) === effectiveTId.slice(0, 13)) {
            return true
          }
          if (
            normPId.slice(4, 8) === effectiveTId.slice(4, 8) &&
            Math.abs(t.taxAmount - pOrd.platformTax) <= 0.02 &&
            (!pOrd.placedAt ||
              !t.openedAt ||
              Math.abs(new Date(pOrd.placedAt).getTime() - new Date(t.openedAt).getTime()) <= 300000)
          ) {
            return true
          }
        }
      }
      if (normPId.length >= 5 && normTab.includes(normPId)) {
        return true
      }
      return false
    })

    // Si hay múltiples candidatos por ID, preferir primero candidatos activos (no anulados en Toast) y luego desambiguar por fecha y subtotal
    let resolvedCandidates = exactCandidates
    const activeExactCandidates = exactCandidates.filter((c) => !c.isVoidedInToast)
    if (activeExactCandidates.length > 0 && activeExactCandidates.length < exactCandidates.length) {
      resolvedCandidates = activeExactCandidates
    }
    if (resolvedCandidates.length > 1) {
      const strictDateAndSubtotal = resolvedCandidates.filter(
        (c) =>
          c.businessDate === pOrd.businessDate &&
          Math.abs((c.isVoidedInToast ? c.voidedOriginalSubtotal || 0 : c.netSales) - pOrd.platformSubtotal) <= 0.02
      )
      if (strictDateAndSubtotal.length === 1) {
        resolvedCandidates = strictDateAndSubtotal
      }
    }

    if (resolvedCandidates.length === 1) {
      const exactToast = resolvedCandidates[0]
      matchedToastGuids.add(exactToast.toastOrderGuid)
      matchedPlatformTxKeys.add(pKey)
      rowsToUpsert.push(
        buildReconciledOrderRow(
          pOrd,
          exactToast,
          'EXACT_ID',
          auditByToastGuid.get(exactToast.toastOrderGuid),
          existingManualByTxKey.get(pKey)
        )
      )
    } else if (resolvedCandidates.length > 1) {
      // Más de un candidato con el mismo ID -> marcar AMBIGUOUS / REQUIRES_REVIEW (prohibido escoger el primero)
      matchedPlatformTxKeys.add(pKey)
      const ambiguousCandidatesMeta = resolvedCandidates.map((c) => ({
        toastOrderGuid: c.toastOrderGuid,
        toastDisplayNumber: c.toastDisplayNumber,
        toastTabName: c.toastTabName,
        businessDate: c.businessDate,
        netSales: c.netSales,
        taxAmount: c.taxAmount,
      }))
      const clonePOrd: PlatformOrderInput = {
        ...pOrd,
        unverifiedReason: 'AMBIGUOUS_MULTIPLE_TOAST_ID_CANDIDATES',
        disputeReason: `Matching ambiguo: ${resolvedCandidates.length} órdenes de Toast POS coinciden con el ID #${pOrd.platformOrderId}. Requiere selección manual.`,
        rawPayload: {
          ...(pOrd.rawPayload || {}),
          ambiguous_toast_candidates: ambiguousCandidatesMeta,
        },
      }
      rowsToUpsert.push(
        buildReconciledOrderRow(clonePOrd, null, 'AMBIGUOUS', undefined, existingManualByTxKey.get(pKey))
      )
    }
  }

  // PASADA 2: Detección de candidatos por misma fecha operativa + mismo subtotal (±$0.10) SIN auto-conciliar
  for (const pOrd of storePlatformOrders) {
    const pKey = `${pOrd.platform}:${pOrd.platformTransactionId}`
    if (matchedPlatformTxKeys.has(pKey)) continue

    const sameSubtotalCandidates = toastOrders.filter((t) => {
      if (t.isVoidedInToast) return false
      if (matchedToastGuids.has(t.toastOrderGuid)) return false
      if (t.platform !== pOrd.platform) return false
      const subDiff = Math.abs(pOrd.platformSubtotal - t.netSales)
      if (subDiff > 0.1) return false

      if (pOrd.placedAt && t.openedAt) {
        const diffMin = Math.abs(new Date(pOrd.placedAt).getTime() - new Date(t.openedAt).getTime()) / 60000
        if (diffMin <= 90 && pOrd.businessDate === t.businessDate) return true
      }
      return pOrd.businessDate === t.businessDate
    })

    if (sameSubtotalCandidates.length > 1) {
      // Múltiples órdenes con misma fecha y mismo subtotal -> AMBIGUOUS / REQUIRES_REVIEW (prohibido elegir el primero)
      matchedPlatformTxKeys.add(pKey)
      const ambiguousCandidatesMeta = sameSubtotalCandidates.map((c) => ({
        toastOrderGuid: c.toastOrderGuid,
        toastDisplayNumber: c.toastDisplayNumber,
        toastTabName: c.toastTabName,
        businessDate: c.businessDate,
        netSales: c.netSales,
        taxAmount: c.taxAmount,
      }))
      const clonePOrd: PlatformOrderInput = {
        ...pOrd,
        unverifiedReason: 'AMBIGUOUS_SAME_DATE_AND_SUBTOTAL',
        disputeReason: `Matching ambiguo: ${sameSubtotalCandidates.length} órdenes en Toast POS en ${pOrd.businessDate} tienen el mismo subtotal ($${pOrd.platformSubtotal.toFixed(2)}) sin ID verificable.`,
        rawPayload: {
          ...(pOrd.rawPayload || {}),
          ambiguous_toast_candidates: ambiguousCandidatesMeta,
        },
      }
      rowsToUpsert.push(
        buildReconciledOrderRow(clonePOrd, null, 'AMBIGUOUS', undefined, existingManualByTxKey.get(pKey))
      )
    } else if (sameSubtotalCandidates.length === 1) {
      // Un candidato por fecha + subtotal pero sin ID confiable de plataforma -> dejar en REQUIRES_REVIEW (UNVERIFIED_NO_ID)
      const suggestedToast = sameSubtotalCandidates[0]
      matchedPlatformTxKeys.add(pKey)
      const clonePOrd: PlatformOrderInput = {
        ...pOrd,
        unverifiedReason: 'UNVERIFIED_NO_PLATFORM_ID_MATCH',
        disputeReason: `Sin ID de plataforma en Toast POS: existe candidato sugerido Toast #${suggestedToast.toastDisplayNumber} ($${suggestedToast.netSales.toFixed(2)}) en la misma fecha; requiere confirmación manual.`,
        rawPayload: {
          ...(pOrd.rawPayload || {}),
          suggested_toast_candidate: {
            toastOrderGuid: suggestedToast.toastOrderGuid,
            toastDisplayNumber: suggestedToast.toastDisplayNumber,
            toastTabName: suggestedToast.toastTabName,
            businessDate: suggestedToast.businessDate,
            netSales: suggestedToast.netSales,
            taxAmount: suggestedToast.taxAmount,
          },
        },
      }
      rowsToUpsert.push(
        buildReconciledOrderRow(
          clonePOrd,
          null,
          'UNVERIFIED_NO_ID',
          auditByToastGuid.get(suggestedToast.toastOrderGuid),
          existingManualByTxKey.get(pKey)
        )
      )
    }
  }

  // 3. Órdenes en Plataforma que NO tienen par en Toast POS (MISSING_IN_TOAST o AJUSTES)
  for (const pOrd of storePlatformOrders) {
    const pKey = `${pOrd.platform}:${pOrd.platformTransactionId}`
    if (matchedPlatformTxKeys.has(pKey)) continue
    rowsToUpsert.push(
      buildReconciledOrderRow(pOrd, null, 'PLATFORM_ONLY', undefined, existingManualByTxKey.get(pKey))
    )
  }

  // 4. Órdenes en Toast POS que NO tienen par en la Plataforma (MISSING_IN_PLATFORM)
  for (const tOrd of toastOrders) {
    if (tOrd.isVoidedInToast) continue
    if (matchedToastGuids.has(tOrd.toastOrderGuid)) continue
    rowsToUpsert.push(buildToastOnlyOrderRow(tOrd, auditByToastGuid.get(tOrd.toastOrderGuid)))
  }

  return { rowsToUpsert, matchedToastGuids }
}

/**
 * Construye la matriz explícita de cobertura por combinación `sucursal + plataforma` (`DOORDASH`, `UBER_EATS`, `GRUBHUB`).
 * Estados posibles:
 * - `COMPLETE`: conectado, sin errores de sync, todos los payouts tienen órdenes vinculadas y tax verificado, y no hay cero inesperado frente a Toast POS.
 * - `PARTIAL`: existe payout sin detalle de órdenes vinculadas (`payout_reference_id`), o orden sin tax atómico verificable, o paginación truncada, o ventas en Toast POS sin órdenes de plataforma.
 * - `FAILED`: fallo de sincronización, sesión expirada, o falta `INTEGRATION_ENCRYPTION_KEY`.
 * - `NOT_CONNECTED`: sucursal sin identificador configurado para esa plataforma o sin sesión conectada.
 */
export function buildStorePlatformCoverageMatrix(params: {
  mappings: StorePlatformMapping[]
  orders: Array<Record<string, any>>
  payouts: Array<Record<string, any>>
  encryptionKeyConfigured?: boolean
  uberSyncError?: string
  doordashSyncError?: string
  uberPartialReason?: string
  doordashPartialReason?: string
  grubhubErrorsByStore?: Map<number, string>
  timestamp?: string
}): PlatformStoreCoverageItem[] {
  const {
    mappings,
    orders,
    payouts,
    encryptionKeyConfigured = hasDedicatedIntegrationEncryptionKey(),
    uberSyncError,
    doordashSyncError,
    uberPartialReason,
    doordashPartialReason,
    grubhubErrorsByStore = new Map<number, string>(),
    timestamp = new Date().toISOString(),
  } = params

  const platforms: DeliveryPlatformCode[] = ['DOORDASH', 'UBER_EATS', 'GRUBHUB']
  const items: PlatformStoreCoverageItem[] = []

  for (const m of mappings) {
    for (const plat of platforms) {
      const storeId = m.store_id
      const storeName = m.store_name
      const storePlatOrders = (orders || []).filter(
        (o) => Number(o.store_id) === storeId && String(o.platform || '').toUpperCase() === plat
      )
      const realPlatOrders = storePlatOrders.filter((o) => o.match_confidence !== 'TOAST_ONLY')
      const toastOnlyOrders = storePlatOrders.filter((o) => o.match_confidence === 'TOAST_ONLY')
      const storePlatPayouts = (payouts || []).filter(
        (p) => Number(p.store_id) === storeId && String(p.platform || '').toUpperCase() === plat
      )

      const hasMapping =
        plat === 'DOORDASH'
          ? Boolean(m.doordash_store_id)
          : plat === 'UBER_EATS'
            ? Boolean(m.ubereats_store_uuid)
            : Boolean(m.grubhub_cust_id)

      if (!hasMapping) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'NOT_CONNECTED',
          cause: `Sucursal #${storeId} (${storeName}) no tiene ID de ${plat} configurado en el mapeo.`,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Configurar el identificador externo de la tienda en Configuración de Tiendas.',
        })
        continue
      }

      // Verificar errores críticos de plataforma o cifrado cuando fue una corrida en vivo o falta clave sin datos verificados
      if ((plat === 'DOORDASH' || plat === 'UBER_EATS') && !encryptionKeyConfigured && realPlatOrders.length === 0) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'FAILED',
          cause: 'Falta variable de entorno dedicada INTEGRATION_ENCRYPTION_KEY (mínimo 16 caracteres) en el servidor.',
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Configurar INTEGRATION_ENCRYPTION_KEY en el servidor o importar reporte oficial CSV/JSON.',
        })
        continue
      }

      if (plat === 'DOORDASH' && doordashSyncError && realPlatOrders.length === 0) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: doordashSyncError.includes('no conectada') ? 'NOT_CONNECTED' : 'FAILED',
          cause: doordashSyncError,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Reconectar sesión de DoorDash Merchant o importar reporte oficial CSV/JSON.',
        })
        continue
      }

      if (plat === 'UBER_EATS' && uberSyncError && realPlatOrders.length === 0) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: uberSyncError.includes('no conectada') ? 'NOT_CONNECTED' : 'FAILED',
          cause: uberSyncError,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Reconectar sesión de Uber Eats Manager o importar reporte oficial CSV/JSON.',
        })
        continue
      }

      if (plat === 'GRUBHUB' && grubhubErrorsByStore.has(storeId)) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'FAILED',
          cause: grubhubErrorsByStore.get(storeId)!,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Verificar conexión a la API de Grubhub o reintentar sincronización.',
        })
        continue
      }

      // Verificar si hay paginación truncada
      if (plat === 'DOORDASH' && doordashPartialReason) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'PARTIAL',
          cause: doordashPartialReason,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Acotar el rango de fechas para obtener el 100% de las transacciones sin truncamiento.',
        })
        continue
      }

      if (plat === 'UBER_EATS' && uberPartialReason) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'PARTIAL',
          cause: uberPartialReason,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Acotar el rango de fechas para obtener el 100% de las transacciones sin truncamiento.',
        })
        continue
      }

      // Verificar si algún payout declara órdenes/ventas pero no tiene órdenes vinculadas por payout_reference_id
      const payoutsMissingOrders = storePlatPayouts.filter((p) => {
        const declaredCnt = Number(p.orders_count || 0)
        const declaredSub = Math.abs(Number(p.subtotal_sales || 0))
        if (declaredCnt === 0 && declaredSub < 0.01) return false
        const linkedCnt = realPlatOrders.filter(
          (o) => String(o.payout_reference_id || '').trim() === String(p.payout_reference_id || '').trim()
        ).length
        return linkedCnt === 0
      })

      if (payoutsMissingOrders.length > 0) {
        const missingRefs = payoutsMissingOrders.map((p) => `#${p.payout_reference_id}`).join(', ')
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'PARTIAL',
          cause: `${payoutsMissingOrders.length} corte(s) (${missingRefs}) declaran ventas pero tienen 0 órdenes vinculadas por payout_reference_id.`,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Sincronizar detalle de órdenes del corte o importar CSV/JSON de transacciones antes de publicar QBO.',
        })
        continue
      }

      // Verificar si algún payout o alguna orden de DD/GH carece de tax real verificado
      const unverifiedTaxPayouts = storePlatPayouts.filter((p) => p.raw_payload?.tax_breakdown_verified === false)
      const unverifiedTaxOrders = realPlatOrders.filter((o) => o.raw_payload?.tax_breakdown_verified === false)
      if (unverifiedTaxPayouts.length > 0 || unverifiedTaxOrders.length > 0) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'PARTIAL',
          cause: `Desglose fiscal incompleto o no verificado en ${unverifiedTaxPayouts.length} corte(s) y ${unverifiedTaxOrders.length} orden(es).`,
          timestamp,
          orders_count: realPlatOrders.length,
          payouts_count: storePlatPayouts.length,
          next_action: 'Revisar las órdenes con tax faltante o importar el reporte detallado con columna de impuestos reales.',
        })
        continue
      }

      // Verificar cero inesperado de plataforma cuando Toast POS sí registró órdenes de esa plataforma en el periodo
      if (toastOnlyOrders.length > 0 && realPlatOrders.length === 0) {
        items.push({
          store_id: storeId,
          store_name: storeName,
          platform: plat,
          status: 'PARTIAL',
          cause: `Toast POS registra ${toastOnlyOrders.length} orden(es) de ${plat} en el periodo, pero la plataforma reporta 0 transacciones.`,
          timestamp,
          orders_count: 0,
          payouts_count: storePlatPayouts.length,
          next_action: 'Sincronizar la plataforma o importar el reporte del periodo para conciliar las órdenes de Toast POS.',
        })
        continue
      }

      items.push({
        store_id: storeId,
        store_name: storeName,
        platform: plat,
        status: 'COMPLETE',
        cause:
          storePlatPayouts.length > 0 || realPlatOrders.length > 0
            ? `Cobertura verificada (${storePlatPayouts.length} corte(s), ${realPlatOrders.length} orden(es)).`
            : 'Sin actividad registrada en Toast POS ni en la plataforma durante el periodo.',
        timestamp,
        orders_count: realPlatOrders.length,
        payouts_count: storePlatPayouts.length,
        next_action: 'Listo para revisión operativa.',
      })
    }
  }

  return items
}

/**
 * Motor principal que cruza las órdenes de Toast POS contra las transacciones de las plataformas
 * (Grubhub, DoorDash, Uber Eats) en Supabase y recalcula los totales y varianzas de cada corte.
 */
export async function reconcileAndPersistDeliveryData(params: {
  storeIds: number[]
  startDate: string
  endDate: string
  syncToast?: boolean
  syncGrubhubLive?: boolean
  syncChromePlatforms?: boolean
  targetPlatform?: 'ALL' | DeliveryPlatformCode
  importedPlatformOrders?: PlatformOrderInput[]
  importedPayouts?: Array<Record<string, any>>
}): Promise<{
  toastOrdersSynced: number
  platformOrdersSynced: number
  payoutsSynced: number
  matchedCount: number
  discrepancyCount: number
  unassignedOrdersQuarantined?: number
  unassignedPayoutsQuarantined?: number
  encryptionKeyMissing?: boolean
  syncErrors?: string[]
  platformCoverage?: PlatformStoreCoverageItem[]
  storeProgress?: Array<{
    storeId: number
    storeName: string
    toastOrders: number
    platformOrders: number
    payouts: number
    status: 'COMPLETE' | 'PARTIAL' | 'ERROR'
    errorMessage?: string
  }>
}> {
  const {
    storeIds,
    startDate,
    endDate,
    syncToast = true,
    syncGrubhubLive = true,
    syncChromePlatforms,
    targetPlatform = 'ALL',
    importedPlatformOrders = [],
    importedPayouts = [],
  } = params
  const shouldSyncChromePlatforms =
    syncChromePlatforms !== undefined ? syncChromePlatforms : syncGrubhubLive && targetPlatform !== 'GRUBHUB'

  const allMappings = await getStorePlatformMappings()
  const targetMappings =
    storeIds.length > 0 ? allMappings.filter((m) => storeIds.includes(m.store_id)) : allMappings

  const businessDatesSet = new Set<string>(listBusinessDatesInRange(startDate, endDate))

  let toastOrdersSynced = 0
  let platformOrdersSynced = 0
  let payoutsSynced = 0
  const storeProgress: Array<{
    storeId: number
    storeName: string
    toastOrders: number
    platformOrders: number
    payouts: number
    status: 'COMPLETE' | 'PARTIAL' | 'ERROR'
    errorMessage?: string
  }> = []

  // Si es una sincronización en vivo (sin archivo manual), extraer también DoorDash y Uber Eats desde Chrome DevTools o sesión cifrada
  let chromeOrders: PlatformOrderInput[] = []
  let chromePayouts: Array<Record<string, any>> = []
  let encryptionKeyMissing = false
  let uberSyncError: string | undefined
  let doordashSyncError: string | undefined
  let uberPartialReason: string | undefined
  let doordashPartialReason: string | undefined
  const grubhubErrorsByStore = new Map<number, string>()

  if (shouldSyncChromePlatforms && importedPlatformOrders.length === 0) {
    const liveChrome = await fetchChromeLiveDoorDashAndUberForStores(
      targetMappings,
      allMappings,
      startDate,
      endDate,
      targetPlatform
    )
    chromeOrders = liveChrome.orders
    chromePayouts = liveChrome.payouts
    encryptionKeyMissing = liveChrome.encryptionKeyMissing
    uberSyncError = liveChrome.uberError
    doordashSyncError = liveChrome.doordashError
    uberPartialReason = liveChrome.uberPartialReason
    doordashPartialReason = liveChrome.doordashPartialReason
    for (const extraD of liveChrome.extraBusinessDates) {
      businessDatesSet.add(extraD)
    }
  }

  const businessDates = Array.from(businessDatesSet).sort()

  const allImportedOrders = [...importedPlatformOrders, ...chromeOrders]
  const allImportedPayouts = [...importedPayouts, ...chromePayouts]

  // Separar registros con sucursal desconocida (`store_id = 0` / `UNASSIGNED_STORE`) para cuarentena segura
  const unassignedOrders = allImportedOrders.filter((o) => !o.storeId || o.storeId === 0)
  const unassignedPayouts = allImportedPayouts.filter((p) => !p.store_id || Number(p.store_id) === 0)
  if (unassignedOrders.length > 0 || unassignedPayouts.length > 0) {
    await saveQuarantinedUnassignedRecords(unassignedOrders, unassignedPayouts)
  }

  const validImportedPayouts = allImportedPayouts.filter((p) => Number(p.store_id) > 0)

  const mergeExistingPayoutMetadata = async (payoutRows: Array<Record<string, any>>) => {
    if (payoutRows.length === 0) return payoutRows
    const refs = Array.from(
      new Set(payoutRows.map((p) => String(p.payout_reference_id || '').trim()).filter(Boolean))
    )
    if (refs.length === 0) return payoutRows
    const { data: existingPayouts } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .select(
        'store_id, platform, payout_reference_id, status, orders_count, toast_matched_orders_count, toast_net_sales, toast_tax_amount, toast_expected_gross, gross_variance, raw_payload'
      )
      .in('payout_reference_id', refs)
    const existingByKey = new Map<string, Record<string, any>>()
    for (const ep of existingPayouts || []) {
      existingByKey.set(`${ep.platform}:${ep.store_id}:${ep.payout_reference_id}`, ep)
    }
    const preservedKeys = [
      'qb_journal_entry_id',
      'qb_doc_number',
      'qb_txn_date',
      'qb_published_at',
      'qb_idempotency_key',
      'qb_publish_status',
      'qb_publish_lock_at',
      'qbo_candidate_confirmation',
      'qbo_discarded_candidates',
      'qbo_shared_je_approved',
      'variance_approval',
      'cross_payout_refunds',
      'bank_feed_confirmed',
      'bank_feed_deposit_id',
      'bank_feed_confirmed_date',
    ]
    return payoutRows.map((p) => {
      const ex = existingByKey.get(`${p.platform}:${p.store_id}:${p.payout_reference_id}`)
      if (!ex) return p
      const exRp = ex.raw_payload || {}
      const mergedRp: Record<string, any> = { ...(p.raw_payload || {}) }
      for (const k of preservedKeys) {
        if (exRp[k] !== undefined && mergedRp[k] === undefined) {
          mergedRp[k] = exRp[k]
        }
      }
      return {
        ...p,
        orders_count: Number(p.orders_count || 0) > 0 ? p.orders_count : Number(ex.orders_count || 0),
        toast_matched_orders_count:
          Number(p.toast_matched_orders_count || 0) > 0
            ? p.toast_matched_orders_count
            : Number(ex.toast_matched_orders_count || 0),
        toast_net_sales:
          Number(p.toast_net_sales || 0) > 0 ? p.toast_net_sales : Number(ex.toast_net_sales || 0),
        toast_tax_amount:
          Number(p.toast_tax_amount || 0) > 0 ? p.toast_tax_amount : Number(ex.toast_tax_amount || 0),
        toast_expected_gross:
          Number(p.toast_expected_gross || 0) > 0
            ? p.toast_expected_gross
            : Number(ex.toast_expected_gross || 0),
        gross_variance:
          Number(p.toast_expected_gross || 0) > 0
            ? p.gross_variance
            : Number(ex.gross_variance || 0),
        status: exRp.qb_journal_entry_id ? 'RECONCILED' : p.status,
        raw_payload: mergedRp,
      }
    })
  }

  // 1. Si hay cortes importados o extraídos en vivo con tienda válida, deduplicar por `platform + store_id + payout_reference_id`
  // NUNCA borrar cortes de otra sucursal por compartir `payout_reference_id`.
  if (validImportedPayouts.length > 0) {
    const dedupedPayouts = await mergeExistingPayoutMetadata(
      deduplicatePayoutRecords(validImportedPayouts)
    )

    // Si un corte de Uber Eats guardado previamente con `settlementUUID` (cuando estaba PENDING sin `transactionID`)
    // ya fue liquidado (`SETTLED`) y ahora trae su `transactionID` oficial, migrar el borrador (si no tiene póliza QBO)
    // para evitar duplicar el mismo corte con dos referencias distintas.
    for (const dp of dedupedPayouts) {
      const settlementUuid = String(dp.raw_payload?.settlementUUID || '').trim()
      if (
        dp.platform === 'UBER_EATS' &&
        settlementUuid &&
        dp.payout_reference_id &&
        dp.payout_reference_id !== settlementUuid
      ) {
        const { data: oldDraft } = await supabaseAdmin
          .from('delivery_platform_payouts')
          .select('id, raw_payload')
          .eq('store_id', dp.store_id)
          .eq('platform', 'UBER_EATS')
          .eq('payout_reference_id', settlementUuid)
          .maybeSingle()

        if (oldDraft && !oldDraft.raw_payload?.qb_journal_entry_id) {
          await supabaseAdmin
            .from('delivery_platform_orders')
            .update({
              payout_reference_id: dp.payout_reference_id,
              payout_date: dp.payout_date || null,
              updated_at: new Date().toISOString(),
            })
            .eq('store_id', dp.store_id)
            .eq('platform', 'UBER_EATS')
            .eq('payout_reference_id', settlementUuid)

          await supabaseAdmin
            .from('delivery_platform_payouts')
            .delete()
            .eq('id', oldDraft.id)
        }
      }
    }

    const { error: impPayErr } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .upsert(dedupedPayouts, { onConflict: 'store_id,platform,payout_reference_id' })
    if (impPayErr) {
      throw new Error(`Error upserting imported payouts: ${impPayErr.message}`)
    }
    payoutsSynced += dedupedPayouts.length
  }

  for (const mapping of targetMappings) {
    let storeErrorMsg: string | undefined
    let storeGhPayoutsCnt = 0
    // 2. Sincronizar Grubhub en vivo si está activo
    let liveGhOrders: PlatformOrderInput[] = []
    if (syncGrubhubLive && mapping.grubhub_cust_id) {
      try {
        const ghData = await fetchGrubhubLiveAccountingForStore(mapping, startDate, endDate)
        liveGhOrders = ghData.orders
        if (ghData.payouts.length > 0) {
          const dedupGhPayouts = await mergeExistingPayoutMetadata(
            deduplicatePayoutRecords(ghData.payouts)
          )
          const { error: ghPayErr } = await supabaseAdmin
            .from('delivery_platform_payouts')
            .upsert(dedupGhPayouts, { onConflict: 'store_id,platform,payout_reference_id' })
          if (ghPayErr) {
            storeErrorMsg = `Grubhub payouts upsert error: ${ghPayErr.message}`
            grubhubErrorsByStore.set(mapping.store_id, storeErrorMsg)
            console.error(`Error saving Grubhub payouts for store ${mapping.store_id}:`, ghPayErr.message)
          } else {
            payoutsSynced += dedupGhPayouts.length
            storeGhPayoutsCnt = dedupGhPayouts.length
          }
        }
      } catch (err: any) {
        storeErrorMsg = `Grubhub live sync error: ${err.message}`
        grubhubErrorsByStore.set(mapping.store_id, storeErrorMsg)
        console.error(`Grubhub live sync warning for store ${mapping.store_id}:`, err.message)
      }
    }

    // Combinar órdenes de plataforma (Grubhub en vivo + DoorDash/Uber en vivo + importadas para esta tienda)
    const storeImportedOrders = allImportedOrders.filter((o) => o.storeId === mapping.store_id)
    const combinedPlatformInputs = [...liveGhOrders, ...storeImportedOrders].filter((inp) => {
      if (importedPlatformOrders.length > 0) return true
      return Boolean(inp.businessDate && inp.businessDate >= startDate && inp.businessDate <= endDate)
    })

    // En sincronización en vivo se respeta estrictamente el rango filtrado `[startDate, endDate]` sin arrastrar semanas históricas
    const storeBusinessDatesSet = new Set<string>(businessDates)
    if (importedPlatformOrders.length > 0) {
      for (const inp of combinedPlatformInputs) {
        if (inp.businessDate) storeBusinessDatesSet.add(inp.businessDate)
      }
    }
    const storeBusinessDates = Array.from(storeBusinessDatesSet).sort()

    // Leer todas las órdenes de plataforma que ya estaban guardadas en DB para esta tienda y fechas (con paginación)
    const existingDbOrders = await fetchAllSupabaseRows<Record<string, any>>((from, to) =>
      supabaseAdmin
        .from('delivery_platform_orders')
        .select('*')
        .eq('store_id', mapping.store_id)
        .in('business_date', storeBusinessDates)
        .order('business_date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    )

    const platformMap = new Map<string, PlatformOrderInput>()
    const existingManualByTxKey = new Map<string, Record<string, any>>()

    for (const row of existingDbOrders || []) {
      const txKey = `${row.platform}:${row.platform_transaction_id}`
      existingManualByTxKey.set(txKey, row)

      // Solo preservar registros que provenían de plataforma (no los TOAST_ONLY sintéticos)
      if (row.match_confidence !== 'TOAST_ONLY') {
        const cleanPrevRef =
          row.payout_reference_id && String(row.payout_reference_id).trim() !== '--'
            ? row.payout_reference_id
            : null
        let restoredBusinessDate = row.business_date
        let restoredPlacedAt = row.placed_at
        if (
          row.platform === 'DOORDASH' &&
          isCreditOnlyRecoveryRow(row) &&
          Array.isArray(row.raw_payload?.cells)
        ) {
          const cellDate = row.raw_payload.cells.find((c: any) => c && c.name === 2)?.value
          const cellTime = row.raw_payload.cells.find((c: any) => c && c.name === 3)?.value
          if (cellDate) {
            const parsedCellDt = parseLocalLaDateTime(String(cellDate), String(cellTime || ''))
            if (parsedCellDt.businessDate) restoredBusinessDate = parsedCellDt.businessDate
            if (parsedCellDt.placedIso) restoredPlacedAt = parsedCellDt.placedIso
          }
        }
        platformMap.set(txKey, {
          storeId: row.store_id,
          platform: row.platform as DeliveryPlatformCode,
          businessDate: restoredBusinessDate,
          placedAt: restoredPlacedAt,
          platformOrderId: row.platform_order_id,
          platformTransactionId: row.platform_transaction_id,
          payoutReferenceId: cleanPrevRef,
          payoutDate: row.payout_date,
          fulfillmentType: row.fulfillment_type || 'DELIVERY',
          transactionType: row.transaction_type || 'ORDER',
          platformSubtotal: Number(row.platform_subtotal || 0),
          platformTax: Number(row.platform_tax || 0),
          platformTaxWithheld: Number(row.platform_tax_withheld || 0),
          platformTaxPaidToMerchant: Number(row.platform_tax_paid_to_merchant || 0),
          platformGrossReceivable: Number(row.platform_gross_receivable || 0),
          commissionFee: Number(row.commission_fee || 0),
          deliveryFee: Number(row.delivery_fee || 0),
          processingFee: Number(row.processing_fee || 0),
          marketingFee: Number(row.marketing_fee || 0),
          errorCharge: Number(row.error_charge || 0),
          adjustmentAmount: Number(row.adjustment_amount || 0),
          tipAmount: Number(row.tip_amount || 0),
          netPayout: Number(row.net_payout || 0),
          taxBreakdownVerified: row.raw_payload?.tax_breakdown_verified !== false,
          unverifiedReason: row.raw_payload?.unverified_reason || null,
          disputeReason: row.dispute_reason,
          itemsSummary: row.items_summary || [],
          rawPayload: row.raw_payload || {},
        })
      }
    }

    // Defecto 5: las filas individuales de Grubhub (reembolsos / créditos) absorbidas por una orden consolidada
    // NO se eliminan aquí. Se fusionan sus campos manuales en la fila consolidada y solo se borran DESPUÉS de
    // confirmar en DB que el reemplazo se guardó (`persistReconciledOrdersWithSafeConsolidation`).
    const supersededByConsolidatedTxId = new Map<string, string[]>()
    const pendingSupersededLookups: string[] = []
    for (const inp of combinedPlatformInputs) {
      const txKey = `${inp.platform}:${inp.platformTransactionId}`
      const prev = platformMap.get(txKey)
      if (prev) {
        if ((!inp.payoutReferenceId || inp.payoutReferenceId === '--') && prev.payoutReferenceId && prev.payoutReferenceId !== '--') {
          inp.payoutReferenceId = prev.payoutReferenceId
          inp.payoutDate = prev.payoutDate
        }
        // Conservar campos históricos de recuperación solo si la sincronización actual no trae un crédito nuevo
        if (prev.rawPayload?.reimbursement_payout_ref && !inp.rawPayload?.reimbursement_payout_ref) {
          inp.rawPayload = {
            ...(inp.rawPayload || {}),
            reimbursement_payout_ref: prev.rawPayload.reimbursement_payout_ref,
            reimbursement_period: prev.rawPayload.reimbursement_period,
            reimbursement_deposit_date: prev.rawPayload.reimbursement_deposit_date,
            reimbursement_amount: prev.rawPayload.reimbursement_amount,
            reimbursement_description: prev.rawPayload.reimbursement_description,
          }
        }
      }
      if (inp.platform === 'GRUBHUB') {
        const absorbedTxIds = collectGrubhubSupersededTxIds(inp)
        if (absorbedTxIds.length > 0) {
          supersededByConsolidatedTxId.set(inp.platformTransactionId, absorbedTxIds)
          for (const rTxId of absorbedTxIds) {
            const orphanKey = `GRUBHUB:${rTxId}`
            platformMap.delete(orphanKey)
            if (!existingManualByTxKey.has(orphanKey)) pendingSupersededLookups.push(rTxId)
          }
        }
      }
      platformMap.set(txKey, inp)
    }

    // Filas absorbidas fuera del rango de fechas cargado: leerlas por ID para preservar su información antes de limpiar
    if (pendingSupersededLookups.length > 0) {
      for (let i = 0; i < pendingSupersededLookups.length; i += 100) {
        const chunk = pendingSupersededLookups.slice(i, i + 100)
        const { data: extraRows, error: extraErr } = await supabaseAdmin
          .from('delivery_platform_orders')
          .select('*')
          .eq('store_id', mapping.store_id)
          .eq('platform', 'GRUBHUB')
          .in('platform_transaction_id', chunk)
        if (extraErr) {
          throw new Error(`Error leyendo filas Grubhub a consolidar: ${extraErr.message}`)
        }
        for (const er of extraRows || []) {
          existingManualByTxKey.set(`GRUBHUB:${er.platform_transaction_id}`, er)
        }
      }
    }

    // Fusionar notas, aprobaciones, vínculos Toast, disputas, evidencia y créditos de las filas absorbidas
    const supersededExistingByConsolidated = new Map<string, string[]>()
    for (const [consolidatedTxId, absorbedTxIds] of supersededByConsolidatedTxId.entries()) {
      const consolidatedKey = `GRUBHUB:${consolidatedTxId}`
      const absorbedRows = absorbedTxIds
        .map((id) => existingManualByTxKey.get(`GRUBHUB:${id}`))
        .filter((r): r is Record<string, any> => Boolean(r))
      if (absorbedRows.length === 0) continue
      existingManualByTxKey.set(
        consolidatedKey,
        mergeSupersededOrderRows(existingManualByTxKey.get(consolidatedKey), absorbedRows)
      )
      supersededExistingByConsolidated.set(
        consolidatedTxId,
        absorbedRows.map((r) => String(r.platform_transaction_id))
      )
    }

    const storePlatformOrders = Array.from(platformMap.values())
    platformOrdersSynced += combinedPlatformInputs.length

    // 3. Obtener órdenes de Toast POS para esta tienda y fechas (reutilizando caché en DB para días pasados ya sincronizados)
    let toastOrders: ToastDeliveryOrderRecord[] = []
    const reconstructCachedToastOrdersForDates = (targetDatesSet: Set<string>): ToastDeliveryOrderRecord[] => {
      const cachedList: ToastDeliveryOrderRecord[] = []
      const seenGuids = new Set<string>()
      for (const row of existingDbOrders || []) {
        if (
          row.toast_order_guid &&
          !seenGuids.has(row.toast_order_guid) &&
          row.business_date &&
          targetDatesSet.has(String(row.business_date))
        ) {
          seenGuids.add(row.toast_order_guid)
          const parsedTabId = parseToastTabPlatformOrderId(
            row.platform as DeliveryPlatformCode,
            row.toast_tab_name || ''
          )
          cachedList.push({
            storeId: row.store_id,
            toastOrderGuid: row.toast_order_guid,
            toastDisplayNumber: String(row.toast_display_number || ''),
            toastTabName: row.toast_tab_name || '',
            extractedPlatformId:
              parsedTabId ||
              (row.match_confidence === 'EXACT_ID' ? row.platform_order_id || null : null),
            platform: row.platform as DeliveryPlatformCode,
            fulfillmentType: row.fulfillment_type || 'DELIVERY',
            businessDate: row.business_date,
            openedAt: row.toast_opened_at || row.placed_at || `${row.business_date}T18:00:00Z`,
            diningOptionName: row.toast_dining_option || row.platform,
            netSales: Number(row.toast_net_sales || 0),
            taxAmount: Number(row.toast_tax || 0),
            expectedGross: Number(row.toast_expected_gross || 0),
            isVoidedInToast: Boolean(row.raw_payload?.toast_voided),
            voidedOriginalSubtotal: Number(row.raw_payload?.toast_voided_original_subtotal || 0),
            voidDate: row.raw_payload?.toast_void_date || null,
            itemsSummary: row.items_summary || [],
          })
        }
      }
      return cachedList
    }

    if (syncToast) {
      try {
        const todayLa = toOperationalBusinessDate(new Date().toISOString())
        const existingToastCountByDate = new Map<string, number>()
        for (const row of existingDbOrders || []) {
          if (row.toast_order_guid && row.business_date) {
            const dStr = String(row.business_date)
            existingToastCountByDate.set(dStr, (existingToastCountByDate.get(dStr) || 0) + 1)
          }
        }
        const datesWithUnlinkedPlatformOrder = new Set<string>()
        for (const pOrd of storePlatformOrders) {
          if (!pOrd.businessDate) continue
          if (Number(pOrd.platformSubtotal || 0) <= 0 && Number(pOrd.platformGrossReceivable || 0) <= 0) continue
          const exRow = existingManualByTxKey.get(`${pOrd.platform}:${pOrd.platformTransactionId}`)
          if (!exRow?.toast_order_guid && exRow?.raw_payload?.toast_live_checked_date !== pOrd.businessDate) {
            datesWithUnlinkedPlatformOrder.add(pOrd.businessDate)
          }
        }
        const reusableDatesSet = new Set<string>()
        const liveToastDates: string[] = []
        for (const bDate of storeBusinessDates) {
          // Días pasados (< todayLa) que ya tienen órdenes de Toast en DB y ninguna orden de plataforma sin vínculo pendiente de verificar anulados (VOID) se reutilizan al instante
          if (
            bDate < todayLa &&
            (existingToastCountByDate.get(bDate) || 0) > 0 &&
            !datesWithUnlinkedPlatformOrder.has(bDate)
          ) {
            reusableDatesSet.add(bDate)
          } else {
            liveToastDates.push(bDate)
          }
        }
        const cachedToastOrders = reconstructCachedToastOrdersForDates(reusableDatesSet)
        const liveFetchedToastOrders =
          liveToastDates.length > 0
            ? await fetchToastDeliveryOrdersForStoreAndDates(mapping, liveToastDates)
            : []
        if (liveToastDates.length > 0) {
          const liveDatesLookup = new Set(liveToastDates)
          for (const pOrd of storePlatformOrders) {
            if (pOrd.businessDate && liveDatesLookup.has(pOrd.businessDate)) {
              pOrd.rawPayload = {
                ...(pOrd.rawPayload || {}),
                toast_live_checked_date: pOrd.businessDate,
              }
            }
          }
        }
        toastOrders = [...cachedToastOrders, ...liveFetchedToastOrders]
        toastOrdersSynced += toastOrders.length
      } catch (tErr: any) {
        storeErrorMsg = storeErrorMsg
          ? `${storeErrorMsg}; Toast error: ${tErr.message}`
          : `Toast error: ${tErr.message}`
      }
    } else {
      toastOrders = reconstructCachedToastOrdersForDates(new Set(storeBusinessDates))
    }

    // Consultar evidencia de empaque (delivery_packing_audits) con paginación
    const packingAudits = await fetchAllSupabaseRows<{ id: string; toast_order_guid: string }>((from, to) =>
      supabaseAdmin
        .from('delivery_packing_audits')
        .select('id, toast_order_guid')
        .eq('store_id', mapping.store_id)
        .range(from, to)
    )
    const auditByToastGuid = new Map<string, string>()
    for (const pa of packingAudits || []) {
      if (pa.toast_order_guid && pa.id) {
        auditByToastGuid.set(pa.toast_order_guid, pa.id)
      }
    }

    // 4. Cruzar Toast Orders vs Platform Orders con reglas estrictas (sin auto-match difuso ni elección ciega de ambiguos)
    const { rowsToUpsert, matchedToastGuids } = matchPlatformAndToastOrdersForStore(
      storePlatformOrders,
      toastOrders,
      auditByToastGuid,
      existingManualByTxKey
    )

    // Defecto 5: guardar primero; limpiar filas absorbidas y sintéticas TOAST-<guid> solo tras confirmar el reemplazo en DB
    const persistResult = await persistReconciledOrdersWithSafeConsolidation({
      db: supabaseAdmin,
      storeId: mapping.store_id,
      rowsToUpsert,
      supersededByConsolidatedTxId: supersededExistingByConsolidated,
      synthToastTxIdsToDelete: Array.from(matchedToastGuids).map((g) => `TOAST-${g}`),
    })
    if (persistResult.warnings.length > 0) {
      const warnMsg = `Consolidación Grubhub parcial: ${persistResult.warnings.join(' | ')}`
      storeErrorMsg = storeErrorMsg ? `${storeErrorMsg}; ${warnMsg}` : warnMsg
    }

    // 7. Actualizar los totales conciliados de Toast en `delivery_platform_payouts` y vincular reembolsos en cortes posteriores (`cross_payout_refunds`)
    const minPayoutPeriod = addDaysToDateStr(startDate, -28)
    const maxPayoutPeriod = addDaysToDateStr(endDate, 21)
    const storePayouts = await fetchAllSupabaseRows<Record<string, any>>((from, to) =>
      supabaseAdmin
        .from('delivery_platform_payouts')
        .select(
          'id, platform, payout_reference_id, period_start, period_end, payout_date, subtotal_sales, tax_collected, tax_paid_to_merchant, platform_gross_receivable, status, raw_payload'
        )
        .eq('store_id', mapping.store_id)
        .gte('period_end', minPayoutPeriod)
        .lte('period_start', maxPayoutPeriod)
        .range(from, to)
    )

    // Enriquecer `cross_payout_refunds` en cortes DoorDash existentes a partir de filas `ADJUSTMENT` de crédito ($0 subtotal, ajuste positivo)
    for (const sp of storePayouts || []) {
      if (
        sp.platform === 'DOORDASH' &&
        sp.payout_reference_id &&
        !Array.isArray(sp.raw_payload?.cross_payout_refunds)
      ) {
        const { data: creditAdjRows } = await supabaseAdmin
          .from('delivery_platform_orders')
          .select('platform_order_id, platform_transaction_id, business_date, platform_subtotal, error_charge, adjustment_amount, transaction_type, dispute_reason')
          .eq('store_id', mapping.store_id)
          .eq('platform', 'DOORDASH')
          .eq('payout_reference_id', sp.payout_reference_id)
          .eq('transaction_type', 'ADJUSTMENT')
          .gt('adjustment_amount', 0)
        const derivedCredits = (creditAdjRows || [])
          .filter((cr: any) => isCreditOnlyRecoveryRow(cr) && String(cr.platform_order_id || '').trim().length >= 4)
          .map((cr: any) => ({
            orderCode: String(cr.platform_order_id).trim(),
            transactionId: cr.platform_transaction_id ? String(cr.platform_transaction_id).trim() : null,
            payoutRef: String(sp.payout_reference_id).trim(),
            depositDate: sp.payout_date || cr.business_date || null,
            amount: round2(Number(cr.adjustment_amount || 0)),
            description: cr.dispute_reason || 'DoorDash Credit / Dispute Recovery',
          }))
        if (derivedCredits.length > 0) {
          sp.raw_payload = {
            ...(sp.raw_payload || {}),
            cross_payout_refunds: derivedCredits,
          }
          await supabaseAdmin
            .from('delivery_platform_payouts')
            .update({ raw_payload: sp.raw_payload, updated_at: new Date().toISOString() })
            .eq('id', sp.id)
        }
      }
    }

    // Defectos 1, 2 y 4: vincular créditos de recuperación de cortes posteriores al libro `recovery_credits`
    // (idempotente por credit_id, verificado contra el settlement, sin sobrescribir el importe original disputado)
    await linkCrossPayoutRecoveryCreditsForStore({
      db: supabaseAdmin,
      storeId: mapping.store_id,
      storePayouts: storePayouts || [],
    })

    const recalcLookbackStart = addDaysToDateStr(startDate, -14)
    const activePayoutsToRecalc = (storePayouts || []).filter((p) => {
      const pStart = String(p.period_start || p.payout_date || '')
      const pEnd = String(p.period_end || p.payout_date || '')
      if (!pStart || !pEnd) return true
      return pStart <= endDate && pEnd >= recalcLookbackStart
    })

    await Promise.all(
      activePayoutsToRecalc.map(async (payout) => {
        // Vincular órdenes reales de la plataforma (`UBER_EATS`, `DOORDASH`, `GRUBHUB`) dentro del `[period_start, period_end]`
        // cuando existe un único corte oficial de esa plataforma para esa tienda y periodo y la orden aún tenía `payout_reference_id` nulo.
        if (payout.platform && payout.period_start && payout.period_end && payout.payout_reference_id) {
          const overlappingSamePlatformPayouts = (storePayouts || []).filter(
            (sp) =>
              sp.platform === payout.platform &&
              sp.period_start &&
              sp.period_end &&
              sp.period_start <= payout.period_end &&
              sp.period_end >= payout.period_start
          )
          if (overlappingSamePlatformPayouts.length === 1) {
            const { data: unlinkedCandidates } = await supabaseAdmin
              .from('delivery_platform_orders')
              .select('id, raw_payload')
              .eq('store_id', mapping.store_id)
              .eq('platform', payout.platform)
              .neq('match_confidence', 'TOAST_ONLY')
              .is('payout_reference_id', null)
              .gte('business_date', payout.period_start)
              .lte('business_date', payout.period_end)
            const linkableRows = (unlinkedCandidates || []).filter((row: any) =>
              payout.platform === 'UBER_EATS' ? true : !row?.raw_payload?.pending_next_payout
            )
            if (linkableRows.length > 0) {
              const directIds = linkableRows
                .filter((row: any) => !row?.raw_payload?.pending_next_payout)
                .map((row: any) => row.id)
              if (directIds.length > 0) {
                await supabaseAdmin
                  .from('delivery_platform_orders')
                  .update({
                    payout_reference_id: payout.payout_reference_id,
                    payout_date: payout.payout_date || null,
                    updated_at: new Date().toISOString(),
                  })
                  .in('id', directIds)
              }
              const clearFlagRows = linkableRows.filter((row: any) => Boolean(row?.raw_payload?.pending_next_payout))
              if (clearFlagRows.length > 0) {
                await Promise.all(
                  clearFlagRows.map(async (row: any) => {
                    const cleanedRp = { ...(row.raw_payload || {}) }
                    delete cleanedRp.pending_next_payout
                    await supabaseAdmin
                      .from('delivery_platform_orders')
                      .update({
                        payout_reference_id: payout.payout_reference_id,
                        payout_date: payout.payout_date || null,
                        raw_payload: cleanedRp,
                        updated_at: new Date().toISOString(),
                      })
                      .eq('id', row.id)
                  })
                )
              }
            }
          }
        }

        // P0-5: Prohibido agregar órdenes a un payout solo por caer dentro del rango de fechas si no existe vínculo verificable (`payout_reference_id`).
        const payoutOrders = await fetchAllSupabaseRows<Record<string, any>>((from, to) =>
          supabaseAdmin
            .from('delivery_platform_orders')
            .select(
              'toast_net_sales, toast_tax, toast_expected_gross, toast_order_guid, payout_reference_id, business_date, platform_subtotal, platform_tax, platform_tax_paid_to_merchant, platform_gross_receivable, reconciliation_status, match_confidence, raw_payload'
            )
            .eq('store_id', mapping.store_id)
            .eq('platform', payout.platform)
            .eq('payout_reference_id', payout.payout_reference_id)
            .range(from, to)
        )

        if (payoutOrders && payoutOrders.length > 0) {
          let tNet = 0
          let tTax = 0
          let tExp = 0
          let pSub = 0
          let pTax = 0
          let pTaxMerch = 0
          let pGross = 0
          let matchedCnt = 0
          let hasUnresolvedOrder = false
          let allOrdersTaxVerified = true
          let minTxDate: string | null = null
          let maxTxDate: string | null = null

          for (const po of payoutOrders) {
            if (po.toast_order_guid && po.match_confidence === 'EXACT_ID') matchedCnt++
            if (po.reconciliation_status !== 'MATCHED') {
              hasUnresolvedOrder = true
            }
            if (po.raw_payload?.tax_breakdown_verified === false) {
              allOrdersTaxVerified = false
            }
            tNet += Number(po.toast_net_sales || 0)
            tTax += Number(po.toast_tax || 0)
            tExp += Number(po.toast_expected_gross || 0)
            pSub += Number(po.platform_subtotal || 0)
            pTax += Number(po.platform_tax || 0)
            pTaxMerch += Number(po.platform_tax_paid_to_merchant || 0)
            pGross += Number(po.platform_gross_receivable || 0)
            if (po.business_date) {
              if (!minTxDate || po.business_date < minTxDate) minTxDate = po.business_date
              if (!maxTxDate || po.business_date > maxTxDate) maxTxDate = po.business_date
            }
          }
          tNet = round2(tNet)
          tTax = round2(tTax)
          tExp = round2(tExp)
          pSub = round2(pSub)
          pTax = round2(pTax)
          pTaxMerch = round2(pTaxMerch)
          pGross = round2(pGross)

          const updatePayload: Record<string, any> = {
            toast_matched_orders_count: matchedCnt,
            toast_net_sales: tNet,
            toast_tax_amount: tTax,
            toast_expected_gross: tExp,
            updated_at: new Date().toISOString(),
          }

          let effectivePlatformGross = Number(payout.platform_gross_receivable || 0)
          if (payout.platform === 'DOORDASH' && pSub > 0) {
            updatePayload.subtotal_sales = pSub
            updatePayload.tax_collected = pTax
            updatePayload.tax_paid_to_merchant = pTaxMerch
            updatePayload.orders_count = payoutOrders.length
            if (payout.period_start === payout.period_end) {
              if (minTxDate) updatePayload.period_start = minTxDate
              if (maxTxDate) updatePayload.period_end = maxTxDate
            }
            // P1-11: Un payout solo puede ser tax_breakdown_verified = true si TODAS sus órdenes tienen tax verificado
            updatePayload.raw_payload = {
              ...(payout.raw_payload || {}),
              tax_breakdown_verified: allOrdersTaxVerified,
              period_verified: true,
              unverified_reason: allOrdersTaxVerified ? null : 'PAYOUT_CONTAINS_ORDER_WITHOUT_ATOMIC_TAX',
            }
            effectivePlatformGross = pGross > 0 ? pGross : effectivePlatformGross
          } else if (!allOrdersTaxVerified) {
            // P1-11: Si cualquier orden de Grubhub/Uber/DoorDash carece de desglose fiscal verificado, marcar el payout como no verificado
            updatePayload.raw_payload = {
              ...(payout.raw_payload || {}),
              tax_breakdown_verified: false,
              unverified_reason: 'PAYOUT_CONTAINS_ORDER_WITHOUT_ATOMIC_TAX',
            }
          }

          const grossVar = round2(effectivePlatformGross - tExp)
          updatePayload.gross_variance = grossVar

          const taxBreakdownVerified =
            allOrdersTaxVerified &&
            (updatePayload.raw_payload?.tax_breakdown_verified ??
              payout.raw_payload?.tax_breakdown_verified ??
              true)

          if (!payout.raw_payload?.qb_journal_entry_id) {
            if (!taxBreakdownVerified) {
              updatePayload.status = 'REQUIRES_REVIEW'
            } else if (Math.abs(grossVar) <= 0.05 && matchedCnt > 0 && !hasUnresolvedOrder) {
              updatePayload.status = 'RECONCILED'
            } else {
              updatePayload.status = 'POSTED'
            }
          }

          await supabaseAdmin
            .from('delivery_platform_payouts')
            .update(updatePayload)
            .eq('id', payout.id)
        }
      })
    )

    const platErrParts: string[] = []
    if ((targetPlatform === 'ALL' || targetPlatform === 'DOORDASH') && mapping.doordash_store_id && doordashSyncError) {
      platErrParts.push(doordashSyncError)
    }
    if ((targetPlatform === 'ALL' || targetPlatform === 'UBER_EATS') && mapping.ubereats_store_uuid && uberSyncError) {
      platErrParts.push(uberSyncError)
    }
    const combinedStoreErr = [storeErrorMsg, ...platErrParts].filter(Boolean).join(' | ')

    storeProgress.push({
      storeId: mapping.store_id,
      storeName: mapping.store_name,
      toastOrders: toastOrders.length,
      platformOrders: storePlatformOrders.length,
      payouts: (storePayouts || []).length + storeGhPayoutsCnt,
      status: combinedStoreErr || encryptionKeyMissing ? 'PARTIAL' : 'COMPLETE',
      errorMessage:
        combinedStoreErr ||
        (encryptionKeyMissing ? 'INTEGRATION_ENCRYPTION_KEY no configurada para sesiones DD/Uber.' : undefined),
    })
  }

  // Contar resultados finales y construir matriz de cobertura por tienda/plataforma
  const targetStoreIds = targetMappings.map((m) => m.store_id)
  const finalOrders =
    targetStoreIds.length > 0
      ? await fetchAllSupabaseRows<Record<string, any>>((from, to) =>
          supabaseAdmin
            .from('delivery_platform_orders')
            .select(
              'store_id, platform, payout_reference_id, reconciliation_status, match_confidence, raw_payload'
            )
            .in('store_id', targetStoreIds)
            .in('business_date', businessDates)
            .range(from, to)
        )
      : []

  const finalPayouts =
    targetStoreIds.length > 0
      ? await fetchAllSupabaseRows<Record<string, any>>((from, to) =>
          supabaseAdmin
            .from('delivery_platform_payouts')
            .select('store_id, platform, payout_reference_id, orders_count, subtotal_sales, status, raw_payload')
            .in('store_id', targetStoreIds)
            .lte('period_start', endDate)
            .gte('period_end', startDate)
            .range(from, to)
        )
      : []

  let matchedCount = 0
  let discrepancyCount = 0
  for (const r of finalOrders || []) {
    if (r.reconciliation_status === 'MATCHED') matchedCount++
    else discrepancyCount++
  }

  const platformCoverage = buildStorePlatformCoverageMatrix({
    mappings: targetMappings,
    orders: finalOrders || [],
    payouts: finalPayouts || [],
    encryptionKeyConfigured: !encryptionKeyMissing,
    uberSyncError,
    doordashSyncError,
    uberPartialReason,
    doordashPartialReason,
    grubhubErrorsByStore,
  })

  const syncErrorsSet = new Set<string>()
  if (encryptionKeyMissing) {
    syncErrorsSet.add('INTEGRATION_ENCRYPTION_KEY no está configurada en el servidor para sesiones DD/Uber.')
  }
  if ((targetPlatform === 'ALL' || targetPlatform === 'DOORDASH') && doordashSyncError) {
    syncErrorsSet.add(doordashSyncError)
  }
  if ((targetPlatform === 'ALL' || targetPlatform === 'UBER_EATS') && uberSyncError) {
    syncErrorsSet.add(uberSyncError)
  }
  if (doordashPartialReason) syncErrorsSet.add(doordashPartialReason)
  if (uberPartialReason) syncErrorsSet.add(uberPartialReason)
  for (const [, ghErr] of grubhubErrorsByStore.entries()) {
    if (ghErr) syncErrorsSet.add(ghErr)
  }

  return {
    toastOrdersSynced,
    platformOrdersSynced,
    payoutsSynced,
    matchedCount,
    discrepancyCount,
    unassignedOrdersQuarantined: unassignedOrders.length,
    unassignedPayoutsQuarantined: unassignedPayouts.length,
    encryptionKeyMissing,
    syncErrors: Array.from(syncErrorsSet),
    platformCoverage,
    storeProgress,
  }
}

export function buildReconciledOrderRow(
  pOrd: PlatformOrderInput,
  tOrd: ToastDeliveryOrderRecord | null,
  confidence: MatchConfidenceCode,
  packingAuditId?: string,
  existingDbRow?: Record<string, any>
): Record<string, any> {
  // Prohibido copiar o fabricar el tax de DoorDash desde Toast cuando `taxAmount` falta en la fuente de la plataforma.
  const taxBreakdownVerified =
    pOrd.taxBreakdownVerified !== undefined
      ? pOrd.taxBreakdownVerified
      : pOrd.rawPayload?.tax_breakdown_verified !== false

  const toastNet = tOrd ? tOrd.netSales : 0
  const toastTax = tOrd ? tOrd.taxAmount : 0
  const toastExpectedGross = tOrd ? tOrd.expectedGross : 0

  const subtotalDiff = tOrd ? round2(pOrd.platformSubtotal - toastNet) : round2(pOrd.platformSubtotal)
  const expectedMerchantTax =
    tOrd && (pOrd.platform === 'DOORDASH' || pOrd.platform === 'GRUBHUB') ? toastTax : 0
  // Para Uber Eats, Uber es Marketplace Facilitator y retiene el tax: taxPaidToMerchant debe ser $0.00
  const effectiveMerchantTaxPaid = pOrd.platform === 'UBER_EATS' ? 0 : pOrd.platformTaxPaidToMerchant
  const taxDiff = tOrd
    ? round2(effectiveMerchantTaxPaid - expectedMerchantTax)
    : round2(effectiveMerchantTaxPaid)
  const grossDiff = tOrd
    ? round2(pOrd.platformGrossReceivable - toastExpectedGross)
    : round2(pOrd.platformGrossReceivable)

  let status: ReconciliationStatus = 'MATCHED'
  let isDisputed = Boolean(existingDbRow?.is_disputed)
  let disputeStatus = String(existingDbRow?.dispute_status || 'NONE')
  let disputeAmount = Number(existingDbRow?.dispute_amount || 0)

  const mergedRawPayload: Record<string, any> = {
    ...(existingDbRow?.raw_payload || {}),
    ...(pOrd.rawPayload || {}),
    tax_breakdown_verified: taxBreakdownVerified,
    unverified_reason: pOrd.unverifiedReason || pOrd.rawPayload?.unverified_reason || null,
    ...(tOrd?.isVoidedInToast
      ? {
          toast_voided: true,
          toast_voided_original_subtotal: tOrd.voidedOriginalSubtotal ?? 0,
          toast_void_date: tOrd.voidDate || null,
        }
      : {}),
  }
  // Defecto 4: el libro de créditos se fusiona por `credit_id` (una re-sincronización nunca borra ni duplica créditos)
  const mergedRecoveryCredits = mergeRecoveryCredits(
    existingDbRow?.raw_payload?.recovery_credits,
    pOrd.rawPayload?.recovery_credits
  )
  if (mergedRecoveryCredits.length > 0) {
    mergedRawPayload.recovery_credits = mergedRecoveryCredits
  }

  const stateChanges: any[] = Array.isArray(mergedRawPayload?.orderDetails?.orderStateChanges)
    ? mergedRawPayload.orderDetails.orderStateChanges
    : []
  const statusEvents: any[] = Array.isArray(mergedRawPayload?.order?.statusHistory?.orderStatusEvents)
    ? mergedRawPayload.order.statusHistory.orderStatusEvents
    : []
  const reachedReadyForPickup =
    stateChanges.some((sc: any) => String(sc?.type || '').toUpperCase().includes('READY')) ||
    statusEvents.some((ev: any) => String(ev?.orderStatus || '').toUpperCase().includes('READY_FOR_PICKUP'))
  const isLifecycleCanceled =
    String(mergedRawPayload?.orderStatus || '').toUpperCase().includes('CANCELED') ||
    String(mergedRawPayload?.order?.lifecycleStatus || '').toUpperCase().includes('CANCELED') ||
    statusEvents.some((ev: any) => String(ev?.orderStatus || '').toUpperCase().includes('CANCELED'))
  const effectivePayoutRef = pOrd.payoutReferenceId || existingDbRow?.payout_reference_id || null

  // Regla de Evidencia en Anulaciones (Toast voided = true):
  // Nunca poner importes de plataforma, fees o payout en cero por una anulación en Toast.
  // Se conservan los importes originales de ambas fuentes y se registra la telemetría de ciclo de vida.
  mergedRawPayload.platform_reached_ready_for_pickup = reachedReadyForPickup
  mergedRawPayload.platform_lifecycle_canceled = isLifecycleCanceled
  delete mergedRawPayload.cancelled_before_prep

  const effectivePlatformSubtotal = pOrd.platformSubtotal
  const effectivePlatformGross = pOrd.platformGrossReceivable
  const effectiveNetPayout = pOrd.netPayout
  const finalSubtotalDiff = tOrd ? round2(effectivePlatformSubtotal - toastNet) : round2(effectivePlatformSubtotal)
  const finalGrossDiff = tOrd ? round2(effectivePlatformGross - toastExpectedGross) : round2(effectivePlatformGross)

  if (
    pOrd.errorCharge < -0.01 ||
    pOrd.transactionType === 'REFUND' ||
    pOrd.transactionType === 'ERROR_CHARGE'
  ) {
    status = 'REFUNDED_OR_DISPUTED'
    isDisputed = true
    const orderTag = String(mergedRawPayload.orderTag || '').toUpperCase()
    const hasVerifiedSettlementCredit = mergedRecoveryCredits.some(
      (c) => c.verified === true && c.verification_method === 'SETTLEMENT_CREDIT_MATCH'
    )
    if (hasVerifiedSettlementCredit) {
      disputeStatus = 'APPROVED'
    } else if (existingDbRow?.dispute_status && existingDbRow.dispute_status !== 'NONE') {
      disputeStatus = existingDbRow.dispute_status
    } else if (orderTag.includes('APPROVED') || orderTag.includes('REFUNDED')) {
      disputeStatus = 'APPROVED'
    } else if (orderTag.includes('DENIED')) {
      disputeStatus = 'DENIED'
    } else if (orderTag.includes('PENDING') || orderTag.includes('REVIEW')) {
      disputeStatus = 'SUBMITTED'
    } else {
      disputeStatus = 'NEEDS_DISPUTE'
    }
    // Defecto 1: `dispute_amount` representa SIEMPRE el importe original descontado/disputado (nunca el recuperado).
    const errAbs = round2(Math.abs(pOrd.errorCharge))
    if (errAbs > 0.01) {
      mergedRawPayload.original_disputed_amount = errAbs
      mergedRawPayload.original_disputed_amount_source = 'PLATFORM_SETTLEMENT_DEDUCTION'
    }
    disputeAmount =
      errAbs ||
      Number(mergedRawPayload.original_disputed_amount || 0) ||
      Math.abs(grossDiff)
  } else if (pOrd.transactionType === 'ADJUSTMENT' && pOrd.platformSubtotal === 0 && pOrd.adjustmentAmount > 0) {
    status = 'REFUNDED_OR_DISPUTED'
    isDisputed = true
    disputeStatus = 'APPROVED'
    disputeAmount = pOrd.adjustmentAmount
  } else if (pOrd.transactionType === 'ADJUSTMENT' && pOrd.platformSubtotal === 0 && pOrd.adjustmentAmount < -0.01) {
    status = 'REFUNDED_OR_DISPUTED'
    isDisputed = true
    disputeStatus =
      existingDbRow?.dispute_status && existingDbRow.dispute_status !== 'NONE'
        ? existingDbRow.dispute_status
        : 'NEEDS_DISPUTE'
    disputeAmount = Math.abs(pOrd.adjustmentAmount)
    if (!(Number(mergedRawPayload.original_disputed_amount || 0) > 0)) {
      mergedRawPayload.original_disputed_amount = round2(Math.abs(pOrd.adjustmentAmount))
      mergedRawPayload.original_disputed_amount_source = 'PLATFORM_SETTLEMENT_DEDUCTION'
    }
  } else if (pOrd.transactionType === 'CANCELLATION' && effectiveNetPayout <= 0 && toastExpectedGross > 0) {
    status = 'CANCELLED_UNPAID'
    isDisputed = true
    if (disputeStatus === 'NONE') disputeStatus = 'NEEDS_DISPUTE'
    disputeAmount = toastExpectedGross
    if (!(Number(mergedRawPayload.original_disputed_amount || 0) > 0)) {
      mergedRawPayload.original_disputed_amount = round2(toastExpectedGross)
      mergedRawPayload.original_disputed_amount_source = 'TOAST_EXPECTED_GROSS_UNPAID_BY_PLATFORM'
    }
  } else if (
    !taxBreakdownVerified ||
    confidence === 'AMBIGUOUS' ||
    confidence === 'UNVERIFIED_NO_ID' ||
    pOrd.storeId === 0
  ) {
    status = 'REQUIRES_REVIEW'
  } else if (
    !tOrd &&
    Math.abs(pOrd.platformSubtotal) < 0.01 &&
    Math.abs(pOrd.platformGrossReceivable) < 0.01 &&
    (pOrd.transactionType === 'CANCELLATION' || pOrd.transactionType === 'ADJUSTMENT')
  ) {
    status = 'MATCHED'
  } else if (!tOrd) {
    status = 'MISSING_IN_TOAST'
  } else if (Math.abs(finalSubtotalDiff) > 0.05) {
    status = 'AMOUNT_MISMATCH'
    if (finalSubtotalDiff < -0.05) {
      isDisputed = true
      if (disputeStatus === 'NONE') disputeStatus = 'NEEDS_DISPUTE'
      disputeAmount = Math.abs(finalGrossDiff)
      if (!(Number(mergedRawPayload.original_disputed_amount || 0) > 0)) {
        mergedRawPayload.original_disputed_amount = round2(Math.abs(finalGrossDiff))
        mergedRawPayload.original_disputed_amount_source = 'TOAST_VS_PLATFORM_GROSS_VARIANCE'
      }
    }
  } else if (Math.abs(finalGrossDiff) > 0.05 || Math.abs(taxDiff) > 0.05) {
    status = 'TAX_MISMATCH'
  } else {
    status = 'MATCHED'
  }

  return {
    store_id: pOrd.storeId,
    platform: pOrd.platform,
    business_date: tOrd ? tOrd.businessDate : pOrd.businessDate,
    placed_at: pOrd.placedAt || tOrd?.openedAt || null,
    platform_order_id: pOrd.platformOrderId,
    platform_transaction_id: pOrd.platformTransactionId,
    payout_reference_id:
      effectivePayoutRef && effectivePayoutRef !== '--' ? effectivePayoutRef : null,
    payout_date: pOrd.payoutDate || existingDbRow?.payout_date || null,
    fulfillment_type: pOrd.fulfillmentType || tOrd?.fulfillmentType || 'DELIVERY',
    transaction_type: pOrd.transactionType,
    platform_subtotal: effectivePlatformSubtotal,
    platform_tax: pOrd.platformTax,
    platform_tax_withheld: pOrd.platformTaxWithheld,
    platform_tax_paid_to_merchant: effectiveMerchantTaxPaid,
    platform_gross_receivable: effectivePlatformGross,
    commission_fee: pOrd.commissionFee,
    delivery_fee: pOrd.deliveryFee,
    processing_fee: pOrd.processingFee,
    marketing_fee: pOrd.marketingFee,
    error_charge: pOrd.errorCharge,
    adjustment_amount: pOrd.adjustmentAmount,
    tip_amount: pOrd.tipAmount,
    net_payout: effectiveNetPayout,
    toast_order_guid: tOrd?.toastOrderGuid || null,
    toast_display_number: tOrd?.toastDisplayNumber || null,
    toast_tab_name: tOrd?.toastTabName || null,
    toast_opened_at: tOrd?.openedAt || null,
    toast_dining_option: tOrd?.diningOptionName || null,
    toast_net_sales: toastNet,
    toast_tax: toastTax,
    toast_expected_gross: toastExpectedGross,
    subtotal_diff: finalSubtotalDiff,
    tax_diff: taxDiff,
    gross_diff: finalGrossDiff,
    reconciliation_status: status,
    match_confidence: confidence,
    is_disputed: isDisputed,
    dispute_status: disputeStatus,
    dispute_reason:
      pOrd.disputeReason ||
      existingDbRow?.dispute_reason ||
      (status === 'REQUIRES_REVIEW'
        ? `Requiere revisión manual (${mergedRawPayload.unverified_reason || confidence})`
        : null),
    dispute_notes: existingDbRow?.dispute_notes || null,
    dispute_amount: round2(disputeAmount),
    packing_audit_id: packingAuditId || existingDbRow?.packing_audit_id || null,
    items_summary: tOrd?.itemsSummary?.length ? tOrd.itemsSummary : pOrd.itemsSummary || [],
    raw_payload: mergedRawPayload,
    updated_at: new Date().toISOString(),
  }
}

export function buildToastOnlyOrderRow(
  tOrd: ToastDeliveryOrderRecord,
  packingAuditId?: string
): Record<string, any> {
  const synthTxId = `TOAST-${tOrd.toastOrderGuid}`
  return {
    store_id: tOrd.storeId,
    platform: tOrd.platform,
    business_date: tOrd.businessDate,
    placed_at: tOrd.openedAt,
    platform_order_id: tOrd.extractedPlatformId || `Toast #${tOrd.toastDisplayNumber}`,
    platform_transaction_id: synthTxId,
    payout_reference_id: null,
    payout_date: null,
    fulfillment_type: tOrd.fulfillmentType,
    transaction_type: 'ORDER',
    platform_subtotal: 0,
    platform_tax: 0,
    platform_tax_withheld: 0,
    platform_tax_paid_to_merchant: 0,
    platform_gross_receivable: 0,
    commission_fee: 0,
    delivery_fee: 0,
    processing_fee: 0,
    marketing_fee: 0,
    error_charge: 0,
    adjustment_amount: 0,
    tip_amount: 0,
    net_payout: 0,
    toast_order_guid: tOrd.toastOrderGuid,
    toast_display_number: tOrd.toastDisplayNumber,
    toast_tab_name: tOrd.toastTabName,
    toast_opened_at: tOrd.openedAt,
    toast_dining_option: tOrd.diningOptionName,
    toast_net_sales: tOrd.netSales,
    toast_tax: tOrd.taxAmount,
    toast_expected_gross: tOrd.expectedGross,
    subtotal_diff: round2(-tOrd.netSales),
    tax_diff: round2(tOrd.platform === 'UBER_EATS' ? 0 : -tOrd.taxAmount),
    gross_diff: round2(-tOrd.expectedGross),
    reconciliation_status: 'MISSING_IN_PLATFORM',
    match_confidence: 'TOAST_ONLY',
    is_disputed: false,
    dispute_status: 'NONE',
    dispute_reason: 'Orden registrada en Toast POS pendiente de conciliar o ausente en el corte de la plataforma',
    dispute_amount: tOrd.expectedGross,
    packing_audit_id: packingAuditId || null,
    items_summary: tOrd.itemsSummary,
    raw_payload: {},
    updated_at: new Date().toISOString(),
  }
}

// =============================================================================
// LIBRO DE CRÉDITOS DE RECUPERACIÓN (recovery_credits) — Disputas y Recuperaciones
// =============================================================================

/**
 * Crédito individual de recuperación de una orden disputada.
 * - Se persiste en `delivery_platform_orders.raw_payload.recovery_credits[]` (un elemento por crédito real).
 * - `credit_id` es estable y deduplica sincronizaciones repetidas:
 *   `TX:<transaction_id>` cuando la plataforma entrega un ID de transacción (Grubhub `AwE...`),
 *   `XPR:<payout>:<orden>:<importe>:<n>` para líneas MISC_ITEM de Uber Eats sin ID, y
 *   `MANUAL:<payout>` para capturas manuales aún no comprobadas contra el settlement.
 * - `verified = true` solo cuando el crédito fue localizado en los datos del settlement (payout) posterior
 *   con orden, importe y cronología coherentes (`verification_method = 'SETTLEMENT_CREDIT_MATCH'`).
 *   La existencia del payout o una nota escrita NUNCA bastan para marcarlo verificado.
 */
export interface RecoveryCredit {
  credit_id: string
  source: 'PLATFORM_SETTLEMENT_CREDIT' | 'MANUAL_ENTRY' | 'LEGACY_FIELDS'
  transaction_id: string | null
  payout_reference_id: string
  amount: number
  deposit_date: string | null
  period_start?: string | null
  period_end?: string | null
  description: string | null
  order_code: string | null
  verified: boolean
  verification_method: 'SETTLEMENT_CREDIT_MATCH' | null
  verification_issue: string | null
  settlement_entry_key: string | null
  evidence?: string | null
  recorded_by?: string | null
  recorded_at?: string | null
}

export interface RecoverySettlementPayoutLike {
  store_id: number | string
  platform: string
  payout_reference_id: string
  payout_date?: string | null
  period_start?: string | null
  period_end?: string | null
  raw_payload?: Record<string, any> | null
}

export interface SettlementRecoveryCreditEntry {
  entry_key: string
  transaction_id: string | null
  amount: number
  description: string | null
  order_code: string
}

export interface DisputeRecoveryContext {
  /** Índice `store_id:platform:payout_reference_id` -> payout con `raw_payload` del settlement (ver `buildRecoverySettlementIndex`). */
  settlementPayouts?: Map<string, RecoverySettlementPayoutLike>
}

const normalizeRecoveryOrderCode = (v: unknown): string =>
  String(v ?? '')
    .trim()
    .replace(/^#/, '')
    .toUpperCase()

const isIsoDateStr = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())

export function recoverySettlementKey(storeId: unknown, platform: unknown, payoutRef: unknown): string {
  return `${Number(storeId || 0)}:${String(platform || '').toUpperCase()}:${String(payoutRef || '').trim()}`
}

/** Construye el índice de settlements (payouts) usado para verificar créditos de recuperación en lectura. */
export function buildRecoverySettlementIndex(
  payoutRows: Array<RecoverySettlementPayoutLike | Record<string, any>>
): Map<string, RecoverySettlementPayoutLike> {
  const idx = new Map<string, RecoverySettlementPayoutLike>()
  for (const p of payoutRows || []) {
    const ref = String((p as any)?.payout_reference_id || '').trim()
    if (!ref) continue
    idx.set(recoverySettlementKey((p as any).store_id, (p as any).platform, ref), p as RecoverySettlementPayoutLike)
  }
  return idx
}

/**
 * Extrae del settlement los créditos identificables que corresponden a una orden:
 * - Grubhub: `raw_payload.associated_transactions` con `order_number` igual, `is_refund = false`,
 *   `subtotal = 0` y `net_amount > 0` (crédito `CS_CREDIT` / `AwE...`, importe en centavos).
 * - Cualquier plataforma: `raw_payload.cross_payout_refunds` con `orderCode` igual (Uber MISC_ITEM / Grubhub).
 * Deduplica por `transaction_id` cuando ambas fuentes describen el mismo crédito.
 */
export function extractSettlementRecoveryCreditsForOrder(
  payout: RecoverySettlementPayoutLike | null | undefined,
  orderCode: unknown
): SettlementRecoveryCreditEntry[] {
  const target = normalizeRecoveryOrderCode(orderCode)
  if (!payout || !target) return []
  const ref = String(payout.payout_reference_id || '').trim()
  const out: SettlementRecoveryCreditEntry[] = []
  const seen = new Set<string>()

  const assoc: any[] = Array.isArray(payout.raw_payload?.associated_transactions)
    ? payout.raw_payload!.associated_transactions
    : []
  for (const tx of assoc) {
    if (normalizeRecoveryOrderCode(tx?.order_number) !== target) continue
    const netCents = Number(tx?.net_amount || 0)
    if (tx?.is_refund || Number(tx?.subtotal || 0) !== 0 || !(netCents > 0)) continue
    const txId = String(tx?.transaction_id || '').trim() || null
    const key = txId ? `TX:${txId}` : `GHTX:${ref}:${target}:${(netCents / 100).toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      entry_key: key,
      transaction_id: txId,
      amount: round2(netCents / 100),
      description: String(tx?.transaction_type_description || tx?.transaction_type || '') || null,
      order_code: target,
    })
  }

  const xpr: any[] = Array.isArray(payout.raw_payload?.cross_payout_refunds)
    ? payout.raw_payload!.cross_payout_refunds
    : []
  const occurrence = new Map<string, number>()
  for (const cr of xpr) {
    if (normalizeRecoveryOrderCode(cr?.orderCode) !== target) continue
    const amt = round2(Number(cr?.amount || 0))
    if (!(amt > 0)) continue
    const txId = String(cr?.transactionId || '').trim() || null
    let key: string
    if (txId) {
      key = `TX:${txId}`
    } else {
      const base = `XPR:${ref}:${target}:${amt.toFixed(2)}`
      const n = (occurrence.get(base) || 0) + 1
      occurrence.set(base, n)
      key = `${base}:${n}`
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      entry_key: key,
      transaction_id: txId,
      amount: amt,
      description: String(cr?.description || '') || null,
      order_code: target,
    })
  }
  return out
}

/** Fecha en que la plataforma aplicó la deducción original (payout de la orden) o, en su defecto, la fecha operativa. */
function getOrderDeductionDate(order: any): string | null {
  if (isCreditOnlyRecoveryRow(order)) return null
  const pd = String(order?.payout_date || '').slice(0, 10)
  if (isIsoDateStr(pd)) return pd
  const bd = String(order?.business_date || '').slice(0, 10)
  return isIsoDateStr(bd) ? bd : null
}

/**
 * Fila que ES el propio crédito de recuperación (p. ej. Grubhub `AwE...` / `ADJUSTMENT` con subtotal $0 y ajuste positivo),
 * sin la deducción original en la misma fila. Su `payout_reference_id` es el payout del crédito, no el de la deducción,
 * por lo que no aplica la regla "mismo payout que la deducción"; el importe original queda sin comprobar.
 */
function isCreditOnlyRecoveryRow(order: any): boolean {
  return (
    String(order?.transaction_type || '').toUpperCase() === 'ADJUSTMENT' &&
    Math.abs(Number(order?.platform_subtotal || 0)) < 0.005 &&
    Number(order?.error_charge || 0) >= -0.005 &&
    Number(order?.adjustment_amount || 0) > 0
  )
}

/**
 * Verifica un crédito de recuperación contra el settlement posterior:
 * 1. El payout existe y pertenece a la misma sucursal y plataforma de la orden.
 * 2. Es un payout distinto (posterior) al payout donde se aplicó la deducción.
 * 3. Cronología coherente: fecha del depósito de recuperación >= fecha de la deducción original.
 * 4. El settlement contiene un crédito identificable para la orden (por `transaction_id` o, si no hay ID,
 *    por importe exacto ±$0.02) que no haya sido consumido ya por otro crédito.
 */
export function verifyRecoveryCreditAgainstSettlement(params: {
  order: any
  credit: Pick<RecoveryCredit, 'transaction_id' | 'payout_reference_id' | 'amount' | 'deposit_date'>
  payout: RecoverySettlementPayoutLike | null | undefined
  consumedEntryKeys?: Set<string>
}): { verified: boolean; issue: string | null; matchedEntry: SettlementRecoveryCreditEntry | null } {
  const { order, credit, payout, consumedEntryKeys } = params
  if (!payout) return { verified: false, issue: 'RECOVERY_PAYOUT_NOT_FOUND', matchedEntry: null }
  if (
    Number(payout.store_id) !== Number(order?.store_id) ||
    String(payout.platform || '').toUpperCase() !== String(order?.platform || '').toUpperCase()
  ) {
    return { verified: false, issue: 'RECOVERY_PAYOUT_STORE_PLATFORM_MISMATCH', matchedEntry: null }
  }
  const recRef = String(payout.payout_reference_id || '').trim()
  const deductionRef = isCreditOnlyRecoveryRow(order) ? '' : String(order?.payout_reference_id || '').trim()
  if (deductionRef && recRef === deductionRef) {
    return { verified: false, issue: 'RECOVERY_IN_SAME_PAYOUT_AS_DEDUCTION', matchedEntry: null }
  }
  const recDate =
    (isIsoDateStr(credit.deposit_date) ? credit.deposit_date : null) ||
    (isIsoDateStr(String(payout.payout_date || '').slice(0, 10)) ? String(payout.payout_date).slice(0, 10) : null) ||
    (isIsoDateStr(String(payout.period_end || '').slice(0, 10)) ? String(payout.period_end).slice(0, 10) : null)
  const dedDate = getOrderDeductionDate(order)
  if (!recDate) return { verified: false, issue: 'RECOVERY_DATE_MISSING', matchedEntry: null }
  if (dedDate && recDate < dedDate) {
    return { verified: false, issue: 'RECOVERY_BEFORE_DEDUCTION', matchedEntry: null }
  }

  const entries = extractSettlementRecoveryCreditsForOrder(payout, order?.platform_order_id).filter(
    (e) => !consumedEntryKeys?.has(e.entry_key)
  )
  if (entries.length === 0) {
    return { verified: false, issue: 'NO_IDENTIFIABLE_CREDIT_IN_SETTLEMENT', matchedEntry: null }
  }
  const creditTx = String(credit.transaction_id || '').trim()
  const creditAmt = round2(Number(credit.amount || 0))
  const match = creditTx
    ? entries.find((e) => e.transaction_id === creditTx)
    : entries.find((e) => Math.abs(e.amount - creditAmt) <= 0.02)
  if (!match) {
    return {
      verified: false,
      issue: creditTx ? 'CREDIT_TRANSACTION_NOT_IN_SETTLEMENT' : 'CREDIT_AMOUNT_MISMATCH',
      matchedEntry: null,
    }
  }
  if (Math.abs(match.amount - creditAmt) > 0.02) {
    return { verified: false, issue: 'CREDIT_AMOUNT_MISMATCH', matchedEntry: match }
  }
  return { verified: true, issue: null, matchedEntry: match }
}

/**
 * Fusiona créditos por `credit_id` (idempotente ante sincronizaciones repetidas: nunca suma dos veces el mismo crédito).
 * Conserva `recorded_by`/`recorded_at`/`evidence` del registro existente cuando el entrante no los trae.
 */
export function mergeRecoveryCredits(existing: unknown, incoming: unknown): RecoveryCredit[] {
  const byId = new Map<string, RecoveryCredit>()
  const add = (c: any, isIncoming: boolean) => {
    const id = String(c?.credit_id || '').trim()
    if (!id) return
    const prev = byId.get(id)
    if (!prev) {
      byId.set(id, { ...c, amount: round2(Number(c.amount || 0)) })
      return
    }
    const keepPrevVerification =
      isIncoming && prev.verified === true && prev.verification_method === 'SETTLEMENT_CREDIT_MATCH' && c.verified !== true
    byId.set(id, {
      ...prev,
      ...(isIncoming ? c : {}),
      amount: round2(Number((isIncoming ? c.amount : prev.amount) || 0)),
      ...(keepPrevVerification
        ? {
            verified: true,
            verification_method: prev.verification_method,
            verification_issue: null,
            settlement_entry_key: prev.settlement_entry_key,
          }
        : {}),
      recorded_by: prev.recorded_by || c.recorded_by || null,
      recorded_at: prev.recorded_at || c.recorded_at || null,
      evidence: (isIncoming ? c.evidence : null) || prev.evidence || null,
    })
  }
  for (const c of Array.isArray(existing) ? existing : []) add(c, false)
  for (const c of Array.isArray(incoming) ? incoming : []) add(c, true)
  return Array.from(byId.values())
}

/**
 * Créditos de recuperación de la orden. Si la orden aún no tiene libro (`recovery_credits`), deriva un crédito
 * `LEGACY_FIELDS` no verificado a partir de los campos históricos `reimbursement_*` para que se evalúe con la misma regla.
 */
export function getOrderRecoveryCredits(o: any): RecoveryCredit[] {
  const ledger = o?.raw_payload?.recovery_credits
  if (Array.isArray(ledger) && ledger.length > 0) return mergeRecoveryCredits([], ledger)
  const ref = String(o?.raw_payload?.reimbursement_payout_ref || '').trim()
  const amt = round2(Number(o?.raw_payload?.reimbursement_amount || 0))
  if (!ref && !(amt > 0)) return []
  const dateRaw = String(o?.raw_payload?.reimbursement_deposit_date || '').trim()
  return [
    {
      credit_id: `LEGACY:${ref || 'NO_REF'}`,
      source: 'LEGACY_FIELDS',
      transaction_id: String(o?.raw_payload?.reimbursement_transaction_id || '').trim() || null,
      payout_reference_id: ref,
      amount: amt,
      deposit_date: isIsoDateStr(dateRaw) ? dateRaw : null,
      description: o?.raw_payload?.reimbursement_description || null,
      order_code: normalizeRecoveryOrderCode(o?.platform_order_id) || null,
      verified: false,
      verification_method: null,
      verification_issue: 'LEGACY_FIELDS_NOT_VERIFIED',
      settlement_entry_key: null,
      evidence: o?.raw_payload?.reimbursement_evidence || null,
    },
  ]
}

/** Todas las referencias de payout donde la orden tiene créditos de recuperación (libro + campos históricos). */
export function getOrderRecoveryPayoutRefs(o: any): string[] {
  const refs = new Set<string>()
  for (const c of getOrderRecoveryCredits(o)) {
    const r = String(c.payout_reference_id || '').trim()
    if (r) refs.add(r)
  }
  const legacy = String(o?.raw_payload?.reimbursement_payout_ref || '').trim()
  if (legacy) refs.add(legacy)
  return Array.from(refs)
}

/**
 * Importe ORIGINAL descontado/disputado, independiente de las recuperaciones.
 * Prioridad: `raw_payload.original_disputed_amount` -> `raw_payload.original_error_charge_abs` -> `|error_charge|`
 * -> `dispute_amount` solo si la orden no tiene recuperaciones registradas (históricamente `dispute_amount`
 * pudo ser sobrescrito con el importe recuperado, por lo que deja de ser confiable en cuanto hay una recuperación).
 * Devuelve `amount = null` cuando el importe original no está comprobado.
 */
export function resolveOriginalDisputedAmount(o: any): { amount: number | null; source: string | null } {
  const stored = round2(Number(o?.raw_payload?.original_disputed_amount || 0))
  if (stored > 0) return { amount: stored, source: String(o?.raw_payload?.original_disputed_amount_source || 'STORED') }
  const legacyStored = round2(Number(o?.raw_payload?.original_error_charge_abs || 0))
  if (legacyStored > 0) return { amount: legacyStored, source: 'ORIGINAL_ERROR_CHARGE_ABS' }
  const err = round2(Math.abs(Number(o?.error_charge || 0)))
  if (err > 0.01) return { amount: err, source: 'PLATFORM_SETTLEMENT_DEDUCTION' }
  const hasRecoveryData =
    getOrderRecoveryCredits(o).length > 0 || String(o?.dispute_status || '').toUpperCase() === 'REIMBURSED'
  const da = round2(Math.abs(Number(o?.dispute_amount || 0)))
  if (da > 0 && !hasRecoveryData) return { amount: da, source: 'DISPUTE_AMOUNT_PRE_RECOVERY' }
  return { amount: null, source: null }
}

export interface EvaluatedRecoveryCredit extends RecoveryCredit {
  counted: boolean
}

export interface DisputeRecoveryEvaluation {
  isDisputed: boolean
  /** Importe original descontado/disputado (0 si no está comprobado; ver `originalAmountVerified`). */
  originalDeductionAbs: number
  originalAmountVerified: boolean
  originalAmountSource: string | null
  /** Referencia del crédito más reciente (compatibilidad). Usar `recoveryCredits` para el desglose completo. */
  reimbursementPayoutRef: string | null
  /** Total recuperado verificado; si no hay ninguno verificado, total reclamado sin verificar (compatibilidad). */
  reimbursementAmount: number
  reimbursementDepositDate: string | null
  reimbursementEvidence: string | null
  verifiedRecoveredAmount: number
  claimedUnverifiedAmount: number
  recoveryCredits: EvaluatedRecoveryCredit[]
  verificationIssues: string[]
  /** La plataforma aprobó la disputa (estado de flujo) — NO implica dinero recuperado. */
  isDisputeApproved: boolean
  hasVerifiableRecoveryEvidence: boolean
  recoveryClassification:
    | 'NONE'
    | 'OPEN_DISPUTE'
    | 'UNVERIFIED_RECOVERY'
    | 'PARTIAL_RECOVERY'
    | 'FULL_RECOVERY'
  /** Saldo pendiente = original − recuperado verificado (0 si el original no está comprobado). */
  unrecoveredAmount: number
}

/**
 * Evalúa el estado de disputa y recuperación de una orden separando:
 * (a) importe original descontado/disputado, (b) créditos recuperados y (c) saldo pendiente.
 *
 * Reglas:
 * - Un crédito cuenta como dinero recuperado solo si está verificado contra el settlement posterior
 *   (`verifyRecoveryCreditAgainstSettlement`): con `ctx.settlementPayouts` se re-verifica en lectura contra los datos
 *   del payout; sin contexto se acepta únicamente la verificación persistida por el servidor
 *   (`verification_method = 'SETTLEMENT_CREDIT_MATCH'` + `settlement_entry_key`) con cronología coherente.
 * - Nota escrita + existencia del payout NO prueban el cobro -> `UNVERIFIED_RECOVERY` ("Recuperación pendiente de verificar").
 * - `APPROVED` / `REIMBURSED` son estados de flujo; no confirman dinero sin crédito verificado.
 * - Si el importe original no está comprobado, cualquier recuperación queda `UNVERIFIED_RECOVERY`.
 * - `FULL_RECOVERY` cuando recuperado verificado >= original − $0.02; si es menor, `PARTIAL_RECOVERY` con saldo pendiente.
 */
export function evaluateDisputeRecovery(o: any, ctx?: DisputeRecoveryContext): DisputeRecoveryEvaluation {
  const errChargeAbs = round2(Math.abs(Number(o?.error_charge || 0)))
  const original = resolveOriginalDisputedAmount(o)
  const credits = getOrderRecoveryCredits(o)
  const status = String(o?.dispute_status || '').toUpperCase()
  const isDisputeApproved = status === 'APPROVED' || status === 'REIMBURSED'
  const evidenceRaw = String(
    o?.raw_payload?.reimbursement_evidence || o?.dispute_notes || o?.raw_payload?.reimbursement_description || ''
  ).trim()
  const reimbEvidence = evidenceRaw.length > 0 ? evidenceRaw : null

  const isDisputed =
    Boolean(o?.is_disputed) ||
    o?.reconciliation_status === 'REFUNDED_OR_DISPUTED' ||
    errChargeAbs > 0.01 ||
    credits.length > 0 ||
    status === 'REIMBURSED'

  const empty: DisputeRecoveryEvaluation = {
    isDisputed: false,
    originalDeductionAbs: 0,
    originalAmountVerified: false,
    originalAmountSource: null,
    reimbursementPayoutRef: null,
    reimbursementAmount: 0,
    reimbursementDepositDate: null,
    reimbursementEvidence: null,
    verifiedRecoveredAmount: 0,
    claimedUnverifiedAmount: 0,
    recoveryCredits: [],
    verificationIssues: [],
    isDisputeApproved: false,
    hasVerifiableRecoveryEvidence: false,
    recoveryClassification: 'NONE',
    unrecoveredAmount: 0,
  }
  if (!isDisputed) return empty

  const dedDate = getOrderDeductionDate(o)
  const deductionRef = isCreditOnlyRecoveryRow(o) ? '' : String(o?.payout_reference_id || '').trim()
  const consumed = new Set<string>()
  const evaluated: EvaluatedRecoveryCredit[] = []
  // Verificar primero créditos con transaction_id (match exacto), luego por importe
  const ordered = [...credits].sort((a, b) => Number(Boolean(b.transaction_id)) - Number(Boolean(a.transaction_id)))
  for (const c of ordered) {
    const amt = round2(Number(c.amount || 0))
    const ref = String(c.payout_reference_id || '').trim()
    let verified = false
    let issue: string | null = null
    let entryKey: string | null = c.settlement_entry_key || null
    if (!ref) {
      issue = 'MISSING_RECOVERY_PAYOUT_REFERENCE'
    } else if (!(amt > 0)) {
      issue = 'NON_POSITIVE_RECOVERY_AMOUNT'
    } else {
      const payout = ctx?.settlementPayouts?.get(recoverySettlementKey(o?.store_id, o?.platform, ref))
      if (payout) {
        const res = verifyRecoveryCreditAgainstSettlement({ order: o, credit: c, payout, consumedEntryKeys: consumed })
        verified = res.verified
        issue = res.issue
        if (res.matchedEntry) entryKey = res.matchedEntry.entry_key
      } else if (
        c.verified === true &&
        c.verification_method === 'SETTLEMENT_CREDIT_MATCH' &&
        Boolean(c.settlement_entry_key) &&
        !consumed.has(String(c.settlement_entry_key))
      ) {
        if (deductionRef && ref === deductionRef) issue = 'RECOVERY_IN_SAME_PAYOUT_AS_DEDUCTION'
        else if (!isIsoDateStr(c.deposit_date)) issue = 'RECOVERY_DATE_MISSING'
        else if (dedDate && c.deposit_date < dedDate) issue = 'RECOVERY_BEFORE_DEDUCTION'
        else verified = true
      } else {
        issue = c.verification_issue || 'NO_IDENTIFIABLE_CREDIT_IN_SETTLEMENT'
      }
    }
    if (verified && entryKey) consumed.add(entryKey)
    evaluated.push({
      ...c,
      amount: amt,
      verified,
      verification_issue: verified ? null : issue,
      settlement_entry_key: verified ? entryKey : c.settlement_entry_key || null,
      counted: verified,
    })
  }

  // Un reclamo sin verificar que describe el mismo dinero que un crédito verificado (mismo payout e importe) queda absorbido
  for (const e of evaluated) {
    if (e.verified) continue
    const absorbed = evaluated.some(
      (v) => v.verified && v.payout_reference_id === e.payout_reference_id && Math.abs(v.amount - e.amount) <= 0.02
    )
    if (absorbed) e.verification_issue = 'SUPERSEDED_BY_VERIFIED_SETTLEMENT_CREDIT'
  }

  const verifiedTotal = round2(evaluated.filter((e) => e.verified).reduce((s, e) => s + e.amount, 0))
  const claimedUnverified = round2(
    evaluated
      .filter((e) => !e.verified && e.verification_issue !== 'SUPERSEDED_BY_VERIFIED_SETTLEMENT_CREDIT')
      .reduce((s, e) => s + e.amount, 0)
  )
  const byDateDesc = [...evaluated].sort((a, b) => String(b.deposit_date || '').localeCompare(String(a.deposit_date || '')))
  const latest = byDateDesc.find((e) => e.verified) || byDateDesc[0] || null
  const issues = Array.from(
    new Set(
      evaluated
        .filter((e) => !e.verified && e.verification_issue && e.verification_issue !== 'SUPERSEDED_BY_VERIFIED_SETTLEMENT_CREDIT')
        .map((e) => String(e.verification_issue))
    )
  )
  const originalAbs = original.amount ?? 0
  if (original.amount === null && (credits.length > 0 || status === 'REIMBURSED')) {
    issues.push('ORIGINAL_DISPUTED_AMOUNT_UNVERIFIED')
  }
  if (status === 'REIMBURSED' && credits.length === 0) issues.push('REIMBURSED_STATUS_WITHOUT_RECOVERY_CREDIT')

  const base = {
    isDisputed: true,
    originalDeductionAbs: originalAbs,
    originalAmountVerified: original.amount !== null,
    originalAmountSource: original.source,
    reimbursementPayoutRef: latest ? latest.payout_reference_id || null : null,
    reimbursementAmount: verifiedTotal > 0 ? verifiedTotal : claimedUnverified,
    reimbursementDepositDate: latest ? latest.deposit_date || null : null,
    reimbursementEvidence: reimbEvidence,
    verifiedRecoveredAmount: verifiedTotal,
    claimedUnverifiedAmount: claimedUnverified,
    recoveryCredits: evaluated,
    verificationIssues: issues,
    isDisputeApproved,
  }

  const claimsRecovery = credits.length > 0 || status === 'REIMBURSED'
  if (!claimsRecovery) {
    return {
      ...base,
      hasVerifiableRecoveryEvidence: false,
      recoveryClassification: 'OPEN_DISPUTE',
      unrecoveredAmount: originalAbs,
    }
  }

  if (original.amount === null || verifiedTotal <= 0) {
    return {
      ...base,
      hasVerifiableRecoveryEvidence: false,
      recoveryClassification: 'UNVERIFIED_RECOVERY',
      unrecoveredAmount: original.amount === null ? 0 : originalAbs,
    }
  }

  const isPartial = verifiedTotal < originalAbs - 0.02
  return {
    ...base,
    hasVerifiableRecoveryEvidence: true,
    recoveryClassification: isPartial ? 'PARTIAL_RECOVERY' : 'FULL_RECOVERY',
    unrecoveredAmount: isPartial ? round2(Math.max(0, originalAbs - verifiedTotal)) : 0,
  }
}

/**
 * Construye la actualización de una recuperación capturada manualmente (acción `update_dispute`) SIN sobrescribir
 * el importe original disputado:
 * - `dispute_amount` y `raw_payload.original_disputed_amount` conservan el importe original (si estaba comprobado).
 * - La captura se agrega como crédito al libro `recovery_credits`; se verifica contra el settlement del payout indicado.
 *   Si el settlement contiene el crédito identificable de la orden, el crédito queda `verified` con su `transaction_id`;
 *   si no, queda como `MANUAL:<payout>` sin verificar ("Recuperación pendiente de verificar").
 * - Reemplaza solo capturas manuales no verificadas previas (corrección de captura); nunca elimina créditos verificados.
 */
export function buildManualRecoveryUpdate(params: {
  existingOrder: Record<string, any>
  recoveryPayout: RecoverySettlementPayoutLike | null
  input: {
    payoutRef: string
    amount: number
    depositDate: string | null
    description: string | null
    evidence: string | null
  }
  actorEmail: string | null
  nowIso: string
}): { rawPayload: Record<string, any>; credit: RecoveryCredit; verification: ReturnType<typeof verifyRecoveryCreditAgainstSettlement> } {
  const { existingOrder, recoveryPayout, input, actorEmail, nowIso } = params
  const prevRaw = existingOrder?.raw_payload || {}
  const original = resolveOriginalDisputedAmount(existingOrder)
  const priorCredits = getOrderRecoveryCredits(existingOrder).filter((c) => c.source !== 'LEGACY_FIELDS')
  const legacyCredits = getOrderRecoveryCredits(existingOrder).filter((c) => c.source === 'LEGACY_FIELDS')

  const draft = {
    transaction_id: null as string | null,
    payout_reference_id: String(input.payoutRef || '').trim(),
    amount: round2(Number(input.amount || 0)),
    deposit_date: isIsoDateStr(input.depositDate) ? input.depositDate : null,
  }
  // Excluir del cómputo las entradas del settlement ya verificadas por otros créditos (evita contar dos veces)
  const consumed = new Set<string>(
    priorCredits.filter((c) => c.verified && c.settlement_entry_key).map((c) => String(c.settlement_entry_key))
  )
  let verification = verifyRecoveryCreditAgainstSettlement({
    order: existingOrder,
    credit: draft,
    payout: recoveryPayout,
    consumedEntryKeys: consumed,
  })
  // Si el crédito capturado ya existe verificado en el libro (mismo payout e importe), se reutiliza sin duplicar
  const alreadyVerified = priorCredits.find(
    (c) =>
      c.verified &&
      c.payout_reference_id === draft.payout_reference_id &&
      Math.abs(Number(c.amount || 0) - draft.amount) <= 0.02
  )
  if (!verification.verified && alreadyVerified) {
    verification = { verified: true, issue: null, matchedEntry: null }
  }

  const matched = verification.matchedEntry
  const credit: RecoveryCredit = alreadyVerified && !matched
    ? { ...alreadyVerified, evidence: input.evidence || alreadyVerified.evidence || null }
    : {
        credit_id: verification.verified && matched ? matched.entry_key : `MANUAL:${draft.payout_reference_id}`,
        source: verification.verified ? 'PLATFORM_SETTLEMENT_CREDIT' : 'MANUAL_ENTRY',
        transaction_id: matched?.transaction_id || null,
        payout_reference_id: draft.payout_reference_id,
        amount: draft.amount,
        deposit_date: draft.deposit_date,
        period_start: recoveryPayout?.period_start || null,
        period_end: recoveryPayout?.period_end || null,
        description: input.description || matched?.description || null,
        order_code: normalizeRecoveryOrderCode(existingOrder?.platform_order_id) || null,
        verified: verification.verified,
        verification_method: verification.verified ? 'SETTLEMENT_CREDIT_MATCH' : null,
        verification_issue: verification.verified ? null : verification.issue,
        settlement_entry_key: verification.verified && matched ? matched.entry_key : null,
        evidence: input.evidence || null,
        recorded_by: actorEmail,
        recorded_at: nowIso,
      }

  // Conservar créditos previos (verificados y de otras referencias); reemplazar capturas manuales no verificadas
  const keptPrior = priorCredits.filter((c) => !(c.source === 'MANUAL_ENTRY' && !c.verified))
  // Los campos históricos se migran al libro como crédito LEGACY no verificado si describen otra referencia
  const keptLegacy = legacyCredits.filter(
    (lc) => lc.payout_reference_id && lc.payout_reference_id !== draft.payout_reference_id
  )
  const ledger = mergeRecoveryCredits([...keptLegacy, ...keptPrior], [credit])

  const rawPayload: Record<string, any> = {
    ...prevRaw,
    recovery_credits: ledger,
    ...(original.amount !== null
      ? {
          original_disputed_amount: original.amount,
          original_disputed_amount_source: prevRaw.original_disputed_amount_source || original.source,
        }
      : {}),
    // Campos históricos de compatibilidad: describen la captura más reciente (no el total)
    reimbursement_payout_ref: draft.payout_reference_id || null,
    reimbursement_amount: draft.amount,
    reimbursement_deposit_date: draft.deposit_date,
    reimbursement_description: input.description ?? prevRaw.reimbursement_description ?? null,
    reimbursement_transaction_id: credit.transaction_id || null,
  }
  return { rawPayload, credit, verification }
}

/**
 * Crea créditos de recuperación de Grubhub conservando CADA transacción con su propio payout:
 * un `recoveryTx` (`!is_refund && subtotal = 0 && net_amount > 0`) -> un `RecoveryCredit` con `transaction_id`,
 * `payout_reference_id`, importe y fecha del depósito donde se pagó. Nunca agrega importes bajo una sola referencia.
 */
export function buildGrubhubRecoveryCredits(
  recoveryTxs: any[],
  depositByTxId: Map<string, { payoutRef: string; payoutDate: string; periodStart?: string | null; periodEnd?: string | null }>,
  orderCode: string
): RecoveryCredit[] {
  const out: RecoveryCredit[] = []
  for (const r of recoveryTxs || []) {
    const txId = String(r?.transaction_id || '').trim()
    const netCents = Number(r?.net_amount || 0)
    if (!txId || !(netCents > 0)) continue
    const dep = depositByTxId.get(txId)
    if (!dep?.payoutRef) continue
    out.push({
      credit_id: `TX:${txId}`,
      source: 'PLATFORM_SETTLEMENT_CREDIT',
      transaction_id: txId,
      payout_reference_id: dep.payoutRef,
      amount: round2(netCents / 100),
      deposit_date: isIsoDateStr(dep.payoutDate) ? dep.payoutDate : null,
      period_start: dep.periodStart || null,
      period_end: dep.periodEnd || null,
      description: String(r?.transaction_type_description || r?.transaction_type || 'Crédito / Recuperación de Disputa Grubhub'),
      order_code: normalizeRecoveryOrderCode(orderCode) || null,
      // Proviene de `associated_transactions` del depósito: se verifica en el motor contra el settlement persistido
      verified: false,
      verification_method: null,
      verification_issue: 'PENDING_SETTLEMENT_VERIFICATION',
      settlement_entry_key: null,
    })
  }
  return mergeRecoveryCredits([], out)
}

/**
 * Cuando un corte semanal de DoorDash proviene de `payout_summaries` sin `payout_transactions` aún
 * (`period_start === payout_date && period_end === payout_date`), deriva su ciclo semanal real
 * (Lunes a Domingo inmediatamente anterior a la fecha de depósito).
 */
export function resolveDoorDashCycleFromPayoutDate(payoutDateStr: string): { periodStart: string; periodEnd: string } {
  const clean = String(payoutDateStr || '').slice(0, 10)
  const d = new Date(`${clean}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return { periodStart: clean, periodEnd: clean }
  const dow = d.getUTCDay()
  const daysToPrevSunday = dow === 0 ? 7 : dow
  const sun = new Date(d.getTime() - daysToPrevSunday * 86400000)
  const mon = new Date(sun.getTime() - 6 * 86400000)
  return {
    periodStart: mon.toISOString().slice(0, 10),
    periodEnd: sun.toISOString().slice(0, 10),
  }
}

export function resolveEffectivePayoutPeriod(payout: {
  platform?: string | null
  period_start?: string | null
  period_end?: string | null
  payout_date?: string | null
  raw_payload?: Record<string, any> | null
}): { period_start: string; period_end: string } {
  const pPay = String(payout?.payout_date || '').slice(0, 10)
  const pStart = String(payout?.period_start || '').slice(0, 10)
  const pEnd = String(payout?.period_end || '').slice(0, 10)
  if (
    String(payout?.platform || '').toUpperCase() === 'DOORDASH' &&
    pPay &&
    (!pStart ||
      !pEnd ||
      (pStart === pPay &&
        pEnd === pPay &&
        (payout?.raw_payload?.period_verified === false ||
          [2, 3, 4, 5].includes(new Date(`${pPay}T12:00:00Z`).getUTCDay()))))
  ) {
    const cycle = resolveDoorDashCycleFromPayoutDate(pPay)
    return { period_start: cycle.periodStart, period_end: cycle.periodEnd }
  }
  return { period_start: pStart || pEnd || pPay, period_end: pEnd || pStart || pPay }
}

/**
 * Solapamiento INCLUSIVO entre el periodo de un payout y el rango consultado por el usuario.
 * Ambos rangos son inclusivos (`YYYY-MM-DD`): `period_start <= endDate && period_end >= startDate`.
 * Sin periodo, usa `payout_date` dentro del rango. Ejemplo: corte 10/27–10/31 aparece en 10/31–10/31 y en 10/31–11/02.
 */
export function payoutPeriodOverlapsRange(
  payout: {
    platform?: string | null
    period_start?: string | null
    period_end?: string | null
    payout_date?: string | null
    raw_payload?: Record<string, any> | null
  },
  startDate: string,
  endDate: string
): boolean {
  const effStart = startDate || '2000-01-01'
  const effEnd = endDate || '2099-12-31'
  const resolved = resolveEffectivePayoutPeriod(payout)
  const pEnd = resolved.period_end
  const pStart = resolved.period_start || pEnd
  if (pStart && pEnd) return pStart <= effEnd && pEnd >= effStart
  const pPay = String(payout?.payout_date || '').slice(0, 10)
  if (pPay) return pPay >= effStart && pPay <= effEnd
  return true
}

// =============================================================================
// CONSOLIDACIÓN SEGURA DE FILAS GRUBHUB Y VÍNCULO IDEMPOTENTE DE CRÉDITOS
// =============================================================================

/** IDs de transacciones Grubhub (reembolsos y créditos) absorbidas por la orden consolidada `inp`. */
export function collectGrubhubSupersededTxIds(inp: PlatformOrderInput): string[] {
  const ids = new Set<string>()
  const own = String(inp.platformTransactionId || '').trim()
  for (const list of [inp.rawPayload?.refunds, inp.rawPayload?.recoveries]) {
    if (!Array.isArray(list)) continue
    for (const tx of list) {
      const id = String(tx?.transaction_id || '').trim()
      if (id && id !== own) ids.add(id)
    }
  }
  return Array.from(ids)
}

const CONSOLIDATION_SOURCE_RAW_KEYS = new Set([
  'primary',
  'refunds',
  'recoveries',
  'tax_breakdown_verified',
  'unverified_reason',
  'recovery_credits',
  'consolidated_from_rows',
])

/**
 * Fusiona en la fila consolidada la información de las filas individuales que reemplaza:
 * notas (concatenadas sin duplicar), estado/razón de disputa, vínculo de empaque y Toast, aprobaciones y
 * cualquier dato manual de `raw_payload` ausente en la base, créditos de recuperación (por `credit_id`)
 * y una instantánea completa de cada fila absorbida en `raw_payload.consolidated_from_rows` (trazabilidad).
 */
export function mergeSupersededOrderRows(
  base: Record<string, any> | undefined,
  absorbedRows: Array<Record<string, any>>
): Record<string, any> {
  const merged: Record<string, any> = base
    ? { ...base, raw_payload: { ...(base.raw_payload || {}) } }
    : { is_disputed: false, dispute_status: 'NONE', raw_payload: {} }
  const snapshots: any[] = Array.isArray(merged.raw_payload.consolidated_from_rows)
    ? [...merged.raw_payload.consolidated_from_rows]
    : []
  const nowIso = new Date().toISOString()

  for (const r of absorbedRows || []) {
    const rp = r?.raw_payload || {}
    const rTx = String(r?.platform_transaction_id || '')
    if (r?.is_disputed) merged.is_disputed = true
    const mStatus = String(merged.dispute_status || 'NONE')
    const rStatus = String(r?.dispute_status || 'NONE')
    if ((mStatus === 'NONE' || mStatus === 'NEEDS_DISPUTE') && rStatus !== 'NONE' && rStatus !== 'NEEDS_DISPUTE') {
      merged.dispute_status = rStatus
    }
    const rNotes = String(r?.dispute_notes || '').trim()
    if (rNotes) {
      const mNotes = String(merged.dispute_notes || '').trim()
      if (!mNotes) merged.dispute_notes = rNotes
      else if (!mNotes.includes(rNotes)) merged.dispute_notes = `${mNotes}\n[Consolidado de ${rTx}] ${rNotes}`.slice(0, 1000)
    }
    if (!merged.dispute_reason && r?.dispute_reason) merged.dispute_reason = r.dispute_reason
    if (!merged.packing_audit_id && r?.packing_audit_id) merged.packing_audit_id = r.packing_audit_id
    if (!merged.toast_order_guid && r?.toast_order_guid) {
      merged.toast_order_guid = r.toast_order_guid
      merged.toast_display_number = r.toast_display_number || null
      merged.toast_tab_name = r.toast_tab_name || null
    }
    for (const k of Object.keys(rp)) {
      if (CONSOLIDATION_SOURCE_RAW_KEYS.has(k)) continue
      if (merged.raw_payload[k] === undefined) merged.raw_payload[k] = rp[k]
    }
    const absorbedLedger = getOrderRecoveryCredits(r).filter((c) => c.source !== 'LEGACY_FIELDS')
    if (absorbedLedger.length > 0) {
      merged.raw_payload.recovery_credits = mergeRecoveryCredits(merged.raw_payload.recovery_credits, absorbedLedger)
    }
    if (!snapshots.some((s) => String(s?.platform_transaction_id || '') === rTx)) {
      const { primary: _p, refunds: _r, recoveries: _rc, ...rpLite } = rp
      snapshots.push({
        id: r?.id ?? null,
        platform_transaction_id: rTx,
        platform_order_id: r?.platform_order_id ?? null,
        payout_reference_id: r?.payout_reference_id ?? null,
        payout_date: r?.payout_date ?? null,
        business_date: r?.business_date ?? null,
        transaction_type: r?.transaction_type ?? null,
        error_charge: r?.error_charge ?? null,
        adjustment_amount: r?.adjustment_amount ?? null,
        net_payout: r?.net_payout ?? null,
        reconciliation_status: r?.reconciliation_status ?? null,
        match_confidence: r?.match_confidence ?? null,
        is_disputed: r?.is_disputed ?? null,
        dispute_status: r?.dispute_status ?? null,
        dispute_reason: r?.dispute_reason ?? null,
        dispute_notes: r?.dispute_notes ?? null,
        dispute_amount: r?.dispute_amount ?? null,
        toast_order_guid: r?.toast_order_guid ?? null,
        toast_display_number: r?.toast_display_number ?? null,
        toast_tab_name: r?.toast_tab_name ?? null,
        packing_audit_id: r?.packing_audit_id ?? null,
        raw_payload: rpLite,
        consolidated_at: nowIso,
      })
    }
  }
  merged.raw_payload.consolidated_from_rows = snapshots
  return merged
}

/**
 * Persistencia segura de la conciliación de una tienda (Defecto 5):
 * 1. `upsert` de todas las filas; si falla, lanza el error SIN haber eliminado nada (las filas originales siguen intactas).
 * 2. Lee de DB cada fila consolidada y confirma que existe y que su `raw_payload.consolidated_from_rows`
 *    contiene TODAS las filas que reemplaza; solo entonces elimina esas filas individuales.
 * 3. Elimina las filas sintéticas `TOAST-<guid>` ya conciliadas únicamente después del `upsert` exitoso.
 * 4. Cada mutación valida su error: un fallo de limpieza deja las filas originales (duplicado temporal visible),
 *    nunca registros eliminados sin reemplazo válido.
 */
export async function persistReconciledOrdersWithSafeConsolidation(params: {
  db: any
  storeId: number
  rowsToUpsert: Array<Record<string, any>>
  supersededByConsolidatedTxId: Map<string, string[]>
  synthToastTxIdsToDelete: string[]
}): Promise<{ upserted: number; supersededDeleted: number; synthDeleted: number; warnings: string[] }> {
  const { db, storeId, rowsToUpsert, supersededByConsolidatedTxId, synthToastTxIdsToDelete } = params
  const warnings: string[] = []

  for (let i = 0; i < rowsToUpsert.length; i += 100) {
    const batch = rowsToUpsert.slice(i, i + 100)
    const { error: upErr } = await db
      .from('delivery_platform_orders')
      .upsert(batch, { onConflict: 'store_id,platform,platform_transaction_id' })
    if (upErr) {
      throw new Error(`Error upserting delivery_platform_orders: ${upErr.message}`)
    }
  }

  const upsertedTxIds = new Set(rowsToUpsert.map((r) => String(r.platform_transaction_id || '')))
  const consolidatedIds = Array.from(supersededByConsolidatedTxId.keys())
  const persistedById = new Map<string, Record<string, any>>()
  for (let i = 0; i < consolidatedIds.length; i += 100) {
    const chunk = consolidatedIds.slice(i, i + 100)
    const { data, error } = await db
      .from('delivery_platform_orders')
      .select('platform_transaction_id, raw_payload')
      .eq('store_id', storeId)
      .eq('platform', 'GRUBHUB')
      .in('platform_transaction_id', chunk)
    if (error) {
      warnings.push(`No se pudo confirmar el reemplazo consolidado (${error.message}); se conservan las filas originales.`)
      return { upserted: rowsToUpsert.length, supersededDeleted: 0, synthDeleted: 0, warnings }
    }
    for (const row of data || []) persistedById.set(String(row.platform_transaction_id), row)
  }

  const toDelete: string[] = []
  for (const [consolidatedId, absorbedIds] of supersededByConsolidatedTxId.entries()) {
    const persisted = persistedById.get(consolidatedId)
    const snapshotIds = new Set(
      (Array.isArray(persisted?.raw_payload?.consolidated_from_rows) ? persisted!.raw_payload.consolidated_from_rows : []).map(
        (s: any) => String(s?.platform_transaction_id || '')
      )
    )
    const confirmed = Boolean(persisted) && absorbedIds.every((id) => snapshotIds.has(id))
    if (!confirmed) {
      warnings.push(`#${consolidatedId}: reemplazo no confirmado en DB; se conservan ${absorbedIds.length} fila(s) original(es).`)
      continue
    }
    for (const id of absorbedIds) {
      if (!upsertedTxIds.has(id)) toDelete.push(id)
    }
  }

  let supersededDeleted = 0
  for (let i = 0; i < toDelete.length; i += 100) {
    const chunk = toDelete.slice(i, i + 100)
    const { error, count } = await db
      .from('delivery_platform_orders')
      .delete({ count: 'exact' })
      .eq('store_id', storeId)
      .eq('platform', 'GRUBHUB')
      .in('platform_transaction_id', chunk)
    if (error) warnings.push(`Limpieza de filas consolidadas falló (${error.message}); se conservan como duplicado temporal.`)
    else supersededDeleted += Number(count || 0)
  }

  let synthDeleted = 0
  const synthIds = (synthToastTxIdsToDelete || []).filter((id) => id && !upsertedTxIds.has(id))
  for (let i = 0; i < synthIds.length; i += 100) {
    const chunk = synthIds.slice(i, i + 100)
    const { error, count } = await db
      .from('delivery_platform_orders')
      .delete({ count: 'exact' })
      .eq('store_id', storeId)
      .in('platform_transaction_id', chunk)
    if (error) warnings.push(`Limpieza de filas sintéticas TOAST- falló (${error.message}).`)
    else synthDeleted += Number(count || 0)
  }

  return { upserted: rowsToUpsert.length, supersededDeleted, synthDeleted, warnings }
}

/**
 * Vincula los créditos de recuperación presentes en los settlements de una tienda con su orden original:
 * - Fuente: `raw_payload.cross_payout_refunds` (Uber MISC_ITEM / Grubhub) y `associated_transactions` de Grubhub.
 * - Coincidencia exacta y única por código de orden (excluye la propia fila del crédito y filas TOAST_ONLY);
 *   si hay >1 orden candidata, marca `REQUIRES_REVIEW` sin asignar.
 * - Cada crédito se verifica (`verifyRecoveryCreditAgainstSettlement`) y se fusiona por `credit_id`
 *   (idempotente: repetir la sincronización no duplica créditos ni cambia el saldo pendiente).
 * - NUNCA sobrescribe `dispute_amount` ni el importe original disputado.
 */
export async function linkCrossPayoutRecoveryCreditsForStore(params: {
  db: any
  storeId: number
  storePayouts: Array<Record<string, any>>
}): Promise<{ linkedOrders: number; unchangedOrders: number; ambiguousOrders: number; creditsSeen: number }> {
  const { db, storeId, storePayouts } = params
  const payoutsWithStore = (storePayouts || []).map((p) => ({ ...p, store_id: storeId })) as RecoverySettlementPayoutLike[]
  const grouped = new Map<string, Array<{ payout: RecoverySettlementPayoutLike; entry: SettlementRecoveryCreditEntry }>>()

  for (const payout of payoutsWithStore) {
    const codes = new Set<string>()
    for (const cr of Array.isArray(payout.raw_payload?.cross_payout_refunds) ? payout.raw_payload!.cross_payout_refunds : []) {
      const c = normalizeRecoveryOrderCode(cr?.orderCode)
      if (c) codes.add(c)
    }
    for (const tx of Array.isArray(payout.raw_payload?.associated_transactions) ? payout.raw_payload!.associated_transactions : []) {
      if (!tx?.is_refund && Number(tx?.subtotal || 0) === 0 && Number(tx?.net_amount || 0) > 0) {
        const c = normalizeRecoveryOrderCode(tx?.order_number)
        if (c) codes.add(c)
      }
    }
    for (const code of codes) {
      const key = `${String(payout.platform).toUpperCase()}:${code}`
      const list = grouped.get(key) || []
      for (const entry of extractSettlementRecoveryCreditsForOrder(payout, code)) list.push({ payout, entry })
      grouped.set(key, list)
    }
  }

  let linkedOrders = 0
  let unchangedOrders = 0
  let ambiguousOrders = 0
  let creditsSeen = 0

  for (const [key, items] of grouped.entries()) {
    if (items.length === 0) continue
    creditsSeen += items.length
    const sepIdx = key.indexOf(':')
    const platform = key.slice(0, sepIdx)
    const code = key.slice(sepIdx + 1)
    const { data: candidateRows, error: candErr } = await db
      .from('delivery_platform_orders')
      .select(
        'id, store_id, platform, platform_order_id, platform_transaction_id, payout_reference_id, payout_date, business_date, error_charge, dispute_amount, dispute_status, dispute_notes, is_disputed, reconciliation_status, match_confidence, raw_payload'
      )
      .eq('store_id', storeId)
      .eq('platform', platform)
      .in('platform_order_id', [code, `#${code}`, code.toLowerCase()])
    if (candErr) throw new Error(`Error leyendo órdenes para recuperación #${code}: ${candErr.message}`)

    const creditTxIds = new Set(items.map((it) => it.entry.transaction_id).filter(Boolean) as string[])
    const candidates = (candidateRows || []).filter(
      (r: any) => r.match_confidence !== 'TOAST_ONLY' && !creditTxIds.has(String(r.platform_transaction_id || ''))
    )
    const matchResult = resolveCrossPayoutRecoveryMatch(code, candidates)

    if (matchResult.status === 'AMBIGUOUS_MATCH') {
      for (const ambOrd of matchResult.ambiguousOrders) {
        const { error: ambErr } = await db
          .from('delivery_platform_orders')
          .update({
            reconciliation_status: 'REQUIRES_REVIEW',
            dispute_reason: `Múltiples órdenes (${matchResult.ambiguousOrders.length}) coinciden con el código #${code} del crédito de recuperación en corte posterior; requiere asignación manual única.`,
            raw_payload: {
              ...(ambOrd.raw_payload || {}),
              unverified_reason: 'AMBIGUOUS_RECOVERY_ORDER_MATCH',
              ambiguous_recovery_candidate: items.map((it) => ({
                payoutRef: it.payout.payout_reference_id,
                amount: it.entry.amount,
                transactionId: it.entry.transaction_id,
                depositDate: it.payout.payout_date || null,
              })),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', ambOrd.id)
        if (ambErr) throw new Error(`Error marcando recuperación ambigua #${code}: ${ambErr.message}`)
        ambiguousOrders++
      }
      continue
    }
    if (matchResult.status !== 'UNIQUE_MATCH' || !matchResult.matchedOrder) continue

    const order = matchResult.matchedOrder as Record<string, any>
    const consumed = new Set<string>()
    const incoming: RecoveryCredit[] = []
    for (const it of items) {
      const depositDate = isIsoDateStr(String(it.payout.payout_date || '').slice(0, 10))
        ? String(it.payout.payout_date).slice(0, 10)
        : null
      const res = verifyRecoveryCreditAgainstSettlement({
        order,
        credit: {
          transaction_id: it.entry.transaction_id,
          payout_reference_id: it.payout.payout_reference_id,
          amount: it.entry.amount,
          deposit_date: depositDate,
        },
        payout: it.payout,
        consumedEntryKeys: consumed,
      })
      if (res.verified) consumed.add(it.entry.entry_key)
      incoming.push({
        credit_id: it.entry.entry_key,
        source: 'PLATFORM_SETTLEMENT_CREDIT',
        transaction_id: it.entry.transaction_id,
        payout_reference_id: it.payout.payout_reference_id,
        amount: it.entry.amount,
        deposit_date: depositDate,
        period_start: it.payout.period_start || null,
        period_end: it.payout.period_end || null,
        description: it.entry.description,
        order_code: code,
        verified: res.verified,
        verification_method: res.verified ? 'SETTLEMENT_CREDIT_MATCH' : null,
        verification_issue: res.verified ? null : res.issue,
        settlement_entry_key: res.verified ? it.entry.entry_key : null,
      })
    }

    const prevRaw = order.raw_payload || {}
    const prevLedger: RecoveryCredit[] = Array.isArray(prevRaw.recovery_credits) ? prevRaw.recovery_credits : []
    const newLedger = mergeRecoveryCredits(prevLedger, incoming)
    const original = resolveOriginalDisputedAmount(order)
    const ledgerSignature = (l: RecoveryCredit[]) =>
      JSON.stringify(
        [...l]
          .map((c) => [c.credit_id, round2(Number(c.amount || 0)), Boolean(c.verified), c.payout_reference_id])
          .sort()
      )
    const ledgerUnchanged = ledgerSignature(prevLedger) === ledgerSignature(newLedger)
    const originalAlreadyStored = original.amount === null || Number(prevRaw.original_disputed_amount || 0) > 0
    if (ledgerUnchanged && originalAlreadyStored) {
      unchangedOrders++
      continue
    }

    const latest = [...newLedger].sort((a, b) => String(b.deposit_date || '').localeCompare(String(a.deposit_date || '')))[0]
    const hasVerified = newLedger.some((c) => c.verified === true)
    const currentStatus = String(order.dispute_status || 'NONE').toUpperCase()
    const nextStatus =
      hasVerified && ['NONE', 'NEEDS_DISPUTE', 'OPEN', 'SUBMITTED'].includes(currentStatus) ? 'APPROVED' : order.dispute_status
    const creditsNote = newLedger
      .map((c) => `+$${round2(Number(c.amount || 0)).toFixed(2)} en corte #${c.payout_reference_id}${c.deposit_date ? ` (dep. ${c.deposit_date})` : ''}${c.verified ? '' : ' [pendiente de verificar]'}`)
      .join('; ')
    const autoNote = `Crédito(s) de recuperación en corte(s) posterior(es): ${creditsNote}.`

    const { error: updErr } = await db
      .from('delivery_platform_orders')
      .update({
        is_disputed: true,
        dispute_status: nextStatus,
        dispute_notes: order.dispute_notes || autoNote,
        raw_payload: {
          ...prevRaw,
          recovery_credits: newLedger,
          ...(original.amount !== null
            ? {
                original_disputed_amount: original.amount,
                original_disputed_amount_source: prevRaw.original_disputed_amount_source || original.source,
              }
            : {}),
          // Compatibilidad: describen el crédito más reciente; el total y el desglose viven en `recovery_credits`
          reimbursement_payout_ref: latest?.payout_reference_id || prevRaw.reimbursement_payout_ref || null,
          reimbursement_period:
            latest?.period_start && latest?.period_end ? `${latest.period_start} al ${latest.period_end}` : prevRaw.reimbursement_period || null,
          reimbursement_deposit_date: latest?.deposit_date || prevRaw.reimbursement_deposit_date || null,
          reimbursement_amount: latest ? round2(Number(latest.amount || 0)) : prevRaw.reimbursement_amount || null,
          reimbursement_transaction_id: latest?.transaction_id || null,
          reimbursement_description: latest?.description || prevRaw.reimbursement_description || null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
    if (updErr) throw new Error(`Error vinculando recuperación #${code}: ${updErr.message}`)
    linkedOrders++
  }

  return { linkedOrders, unchangedOrders, ambiguousOrders, creditsSeen }
}
