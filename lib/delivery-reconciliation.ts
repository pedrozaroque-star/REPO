/**
 * @module lib/delivery-reconciliation
 * @description Motor de Conciliación Financiera y Auditoría Orden por Orden de Plataformas de Delivery
 *              (DoorDash, Uber Eats y Grubhub) contra Toast POS para las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * 1. Día Operativo de Tacos Gavilan: Inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente
 *    en zona horaria `America/Los_Angeles`. Toda orden entre 00:00 y 05:59 AM pertenece al `business_date` anterior.
 * 2. Regla Fiscal de Impuestos (Marketplace Sales Tax Rule):
 *    - **DoorDash y Grubhub**: Entregan el Sales Tax a Tacos Gavilan para que nosotros lo declaremos y paguemos
 *      al estado (Cuenta QuickBooks `24001 Marketplace Tax` / atributo Grubhub `MERCHANT_TAX_REMIT`).
 *      Fórmula: `Toast Expected Gross = Toast Net Sales + Toast Tax` vs `Platform Gross = Platform Subtotal + Platform Tax Paid to Merchant`.
 *    - **Uber Eats**: Retiene y paga el Sales Tax directamente al estado como Marketplace Facilitator
 *      (Cuenta QuickBooks `12050 Uber Eats`). Uber NO nos deposita el impuesto.
 *      Fórmula: `Toast Expected Gross = Toast Net Sales` vs `Platform Gross = Platform Subtotal`.
 * 3. Protocolo Toast API:
 *    - NUNCA hardcodear GUIDs de Dining Options; siempre usar `getDiningOptionsMap` por sucursal.
 *    - Calcular Net Sales a nivel de selección (`selections`):
 *      `Sum(Item.Price) - Sum(Item.Discounts) - Sum(Item.Refunds) - Sum(UnlinkedRefunds)`.
 * 4. Ingeniería Inversa Grubhub API:
 *    - Autenticación directa contra `https://api-merchant-gtm.grubhub.com/auth`.
 *    - Extracción en vivo de depósitos (`cortes`) y transacciones orden por orden desde `https://api-order-processing-gtm.grubhub.com/merchant/accounting/...`.
 *
 * @dataFlow
 * - Toast POS (`ordersBulk` + `diningOptions`) -> `fetchToastDeliveryOrdersForStoreAndDates`
 * - Grubhub Merchant Accounting API (`deposits` + `transactions`) -> `syncGrubhubLiveForStore`
 * - DoorDash / Uber Eats / Grubhub CSV & JSON / API -> `parseAndImportPlatformReport`
 * - Motor de Cruce Relacional -> `delivery_platform_orders` & `delivery_platform_payouts` (Supabase)
 *
 * @notes
 * - Prohibido incluir columnas `GENERATED ALWAYS AS` en `INSERT`/`UPDATE` de PostgreSQL.
 */

import { supabaseAdmin } from './supabase'
import { getAuthToken } from './toast-api'
import { extractPlatformOrderIdentity } from './delivery-armor'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function getDiningOptionsMap(token: string, restaurantGuid: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': restaurantGuid,
      },
    })
    if (!res.ok) return {}
    const list = await res.json().catch(() => [])
    const map: Record<string, string> = {}
    if (Array.isArray(list)) {
      for (const opt of list) {
        if (opt?.guid && opt?.name) {
          map[opt.guid] = String(opt.name)
        }
      }
    }
    return map
  } catch {
    return {}
  }
}
const GRUBHUB_AUTH_URL = 'https://api-merchant-gtm.grubhub.com/auth'
const GRUBHUB_ACCOUNTING_HOST = 'https://api-order-processing-gtm.grubhub.com'
const GRUBHUB_CLIENT_ID = 'QhYEEP59t2QhjFCMvYhsvdN655YPsNCWzggzM8VoA3FNUhSQbSrixtNhLfCK8RVf'

export type DeliveryPlatformCode = 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB'

export type ReconciliationStatus =
  | 'MATCHED'
  | 'AMOUNT_MISMATCH'
  | 'TAX_MISMATCH'
  | 'REFUNDED_OR_DISPUTED'
  | 'MISSING_IN_PLATFORM'
  | 'MISSING_IN_TOAST'
  | 'CANCELLED_UNPAID'
  | 'PENDING'

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
}

export interface PlatformOrderInput {
  storeId: number
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
  disputeReason?: string | null
  itemsSummary?: Array<{ name: string; quantity: number; price: number }>
  rawPayload?: Record<string, any>
}

export function round2(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round((val + Number.EPSILON) * 100) / 100
}

/**
 * Convierte un timestamp ISO o fecha a la fecha operativa de Tacos Gavilan (6:00 AM a 5:59 AM America/Los_Angeles).
 */
export function toOperationalBusinessDate(isoOrDateStr: string | null | undefined, fallbackDate?: string): string {
  if (!isoOrDateStr) return fallbackDate || new Date().toISOString().slice(0, 10)
  const trimmed = String(isoOrDateStr).trim()

  // Si ya es YYYY-MM-DD puro sin hora, devolverlo tal cual
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const parsed = new Date(trimmed)
  if (isNaN(parsed.getTime())) {
    // Intentar MM/DD/YYYY
    const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (mdy) {
      const mm = mdy[1].padStart(2, '0')
      const dd = mdy[2].padStart(2, '0')
      return `${mdy[3]}-${mm}-${dd}`
    }
    return fallbackDate || new Date().toISOString().slice(0, 10)
  }

  // Obtener partes en America/Los_Angeles
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(parsed)
  const year = Number(parts.find((p) => p.type === 'year')?.value || 2026)
  const month = Number(parts.find((p) => p.type === 'month')?.value || 1)
  const day = Number(parts.find((p) => p.type === 'day')?.value || 1)
  let hour = Number(parts.find((p) => p.type === 'hour')?.value || 12)
  if (hour === 24) hour = 0

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
  while (curr <= end && guard < 62) {
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
    const ghDigits = cleanTab.match(/#?(\d{10,20})/) || cleanExt.match(/(\d{10,20})/)
    if (ghDigits) return ghDigits[1]
  }

  if (platform === 'DOORDASH') {
    const ddHex = cleanTab.match(/\bDD\s+([A-Za-z0-9]{6,12})\b/i)
    if (ddHex) return ddHex[1].toUpperCase()
    const ddDigits = cleanTab.match(/#(\d{6,20})/) || cleanExt.match(/(\d{6,20})/)
    if (ddDigits) return ddDigits[1]
  }

  if (platform === 'UBER_EATS') {
    const uberCode = cleanTab.match(/\bUBER\s*#?([A-Za-z0-9]{4,10})\b/i)
    if (uberCode) return uberCode[1].toUpperCase()
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

  for (const bDate of businessDates) {
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
        if (order.voided || order.deleted) continue

        const dOptionRaw = diningMap[order.diningOption?.guid] || order.diningOption?.name || ''
        const dService = order.deliveryService || ''
        const sourceRaw = order.source || ''
        const optName = `${dService} ${dOptionRaw} ${sourceRaw}`.toLowerCase()

        let platform: DeliveryPlatformCode | null = null
        if (optName.includes('uber') || optName.includes('postmates')) {
          platform = 'UBER_EATS'
        } else if (optName.includes('doordash') || optName.includes('dash')) {
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
        let primaryTabName = ''
        const itemsSummary: Array<{ name: string; quantity: number; price: number }> = []

        for (const check of order.checks || []) {
          if (check.voided || check.deleted) continue
          if (!primaryTabName && check.tabName) {
            primaryTabName = String(check.tabName).trim()
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

          let checkNet = checkItemNetSum - checkItemRefunds

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
        if (orderNetSales <= 0 && orderTaxAmount <= 0) continue

        const expectedGross = calculateToastExpectedGross(platform, orderNetSales, orderTaxAmount)
        const extractedPlatformId = parseToastTabPlatformOrderId(
          platform,
          primaryTabName,
          order.externalId,
          order
        )

        results.push({
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
        })
      }

      if (orders.length < 100) {
        hasMore = false
      } else {
        page++
      }
    }
  }

  return results
}

/**
 * Autenticación directa con Grubhub for Restaurants API.
 */
let cachedGrubhubToken: { token: string; expiresAt: number } | null = null

export async function getGrubhubMerchantToken(): Promise<string> {
  if (cachedGrubhubToken && Date.now() < cachedGrubhubToken.expiresAt) {
    return cachedGrubhubToken.token
  }

  const email = process.env.GRUBHUB_MERCHANT_EMAIL || 'erick@tacosgavilan.com'
  const password = process.env.GRUBHUB_MERCHANT_PASSWORD || 'Gavilan@323'

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
      client_id: GRUBHUB_CLIENT_ID,
      email,
      password,
    }),
  })

  if (!res.ok) {
    throw new Error(`Grubhub Auth Error (${res.status}): ${await res.text()}`)
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
  // Para depósitos, ampliamos ventana [-10 días, +14 días] para encontrar el corte semanal donde se pagaron esas órdenes
  const depStartIso = `${addDaysToDateStr(startDate, -10)}T00:00:00.000Z`
  const depEndIso = `${addDaysToDateStr(endDate, 14)}T23:59:59.999Z`

  const [txRes, depSumRes] = await Promise.all([
    fetch(
      `${GRUBHUB_ACCOUNTING_HOST}/merchant/accounting/v1/${custId}/transactions?timeZone=America/Los_Angeles&channelGroup=MARKETPLACE&startDate=${startDate}&endDate=${queryEndDate}`,
      { headers: ghHeaders }
    ),
    fetch(
      `${GRUBHUB_ACCOUNTING_HOST}/merchant/accounting/customers/${custId}/deposits/summary?startTime=${encodeURIComponent(
        depStartIso
      )}&endTime=${encodeURIComponent(depEndIso)}`,
      { headers: ghHeaders }
    ),
  ])

  const txData = txRes.ok ? await txRes.json().catch(() => []) : []
  const depSumData = depSumRes.ok ? await depSumRes.json().catch(() => ({})) : {}

  const rawTransactions: any[] = Array.isArray(txData)
    ? txData
    : Array.isArray(txData?.transactions)
    ? txData.transactions
    : []
  const rawDeposits: any[] = Array.isArray(depSumData)
    ? depSumData
    : Array.isArray(depSumData?.[custId])
    ? depSumData[custId]
    : Array.isArray(depSumData?.deposits)
    ? depSumData.deposits
    : []

  // Mapear qué transacción/orden fue pagada en qué depósito (corte)
  const orderToDepositMap = new Map<string, { payoutRef: string; payoutDate: string; bankLast4: string }>()
  const payouts: Array<Record<string, any>> = []

  for (const dep of rawDeposits) {
    const distId = String(dep.restaurant_distribution_id || '')
    if (!distId) continue

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

    for (const atx of assocTxs) {
      const ordNum = String(atx.order_number || '').trim()
      const txId = String(atx.transaction_id || '').trim()
      if (ordNum) {
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

      if (atx.is_refund || atx.order_channel === 'ADJUSTMENT') {
        sumErrorCents += Number(atx.net_amount || 0)
      } else if (atx.order_channel === 'MISCELLANEOUS') {
        sumAdjCents += Number(atx.net_amount || 0)
      } else {
        sumSubtotalCents += Number(atx.subtotal || 0)
        sumTaxCents += Number(atx.restaurant_sales_tax || 0)
        sumWithheldTaxCents += Math.abs(Number(atx.withheld_sales_tax || 0))
        sumGrossCents += Number(atx.restaurant_total || 0)
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

    payouts.push({
      store_id: mapping.store_id,
      platform: 'GRUBHUB',
      payout_reference_id: dep.short_distribution_id || distId,
      period_start: minDate || effectiveDate,
      period_end: maxDate || effectiveDate,
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
      raw_payload: detailData || dep,
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
    const primaryTx = txList.find((t) => !t.is_refund && t.order_channel !== 'ADJUSTMENT') || txList[0]
    const refundTxs = txList.filter((t) => t !== primaryTx && (t.is_refund || t.order_channel === 'ADJUSTMENT'))

    const placedAt = primaryTx.placed_at_time || primaryTx.transaction_time || null
    const businessDate = toOperationalBusinessDate(placedAt, primaryTx.business_date || startDate)

    // Filtrar solo órdenes dentro del rango operativo solicitado [startDate, endDate]
    if (businessDate < startDate || businessDate > endDate) {
      continue
    }

    const subtotal = round2(Number(primaryTx.subtotal || 0) / 100)
    const tax = round2(
      (Number(primaryTx.restaurant_sales_tax || 0) + Number(primaryTx.delivery_sales_tax || 0)) / 100
    )
    const taxWithheld = round2(Math.abs(Number(primaryTx.withheld_sales_tax || 0)) / 100)
    const taxPaidToMerchant = round2(tax - taxWithheld)
    const grossReceivable = round2(
      Number(primaryTx.restaurant_total ?? (subtotal + taxPaidToMerchant) * 100) / 100
    )

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
    const adjustmentAmount = 0
    let netPayout = round2(Number(primaryTx.net_amount || 0) / 100)

    if (primaryTx.is_refund || primaryTx.order_channel === 'ADJUSTMENT') {
      errorCharge = round2(Number(primaryTx.net_amount || 0) / 100)
    }

    for (const rtx of refundTxs) {
      const rNet = round2(Number(rtx.net_amount || 0) / 100)
      errorCharge = round2(errorCharge + rNet)
      netPayout = round2(netPayout + rNet)
    }

    const depInfo =
      orderToDepositMap.get(String(primaryTx.order_number || '')) ||
      orderToDepositMap.get(String(primaryTx.transaction_id || ''))

    const fulfillmentType: 'DELIVERY' | 'PICKUP' =
      primaryTx.delivery === false ||
      String(primaryTx.delivery_type || '').toUpperCase().includes('PICKUP')
        ? 'PICKUP'
        : 'DELIVERY'

    const hasRefund = primaryTx.is_refund || refundTxs.length > 0 || errorCharge < -0.01

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
      transactionType: hasRefund ? 'REFUND' : 'ORDER',
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
        : null,
      rawPayload: { primary: primaryTx, refunds: refundTxs },
    })
  }

  return { orders, payouts }
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
  defaultStoreId?: number
): {
  detectedPlatform: DeliveryPlatformCode
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
} {
  const orders: PlatformOrderInput[] = []
  const payoutsMap = new Map<string, Record<string, any>>()

  const resolveDdStore = (ddStoreId?: string | number | null, storeName?: string | null): number => {
    if (ddStoreId !== undefined && ddStoreId !== null) {
      const m = byDoorDashStoreId.get(String(ddStoreId).trim())
      if (m) return m.store_id
    }
    if (storeName) {
      const lower = storeName.toLowerCase()
      if (lower.includes('imperial') || lower.includes('lynwood')) return 14
      if (lower.includes('firestone') || lower.includes('south gate')) return 15
      if (lower.includes('bell') || lower.includes('4406')) return 13
      if (lower.includes('huntington') || lower.includes('2425')) return 11
      if (lower.includes('downey') || lower.includes('7947')) return 16
      if (lower.includes('norwalk') || lower.includes('rosecrans')) return 12
      if (lower.includes('la puente') || lower.includes('valley')) return 10
      if (lower.includes('santa ana') || lower.includes('17th')) return 9
      if (lower.includes('hollywood') || lower.includes('sunset')) return 8
      if (lower.includes('slauson') || lower.includes('5833')) return 7
      if (lower.includes('central') || lower.includes('1900')) return 6
      if (lower.includes('broadway') || lower.includes('4380')) return 5
      if (lower.includes('azusa') && lower.includes('887')) return 4
      if (lower.includes('west covina') || lower.includes('101')) return 3
      if (lower.includes('rialto') || lower.includes('baseline')) return 1
    }
    return defaultStoreId || 14
  }

  // 1. Procesar `summariesList` (payout_summaries)
  if (Array.isArray(payload.summariesList)) {
    for (const s of payload.summariesList) {
      const payoutRef = String(s.payoutId || '').trim()
      if (!payoutRef) continue
      const storeId = resolveDdStore(s.storeId)
      const payoutDate = toOperationalBusinessDate(s.payoutDate)
      const grossSales = parseCurrencyVal(s.sales)
      const amendments = parseCurrencyVal(s.amendments)
      const commAndFees = parseCurrencyVal(s.commissionAndFees)
      const mktSpend = parseCurrencyVal(s.marketingSpend)
      const netPayout = parseCurrencyVal(s.netPayout)
      const approxTax = round2(grossSales - grossSales / 1.1025)
      const approxSubtotal = round2(grossSales - approxTax)

      payoutsMap.set(`${storeId}:${payoutRef}`, {
        store_id: storeId,
        platform: 'DOORDASH',
        payout_reference_id: payoutRef,
        period_start: addDaysToDateStr(payoutDate, -9),
        period_end: addDaysToDateStr(payoutDate, -3),
        payout_date: payoutDate,
        orders_count: 0,
        subtotal_sales: approxSubtotal,
        tax_collected: approxTax,
        tax_remitted_by_platform: 0,
        tax_paid_to_merchant: approxTax,
        platform_gross_receivable: grossSales,
        commission_fees: commAndFees > 0 ? -commAndFees : commAndFees,
        delivery_fees: 0,
        processing_fees: 0,
        marketing_fees: mktSpend > 0 ? -mktSpend : mktSpend,
        error_charges: amendments < 0 ? amendments : 0,
        adjustments_amount: amendments > 0 ? amendments : 0,
        tips_amount: 0,
        net_payout_amount: netPayout,
        status: s.payoutStatus === 2 ? 'POSTED' : 'PENDING',
        source_type: 'API',
        raw_payload: s,
      })
    }
  }

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
      const payoutId = String(actionData.payoutId || payload.payoutId || '').trim() || null
      const channelStr = getVal(5)
      const storeName = getVal(6)
      const txTypeStr = getVal(7).toUpperCase()
      const description = getVal(8)

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

      const storeId = resolveDdStore(ddStoreId, storeName)
      let placedIso: string | null = null
      let businessDate = toOperationalBusinessDate(dateStr)

      if (dateStr && timeStr) {
        const parsedLocal = new Date(`${dateStr} ${timeStr}`)
        if (!isNaN(parsedLocal.getTime())) {
          placedIso = parsedLocal.toISOString()
          const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
          if (m) {
            let hr = parseInt(m[1], 10)
            const ampm = m[3].toUpperCase()
            if (ampm === 'PM' && hr < 12) hr += 12
            if (ampm === 'AM' && hr === 12) hr = 0
            if (hr < 6) {
              businessDate = addDaysToDateStr(businessDate, -1)
            }
          }
        }
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

      orders.push({
        storeId,
        platform: 'DOORDASH',
        businessDate,
        placedAt: placedIso,
        platformOrderId: orderShortCode || deliveryUuid.slice(0, 8) || txId,
        platformTransactionId: txId || deliveryUuid || `${orderShortCode}-${dateStr}`,
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
        disputeReason:
          errorCharge < -0.01 || transactionType === 'ERROR_CHARGE'
            ? description || 'DoorDash Error Charge / Ajuste a Cliente'
            : null,
        rawPayload: { cells: txCells, deliveryUuid, payoutId },
      })
    }
  }

  // 3. Procesar `orders` (get_orders)
  if (Array.isArray(payload.orders)) {
    for (const o of payload.orders) {
      const shortCode = String(o.deliveryShortCode || o.orderId || '').trim()
      const deliveryUuid = String(o.deliveryUuid || shortCode).trim()
      if (!shortCode && !deliveryUuid) continue
      const storeId = resolveDdStore(o.store?.id ?? o.storeId, o.store?.name ?? o.storeName)
      const placedAt = o.createdAt || o.storeOrderConfirmedTime || o.pickupTime || null
      const businessDate = toOperationalBusinessDate(placedAt)
      const subtotal = parseCurrencyVal(
        o.subtotal ?? o.orderValue?.displayString ?? (o.orderValue?.unitAmount ? o.orderValue.unitAmount / 100 : 0)
      )
      const tax =
        o.taxAmount !== undefined && o.taxAmount !== null
          ? parseCurrencyVal(o.taxAmount)
          : round2(subtotal * 0.1025)
      const grossReceivable = round2(subtotal + tax)
      const netPayout =
        o.netPayout !== undefined && o.netPayout !== null
          ? parseCurrencyVal(o.netPayout)
          : round2(grossReceivable - subtotal * 0.2)
      const estComm = round2(netPayout - grossReceivable)

      const isCancelled =
        Boolean(o.cancelledOrderCategory) ||
        String(o.orderStatusValue || '').toUpperCase().includes('CANCEL')
      const hasError = Boolean(o.containsErrorCharge)
      const fTypeRaw = String(
        o.orderFilterType || o.fulfillmentDetails?.fulfillmentType || ''
      ).toUpperCase()

      orders.push({
        storeId,
        platform: 'DOORDASH',
        businessDate,
        placedAt,
        platformOrderId: shortCode || deliveryUuid.slice(0, 8),
        platformTransactionId: deliveryUuid,
        payoutReferenceId: null,
        payoutDate: null,
        fulfillmentType: fTypeRaw.includes('PICKUP') ? 'PICKUP' : 'DELIVERY',
        transactionType: isCancelled ? 'CANCELLATION' : hasError ? 'ERROR_CHARGE' : 'ORDER',
        platformSubtotal: subtotal,
        platformTax: tax,
        platformTaxWithheld: 0,
        platformTaxPaidToMerchant: tax,
        platformGrossReceivable: grossReceivable,
        commissionFee: estComm < 0 ? estComm : 0,
        deliveryFee: 0,
        processingFee: 0,
        marketingFee: 0,
        errorCharge: hasError && estComm < 0 ? estComm : 0,
        adjustmentAmount: 0,
        tipAmount: 0,
        netPayout,
        disputeReason: hasError
          ? 'Orden con Error Charge reportado en DoorDash'
          : isCancelled
          ? `Orden cancelada (${o.cancelledOrderCategory || o.orderStatusDisplay || 'CANCELLED'})`
          : null,
        rawPayload: o,
      })
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
  defaultStoreId?: number
): {
  detectedPlatform: DeliveryPlatformCode
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
} {
  const orders: PlatformOrderInput[] = []
  const payouts: Array<Record<string, any>> = []

  const resolveUberStore = (locUuid?: string | null, orgUuid?: string | null, name?: string | null): number => {
    if (locUuid) {
      const m = byUberUuid.get(String(locUuid).trim().toLowerCase())
      if (m) return m.store_id
    }
    if (orgUuid) {
      const m = byUberOrgUuid.get(String(orgUuid).trim().toLowerCase())
      if (m) return m.store_id
    }
    if (name) {
      const lower = name.toLowerCase()
      if (lower.includes('imperial') || lower.includes('lynwood')) return 14
      if (lower.includes('firestone') || lower.includes('south gate')) return 15
      if (lower.includes('bell') || lower.includes('4406')) return 13
      if (lower.includes('huntington') || lower.includes('2425')) return 11
      if (lower.includes('downey') || lower.includes('7947')) return 16
      if (lower.includes('norwalk') || lower.includes('rosecrans')) return 12
      if (lower.includes('la puente') || lower.includes('valley')) return 10
      if (lower.includes('santa ana') || lower.includes('17th')) return 9
      if (lower.includes('hollywood') || lower.includes('sunset')) return 8
      if (lower.includes('slauson') || lower.includes('5833')) return 7
      if (lower.includes('central') || lower.includes('1900')) return 6
      if (lower.includes('broadway') || lower.includes('4380')) return 5
      if (lower.includes('azusa') && lower.includes('887')) return 4
      if (lower.includes('west covina') || lower.includes('101')) return 3
      if (lower.includes('rialto') || lower.includes('baseline')) return 1
    }
    return defaultStoreId || 14
  }

  // 1. Procesar `payPeriods` (`listPayoutsHistory` + `getEarningsBreakdown`)
  if (Array.isArray(uberRoot.payPeriods)) {
    for (const p of uberRoot.payPeriods) {
      const settlementRef = String(p.transactionID || p.settlementUUID || '').trim()
      if (!settlementRef) continue
      const storeId = resolveUberStore(uberRoot.locationUuid, uberRoot.orgUUID)
      const earnings = parseCurrencyVal(p.earnings) // Includes subtotal + tax + tips
      const marketing = parseCurrencyVal(p.marketing)
      const uberFees = parseCurrencyVal(p.uberFees)
      const amendments = parseCurrencyVal(p.amendments) // Tax withheld + adjustments + chargebacks
      const netPayout = parseCurrencyVal(p.netPayout)

      let subtotalSales = 0
      let taxCollected = 0
      let taxRemittedByPlatform = 0
      let tipsAmount = 0
      let errorCharges = 0
      let adjustmentsAmount = 0
      let ordersCount = 0
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

            if (cat === 'SubtotalExclTax') subtotalSales = round2(Math.abs(amt))
            else if (cat === 'TaxOnSubtotal') taxCollected = round2(Math.abs(amt))
            else if (cat === 'Tips') tipsAmount = round2(Math.abs(amt))
            else if (cat === 'MarketplaceFacilitatorTax') taxRemittedByPlatform = round2(Math.abs(amt))
            else if (cat === 'Chargebacks') errorCharges = amt > 0 ? -amt : amt
            else if (cat === 'ChargebacksExclTax' && errorCharges === 0) errorCharges = amt > 0 ? -amt : amt
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

      if (subtotalSales <= 0) {
        const approxTax = Math.abs(amendments)
        taxCollected = approxTax
        taxRemittedByPlatform = approxTax
        subtotalSales = round2(earnings - approxTax)
      }

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
        subtotal_sales: subtotalSales > 0 ? subtotalSales : earnings,
        tax_collected: taxCollected,
        tax_remitted_by_platform: taxRemittedByPlatform,
        tax_paid_to_merchant: 0,
        platform_gross_receivable:
          taxRemittedByPlatform > 0
            ? round2(earnings - taxRemittedByPlatform)
            : subtotalSales > 0
            ? subtotalSales
            : earnings,
        commission_fees: uberFees > 0 ? -uberFees : uberFees,
        delivery_fees: 0,
        processing_fees: 0,
        marketing_fees: marketing > 0 ? -marketing : marketing,
        error_charges: errorCharges,
        adjustments_amount: adjustmentsAmount,
        tips_amount: tipsAmount,
        net_payout_amount: netPayout,
        status: isSettled ? 'POSTED' : 'PENDING',
        source_type: 'API',
        raw_payload: {
          ...p,
          cross_payout_refunds: crossPayoutRefunds,
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
      const storeId = resolveUberStore(r.locationUuid || uberRoot.locationUuid, r.orgUUID || uberRoot.orgUUID)

      const fareMap = new Map<string, number>()
      if (Array.isArray(r.fareLineItems)) {
        for (const item of r.fareLineItems) {
          if (item?.fareDescription) {
            fareMap.set(String(item.fareDescription), parseCurrencyVal(item.amount))
          }
        }
      }

      const subtotal = fareMap.get('salesExclTax') ?? 0
      const taxOnSales = fareMap.get('taxOnSales') ?? 0
      const uberFees = fareMap.get('uberFees') ?? 0
      const chargebacks = fareMap.get('chargebacks') ?? 0
      const otherAmendments = fareMap.get('otherAmendments') ?? -taxOnSales
      const netPayout = parseCurrencyVal(r.netPayout)

      // Uber Eats retiene el 100% del Sales Tax (otherAmendments = -taxOnSales)
      const taxWithheld = taxOnSales
      const taxPaidToMerchant = 0
      const grossReceivable = subtotal
      // Si otherAmendments difiere de -taxOnSales, la diferencia es un ajuste adicional
      const extraAdjustment = round2(otherAmendments + taxOnSales)

      let placedIso: string | null = null
      let businessDate = toOperationalBusinessDate(r.dateTime)
      if (r.dateTime) {
        const parsed = new Date(r.dateTime)
        if (!isNaN(parsed.getTime())) {
          placedIso = parsed.toISOString()
          const timeMatch = String(r.dateTime).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
          if (timeMatch) {
            let hr = parseInt(timeMatch[1], 10)
            const ampm = timeMatch[3].toUpperCase()
            if (ampm === 'PM' && hr < 12) hr += 12
            if (ampm === 'AM' && hr === 12) hr = 0
            const ymd = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(
              parsed.getDate()
            ).padStart(2, '0')}`
            businessDate = hr < 6 ? addDaysToDateStr(ymd, -1) : ymd
          }
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
        payoutReferenceId: r.settlementUUID || uberRoot.settlementUUID || null,
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
        disputeReason: hasChargeback
          ? 'Reembolso / Chargeback en Uber Eats'
          : statusUpper.includes('UNFULFILLED')
          ? 'Orden no completada (UNFULFILLED)'
          : null,
        rawPayload: r,
      })
    }
  }

  // 3. Procesar `orders` (`getHistoricOrders`)
  if (Array.isArray(uberRoot.orders)) {
    for (const o of uberRoot.orders) {
      const shortCode = String(o.orderId || o.shortCode || '').trim()
      const uuid = String(o.workflowUuid || o.orderUuid || o.uuid || shortCode).trim()
      if (!shortCode && !uuid) continue
      const storeId = resolveUberStore(
        o.restaurant?.uuid || o.location?.uuid || uberRoot.locationUuid,
        uberRoot.orgUUID,
        o.restaurant?.name || o.location?.name
      )
      const rawPlaced = o.requestedAt || o.orderTimestamp || null
      let placedIso: string | null = null
      let businessDate = toOperationalBusinessDate(rawPlaced)

      if (rawPlaced) {
        const parsed = new Date(rawPlaced)
        if (!isNaN(parsed.getTime())) {
          placedIso = parsed.toISOString()
          // `requestedAt` viene en hora local de la tienda (ej. "10/27/2026, 11:59 PM")
          const localMatch = String(rawPlaced).match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i
          )
          if (localMatch) {
            const mm = localMatch[1].padStart(2, '0')
            const dd = localMatch[2].padStart(2, '0')
            const yyyy = localMatch[3]
            let hr = parseInt(localMatch[4], 10)
            const ampm = localMatch[6].toUpperCase()
            if (ampm === 'PM' && hr < 12) hr += 12
            if (ampm === 'AM' && hr === 12) hr = 0
            const ymd = `${yyyy}-${mm}-${dd}`
            businessDate = hr < 6 ? addDaysToDateStr(ymd, -1) : ymd
          }
        }
      }

      // En `getHistoricOrders`, `salesTotal` es el subtotal sin tax (ej. "$59.69")
      const hasSalesTotal = o.salesTotal !== undefined && o.salesTotal !== null && String(o.salesTotal).trim() !== ''
      const rawSales = hasSalesTotal ? parseCurrencyVal(o.salesTotal) : parseCurrencyVal(o.orderTotal)
      const subtotal = hasSalesTotal ? rawSales : round2(rawSales / 1.1025)
      const approxTax = hasSalesTotal ? round2(subtotal * 0.1025) : round2(rawSales - subtotal)
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
      const commissionFee =
        subtotal > 0 ? round2(netPayout - subtotal - errorCharge) : 0

      // Vincular con el corte semanal (`payout`) si cae dentro de su rango de fechas
      const matchingPayout = payouts.find(
        (pay) =>
          pay.store_id === storeId &&
          pay.period_start &&
          pay.period_end &&
          businessDate >= pay.period_start &&
          businessDate <= pay.period_end
      )

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
        payoutReferenceId: matchingPayout?.payout_reference_id || null,
        payoutDate: matchingPayout?.payout_date || null,
        fulfillmentType: String(o.fulfillmentType || '').toUpperCase().includes('PICKUP')
          ? 'PICKUP'
          : 'DELIVERY',
        transactionType: hasIssue
          ? 'ERROR_CHARGE'
          : isCancelled
          ? 'CANCELLATION'
          : 'ORDER',
        platformSubtotal: subtotal,
        platformTax: approxTax,
        platformTaxWithheld: approxTax,
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
        disputeReason: hasIssue
          ? `Uber Eats Disputa/Error: ${o.issueType || 'Chargeback'} ${
              o.issueItemsInvolvedFormatted ? `(${o.issueItemsInvolvedFormatted})` : ''
            }`.trim()
          : isCancelled
          ? `Orden cancelada/perdida en Uber Eats (${o.canceledBy || o.missedBy || statusUpper})`
          : null,
        itemsSummary: itemsSummary.length > 0 ? itemsSummary : undefined,
        rawPayload: o,
      })
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
  defaultStoreId?: number
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
      return parseDoorDashNativeApiObject(parsedJson, mappings, byDoorDashStoreId, defaultStoreId)
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
      return parseUberEatsNativeApiObject(uberRoot, mappings, byUberUuid, byUberOrgUuid, defaultStoreId)
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

  const resolveStoreId = (row: Record<string, any>): number => {
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
      if (byDoorDashStoreId.has(extStoreId)) return byDoorDashStoreId.get(extStoreId)!.store_id
      if (byGrubhubCustId.has(extStoreId)) return byGrubhubCustId.get(extStoreId)!.store_id
      if (byUberUuid.has(extStoreId.toLowerCase())) return byUberUuid.get(extStoreId.toLowerCase())!.store_id
      const numId = Number(extStoreId)
      if (mappings.some((m) => m.store_id === numId)) return numId
    }

    const storeNameVal = findColumnValue(row, ['Store Name', 'store_name', 'Restaurant Name', 'Location']).toLowerCase()
    if (storeNameVal) {
      for (const m of mappings) {
        if (
          storeNameVal.includes(m.store_name.toLowerCase()) ||
          storeNameVal.includes(m.store_code.toLowerCase())
        ) {
          return m.store_id
        }
      }
      if (storeNameVal.includes('imperial') || storeNameVal.includes('lynwood')) return 14
      if (storeNameVal.includes('firestone') || storeNameVal.includes('south gate')) return 15
      if (storeNameVal.includes('bell') || storeNameVal.includes('4406')) return 13
      if (storeNameVal.includes('huntington') || storeNameVal.includes('2425')) return 11
      if (storeNameVal.includes('downey') || storeNameVal.includes('7947')) return 16
      if (storeNameVal.includes('norwalk') || storeNameVal.includes('rosecrans')) return 12
      if (storeNameVal.includes('la puente') || storeNameVal.includes('valley')) return 10
      if (storeNameVal.includes('santa ana') || storeNameVal.includes('17th')) return 9
      if (storeNameVal.includes('hollywood') || storeNameVal.includes('sunset')) return 8
      if (storeNameVal.includes('slauson') || storeNameVal.includes('5833')) return 7
      if (storeNameVal.includes('central') || storeNameVal.includes('1900')) return 6
      if (storeNameVal.includes('broadway') || storeNameVal.includes('4380')) return 5
      if (storeNameVal.includes('azusa') && storeNameVal.includes('887')) return 4
      if (storeNameVal.includes('west covina') || storeNameVal.includes('101')) return 3
      if (storeNameVal.includes('rialto') || storeNameVal.includes('baseline')) return 1
    }

    return defaultStoreId || 14
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
    const storeId = resolveStoreId(row)

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

    const subtotal = parseCurrencyVal(
      findColumnValue(row, [
        'Subtotal',
        'Sales (excl. tax)',
        'Food Sales (excl. tax)',
        'subtotal',
        'Order Subtotal',
      ])
    )
    const taxTotal = parseCurrencyVal(
      findColumnValue(row, [
        'Tax',
        'Subtotal Tax Passed by DoorDash to Merchant',
        'Tax (subtotal)',
        'Tax on Sales',
        'Sales Tax',
        'restaurant_sales_tax',
      ])
    )
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

    // Aplicar regla fiscal de Tacos Gavilan
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
      placedAt: null,
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
      disputeReason:
        errorCharge < -0.01
          ? findColumnValue(row, ['Description', 'Error reason', 'Adjustment reason', 'Transaction type']) ||
            'Cargo por error / Reembolso en plataforma'
          : null,
      rawPayload: row,
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

  const payouts = Array.from(payoutsAccumulator.values()).map((p) => ({
    ...p,
    status: 'POSTED',
    source_type: 'CSV_IMPORT',
  }))

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

/**
 * Extrae en vivo DoorDash (payout_summaries + payout_transactions) y Uber Eats (listPayoutsHistory + getEarningsBreakdown + getHistoricOrders)
 * directamente desde las sesiones autenticadas de Chrome DevTools locales cuando están activas.
 */
async function fetchChromeLiveDoorDashAndUberForStores(
  targetMappings: StorePlatformMapping[],
  allMappings: StorePlatformMapping[],
  startDate: string,
  endDate: string
): Promise<{
  orders: PlatformOrderInput[]
  payouts: Array<Record<string, any>>
  extraBusinessDates: string[]
}> {
  const orders: PlatformOrderInput[] = []
  const payouts: Array<Record<string, any>> = []
  const extraBusinessDatesSet = new Set<string>()

  try {
    const fs = await import('fs')
    const portFile = 'C:/Users/pedro/AppData/Local/Google/Chrome/User Data/DevToolsActivePort'
    if (!fs.existsSync(portFile)) return { orders, payouts, extraBusinessDates: [] }

    const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
    if (lines.length < 2) return { orders, payouts, extraBusinessDates: [] }
    const wsUrl = `ws://127.0.0.1:${lines[0]}${lines[1]}`

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

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl)
      let msgId = 1
      const globalTimer = setTimeout(() => {
        try {
          ws.close()
        } catch {}
        resolve()
      }, 45000)

      const send = (method: string, params: any = {}, sessionId?: string): Promise<any> =>
        new Promise((res, rej) => {
          const cur = msgId++
          const t = setTimeout(() => rej(new Error(`CDP Timeout: ${method}`)), 20000)
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
        try {
          const { targetInfos } = await send('Target.getTargets')
          const uberTab = (targetInfos || []).find((t: any) =>
            String(t.url || '').includes('merchants.ubereats.com')
          )
          const ddTab = (targetInfos || []).find((t: any) =>
            String(t.url || '').includes('merchant-portal.doordash.com')
          )

          // Limitar a las primeras 3 tiendas en una corrida interactiva para respuesta rápida
          const storesToPull = targetMappings.slice(0, 3)

          if (uberTab) {
            const { sessionId: uberSession } = await send('Target.attachToTarget', {
              targetId: uberTab.targetId,
              flatten: true,
            })

            for (const m of storesToPull) {
              if (!m.ubereats_store_uuid) continue
              const locUuid = String(m.ubereats_store_uuid).trim()
              const orgUuid =
                m.ubereats_org_uuid || UBER_STORE_TO_ORG_UUID_MAP[locUuid.toLowerCase()] || locUuid

              // 1. Extraer cortes semanales (`listPayoutsHistory`) + árbol contable (`getEarningsBreakdown`)
              // para detectar reembolsos en otros cortes (ej. "Goodwill OE Refund #650DD 20260928")
              const payoutsEval = await send(
                'Runtime.evaluate',
                {
                  expression: `(async () => {
                    document.cookie = 'selectedRestaurant=' + ${JSON.stringify(locUuid)} + '; path=/';
                    const postApi = async (ep, body) => {
                      const r = await fetch('/manager/api/' + ep + '?localeCode=en', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'x' },
                        body: JSON.stringify(body)
                      });
                      return await r.json().catch(() => ({}));
                    };
                    const payRes = await postApi('listPayoutsHistory', {
                      orgUUIDs: [${JSON.stringify(orgUuid)}],
                      isOngoingSettlementRequired: false,
                      locale: 'en',
                      startDate: '2026-09-14',
                      endDate: ${JSON.stringify(endDate)},
                      pagination: { pageSize: 12, offset: 0 }
                    });
                    const payPeriods = payRes?.data?.payPeriods || [];
                    const toIso = (str) => {
                      const d = new Date(str);
                      if (Number.isNaN(d.getTime())) return null;
                      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                    };
                    const refundDates = [];
                    const enrichedPeriods = await Promise.all(payPeriods.map(async (p) => {
                      const sIso = toIso(p.periodStartDate);
                      const eIso = toIso(p.periodEndDate);
                      let breakdown = null;
                      if (sIso && eIso && p.settlementUUID) {
                        const eb = await postApi('getEarningsBreakdown', {
                          orgUUIDs: [${JSON.stringify(orgUuid)}],
                          startDate: sIso,
                          endDate: eIso,
                          locale: 'en',
                          settlementUUID: p.settlementUUID
                        });
                        breakdown = eb?.data || null;
                        const walk = (nodes) => {
                          for (const n of nodes || []) {
                            const cat = n?.categoryName?.text || '';
                            const desc = n?.displayText?.description?.text || '';
                            const amt = Number(n?.categoryAmount || 0);
                            if (cat === 'MISC_ITEM' && amt > 0 && desc) {
                              const mDate = desc.match(/\\b(20\\d{2})(\\d{2})(\\d{2})\\b/);
                              if (mDate) refundDates.push(mDate[1] + '-' + mDate[2] + '-' + mDate[3]);
                            }
                            if (Array.isArray(n?.childSummaryNodes)) walk(n.childSummaryNodes);
                          }
                        };
                        if (breakdown?.taxonomyNodes) walk(breakdown.taxonomyNodes);
                      }
                      return { ...p, startIso: sIso, endIso: eIso, breakdown };
                    }));
                    return { enrichedPeriods, refundDates };
                  })()`,
                  awaitPromise: true,
                  returnByValue: true,
                },
                uberSession
              ).catch(() => null)

              const payVal = payoutsEval?.result?.value
              const enrichedPeriods = Array.isArray(payVal?.enrichedPeriods) ? payVal.enrichedPeriods : []
              const discoveredRefundDates: string[] = Array.isArray(payVal?.refundDates) ? payVal.refundDates : []

              // 2. Construir ventanas de fechas para consultar `getHistoricOrders` (rango principal + fechas históricas con reembolso en corte posterior)
              const dateWindows: Array<{ s: string; e: string; maxPages: number }> = [
                { s: startDate, e: endDate, maxPages: 2 },
              ]
              for (const rDate of discoveredRefundDates) {
                if (rDate < startDate || rDate > endDate) {
                  extraBusinessDatesSet.add(rDate)
                  if (!dateWindows.some((w) => w.s === rDate)) {
                    dateWindows.push({ s: rDate, e: rDate, maxPages: 1 })
                  }
                }
              }

              const storeRawOrders: any[] = []
              for (const win of dateWindows) {
                let cursor = ''
                for (let page = 0; page < win.maxPages; page++) {
                  const evalRes = await send(
                    'Runtime.evaluate',
                    {
                      expression: `(async () => {
                        const postApi = async (ep, body) => {
                          const r = await fetch('/manager/api/' + ep + '?localeCode=en', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'x' },
                            body: JSON.stringify(body)
                          });
                          return await r.json().catch(() => ({}));
                        };
                        const j = await postApi('getHistoricOrders', {
                          filters: {
                            currentTab: '',
                            displayCurrencyCode: '',
                            locationConstraints: {
                              cities: [],
                              countries: [],
                              locationUuids: [${JSON.stringify(locUuid)}]
                            },
                            dateFilter: {
                              startDate: ${JSON.stringify(`${win.s} 00:00:00`)},
                              endDate: ${JSON.stringify(`${addDaysToDateStr(win.e, 1)} 06:00:00`)},
                              lastUpdatedAt: ''
                            },
                            isEatsPassSubscriber: false,
                            search: null,
                            orderIssuesV2: [],
                            issueOrderStatusFilter: [],
                            displayByocIssues: false
                          },
                          sort: {
                            sortColumn: 'SORT_COLUMN_ORDER_COMPLETED_AT',
                            sortDirection: 'SORT_DIRECTION_DESC'
                          },
                          pagingInfo: {
                            cursor: ${JSON.stringify(cursor)},
                            limit: 50,
                            nextTable: 'liveOrders'
                          },
                          pagination: {
                            cursor: ${JSON.stringify(cursor)},
                            nextTable: 'historyOrders',
                            limit: 50
                          }
                        });
                        const batch = j?.data?.orders || [];
                        // Enriquecer en paralelo con getOrderDetails las órdenes que tengan disputa/error
                        const disputedInBatch = batch.filter((o) => o.issueType || (o.chargebackTotal && o.chargebackTotal !== '$0.00'));
                        await Promise.all(disputedInBatch.map(async (o) => {
                          const det = await postApi('getOrderDetails', {
                            workflowUuid: o.workflowUuid,
                            orderUuid: o.orderUuid,
                            restaurantUuid: ${JSON.stringify(locUuid)}
                          });
                          if (det?.data) o.orderDetails = det.data;
                        }));
                        return {
                          orders: batch,
                          nextCursor: j?.data?.paginationResult?.nextCursor || ''
                        };
                      })()`,
                      awaitPromise: true,
                      returnByValue: true,
                    },
                    uberSession
                  ).catch(() => null)

                  const val = evalRes?.result?.value
                  if (!val || !Array.isArray(val.orders) || val.orders.length === 0) break
                  storeRawOrders.push(...val.orders)
                  if (!val.nextCursor) break
                  cursor = val.nextCursor
                }
              }

              const parsed = parseUberEatsNativeApiObject(
                {
                  orders: storeRawOrders,
                  payPeriods: enrichedPeriods,
                  locationUuid: locUuid,
                  orgUUID: orgUuid,
                },
                allMappings,
                byUberUuid,
                byUberOrgUuid,
                m.store_id
              )
              orders.push(...parsed.orders)
              payouts.push(...parsed.payouts)
            }
          }

          if (ddTab) {
            const { sessionId: ddSession } = await send('Target.attachToTarget', {
              targetId: ddTab.targetId,
              flatten: true,
            })

            for (const m of storesToPull) {
              if (!m.doordash_store_id) continue
              const ddStoreId = String(m.doordash_store_id).trim()
              const evalRes = await send(
                'Runtime.evaluate',
                {
                  expression: `(async () => {
                    const sumRes = await fetch('/merchant-analytics-service/api/v1/payout_summaries?businessIds=137616&storeIds=${ddStoreId}&startDate=2026-10-01&endDate=2026-10-30');
                    const sumJson = await sumRes.json().catch(() => ({}));
                    const summariesList = sumJson?.summariesList || [];
                    const latestPayoutId = summariesList[0]?.payout?.id;
                    let transactions = [];
                    if (latestPayoutId) {
                      for (let offset = 0; offset < 300; offset += 100) {
                        const txRes = await fetch('/merchant-analytics-service/api/v1/payout_transactions?businessId=137616&entityType=business&limit=100&offset=' + offset + '&payoutId=' + latestPayoutId + '&storeId=${ddStoreId}');
                        const txJson = await txRes.json().catch(() => ({}));
                        const batch = txJson?.transactions || [];
                        for (const r of batch) transactions.push(r);
                        if (batch.length < 100) break;
                      }
                    }
                    return { summariesList, transactions, storeId: '${ddStoreId}', payoutId: latestPayoutId ? String(latestPayoutId) : null };
                  })()`,
                  awaitPromise: true,
                  returnByValue: true,
                },
                ddSession
              ).catch(() => null)

              const val = evalRes?.result?.value
              if (val) {
                const parsed = parseDoorDashNativeApiObject(val, allMappings, byDoorDashStoreId, m.store_id)
                orders.push(...parsed.orders)
                payouts.push(...parsed.payouts)
              }
            }
          }
        } catch {
          // Ignore Chrome DevTools errors gracefully
        } finally {
          clearTimeout(globalTimer)
          try {
            ws.close()
          } catch {}
          resolve()
        }
      }
    })
  } catch {
    // Fallback silencioso si no hay sesión local de Chrome DevTools
  }

  return { orders, payouts, extraBusinessDates: Array.from(extraBusinessDatesSet) }
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
  importedPlatformOrders?: PlatformOrderInput[]
  importedPayouts?: Array<Record<string, any>>
}): Promise<{
  toastOrdersSynced: number
  platformOrdersSynced: number
  payoutsSynced: number
  matchedCount: number
  discrepancyCount: number
}> {
  const {
    storeIds,
    startDate,
    endDate,
    syncToast = true,
    syncGrubhubLive = true,
    importedPlatformOrders = [],
    importedPayouts = [],
  } = params

  const allMappings = await getStorePlatformMappings()
  const targetMappings =
    storeIds.length > 0 ? allMappings.filter((m) => storeIds.includes(m.store_id)) : allMappings

  const businessDatesSet = new Set<string>(listBusinessDatesInRange(startDate, endDate))

  let toastOrdersSynced = 0
  let platformOrdersSynced = 0
  let payoutsSynced = 0

  // Si es una sincronización en vivo (sin archivo manual), extraer también DoorDash y Uber Eats desde Chrome DevTools si está activo
  let chromeOrders: PlatformOrderInput[] = []
  let chromePayouts: Array<Record<string, any>> = []
  if (syncGrubhubLive && importedPlatformOrders.length === 0) {
    const liveChrome = await fetchChromeLiveDoorDashAndUberForStores(
      targetMappings,
      allMappings,
      startDate,
      endDate
    )
    chromeOrders = liveChrome.orders
    chromePayouts = liveChrome.payouts
    for (const extraD of liveChrome.extraBusinessDates) {
      businessDatesSet.add(extraD)
    }
  }

  const businessDates = Array.from(businessDatesSet).sort()

  const allImportedOrders = [...importedPlatformOrders, ...chromeOrders]
  const allImportedPayouts = [...importedPayouts, ...chromePayouts]

  // 1. Si hay órdenes o cortes importados o extraídos en vivo de DoorDash/Uber, persistirlos primero
  if (allImportedPayouts.length > 0) {
    const { error: impPayErr } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .upsert(allImportedPayouts, { onConflict: 'store_id,platform,payout_reference_id' })
    if (impPayErr) {
      throw new Error(`Error upserting imported payouts: ${impPayErr.message}`)
    }
    payoutsSynced += allImportedPayouts.length
  }

  for (const mapping of targetMappings) {
    // 2. Sincronizar Grubhub en vivo si está activo
    let liveGhOrders: PlatformOrderInput[] = []
    if (syncGrubhubLive && mapping.grubhub_cust_id) {
      try {
        const ghData = await fetchGrubhubLiveAccountingForStore(mapping, startDate, endDate)
        liveGhOrders = ghData.orders
        if (ghData.payouts.length > 0) {
          const { error: ghPayErr } = await supabaseAdmin
            .from('delivery_platform_payouts')
            .upsert(ghData.payouts, { onConflict: 'store_id,platform,payout_reference_id' })
          if (ghPayErr) {
            console.error(`Error saving Grubhub payouts for store ${mapping.store_id}:`, ghPayErr.message)
          } else {
            payoutsSynced += ghData.payouts.length
          }
        }
      } catch (err: any) {
        console.error(`Grubhub live sync warning for store ${mapping.store_id}:`, err.message)
      }
    }

    // Combinar órdenes de plataforma (Grubhub en vivo + DoorDash/Uber en vivo + importadas para esta tienda)
    const storeImportedOrders = allImportedOrders.filter((o) => o.storeId === mapping.store_id)
    const combinedPlatformInputs = [...liveGhOrders, ...storeImportedOrders]

    // También leer órdenes de plataforma que ya estaban guardadas en DB para esta tienda y fechas
    const { data: existingDbOrders } = await supabaseAdmin
      .from('delivery_platform_orders')
      .select('*')
      .eq('store_id', mapping.store_id)
      .in('business_date', businessDates)

    const platformMap = new Map<string, PlatformOrderInput>()
    for (const row of existingDbOrders || []) {
      // Solo preservar registros que provenían de plataforma (no los TOAST_ONLY sintéticos)
      if (row.match_confidence !== 'TOAST_ONLY') {
        platformMap.set(`${row.platform}:${row.platform_transaction_id}`, {
          storeId: row.store_id,
          platform: row.platform as DeliveryPlatformCode,
          businessDate: row.business_date,
          placedAt: row.placed_at,
          platformOrderId: row.platform_order_id,
          platformTransactionId: row.platform_transaction_id,
          payoutReferenceId: row.payout_reference_id,
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
          disputeReason: row.dispute_reason,
          itemsSummary: row.items_summary || [],
          rawPayload: row.raw_payload || {},
        })
      }
    }

    for (const inp of combinedPlatformInputs) {
      platformMap.set(`${inp.platform}:${inp.platformTransactionId}`, inp)
    }

    const storePlatformOrders = Array.from(platformMap.values())
    platformOrdersSynced += combinedPlatformInputs.length

    // 3. Obtener órdenes de Toast POS para esta tienda y fechas
    let toastOrders: ToastDeliveryOrderRecord[] = []
    if (syncToast) {
      toastOrders = await fetchToastDeliveryOrdersForStoreAndDates(mapping, businessDates)
      toastOrdersSynced += toastOrders.length
    }

    // Consultar evidencia de empaque (delivery_packing_audits) para cruzar fotos/responsables
    const { data: packingAudits } = await supabaseAdmin
      .from('delivery_packing_audits')
      .select('id, toast_order_guid')
      .eq('store_id', mapping.store_id)
    const auditByToastGuid = new Map<string, string>()
    for (const pa of packingAudits || []) {
      if (pa.toast_order_guid && pa.id) {
        auditByToastGuid.set(pa.toast_order_guid, pa.id)
      }
    }

    // 4. Cruzar Toast Orders vs Platform Orders (2 Pasadas: Exact ID -> Fuzzy Tiempo + Subtotal)
    const matchedToastGuids = new Set<string>()
    const matchedPlatformTxKeys = new Set<string>()
    const rowsToUpsert: Array<Record<string, any>> = []

    const normalizeId = (id: string | null | undefined) =>
      String(id || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()

    // PASADA 1: Match Exacto por Order ID / Código Corto
    for (const pOrd of storePlatformOrders) {
      const pKey = `${pOrd.platform}:${pOrd.platformTransactionId}`
      const normPId = normalizeId(pOrd.platformOrderId)
      if (!normPId) continue

      const exactToast = toastOrders.find((t) => {
        if (matchedToastGuids.has(t.toastOrderGuid)) return false
        if (t.platform !== pOrd.platform) return false
        const normTId = normalizeId(t.extractedPlatformId)
        const normTab = normalizeId(t.toastTabName)
        if (normTId && (normTId === normPId || normPId.endsWith(normTId) || normTId.endsWith(normPId))) {
          return true
        }
        if (normPId.length >= 5 && normTab.includes(normPId)) {
          return true
        }
        return false
      })

      if (exactToast) {
        matchedToastGuids.add(exactToast.toastOrderGuid)
        matchedPlatformTxKeys.add(pKey)
        rowsToUpsert.push(
          buildReconciledOrderRow(pOrd, exactToast, 'EXACT_ID', auditByToastGuid.get(exactToast.toastOrderGuid))
        )
      }
    }

    // PASADA 2: Match Difuso por Plataforma + Fecha Operativa / Ventana de Tiempo + Subtotal (±$0.10)
    for (const pOrd of storePlatformOrders) {
      const pKey = `${pOrd.platform}:${pOrd.platformTransactionId}`
      if (matchedPlatformTxKeys.has(pKey)) continue

      const fuzzyToast = toastOrders.find((t) => {
        if (matchedToastGuids.has(t.toastOrderGuid)) return false
        if (t.platform !== pOrd.platform) return false
        const subDiff = Math.abs(pOrd.platformSubtotal - t.netSales)
        if (subDiff > 0.1) return false

        if (pOrd.placedAt && t.openedAt) {
          const diffMin = Math.abs(new Date(pOrd.placedAt).getTime() - new Date(t.openedAt).getTime()) / 60000
          if (diffMin <= 90) return true
        }
        return pOrd.businessDate === t.businessDate
      })

      if (fuzzyToast) {
        matchedToastGuids.add(fuzzyToast.toastOrderGuid)
        matchedPlatformTxKeys.add(pKey)
        rowsToUpsert.push(
          buildReconciledOrderRow(
            pOrd,
            fuzzyToast,
            'FUZZY_TIME_AMOUNT',
            auditByToastGuid.get(fuzzyToast.toastOrderGuid)
          )
        )
      }
    }

    // 5. Órdenes en Plataforma que NO están en Toast POS (MISSING_IN_TOAST o AJUSTES)
    for (const pOrd of storePlatformOrders) {
      const pKey = `${pOrd.platform}:${pOrd.platformTransactionId}`
      if (matchedPlatformTxKeys.has(pKey)) continue
      rowsToUpsert.push(buildReconciledOrderRow(pOrd, null, 'PLATFORM_ONLY', undefined))
    }

    // 6. Órdenes en Toast POS que NO están en la Plataforma (MISSING_IN_PLATFORM)
    for (const tOrd of toastOrders) {
      if (matchedToastGuids.has(tOrd.toastOrderGuid)) continue
      rowsToUpsert.push(buildToastOnlyOrderRow(tOrd, auditByToastGuid.get(tOrd.toastOrderGuid)))
    }

    // Limpiar registros sintéticos TOAST-<guid> que ahora sí hicieron match con una orden real de plataforma
    if (matchedToastGuids.size > 0) {
      const synthTxIdsToDelete = Array.from(matchedToastGuids).map((g) => `TOAST-${g}`)
      for (let i = 0; i < synthTxIdsToDelete.length; i += 100) {
        const batch = synthTxIdsToDelete.slice(i, i + 100)
        await supabaseAdmin
          .from('delivery_platform_orders')
          .delete()
          .eq('store_id', mapping.store_id)
          .in('platform_transaction_id', batch)
      }
    }

    if (rowsToUpsert.length > 0) {
      // Upsert en lotes de 100
      for (let i = 0; i < rowsToUpsert.length; i += 100) {
        const batch = rowsToUpsert.slice(i, i + 100)
        const { error: upErr } = await supabaseAdmin
          .from('delivery_platform_orders')
          .upsert(batch, { onConflict: 'store_id,platform,platform_transaction_id' })
        if (upErr) {
          throw new Error(`Error upserting delivery_platform_orders: ${upErr.message}`)
        }
      }
    }

    // 7. Actualizar los totales conciliados de Toast en `delivery_platform_payouts` y vincular reembolsos en cortes posteriores (`cross_payout_refunds`)
    const { data: storePayouts } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .select('id, platform, payout_reference_id, platform_gross_receivable, raw_payload')
      .eq('store_id', mapping.store_id)

    for (const payout of storePayouts || []) {
      // Si el corte contiene reembolsos de disputas de periodos anteriores (ej. "Goodwill OE Refund #650DD 20260928"),
      // actualizar automáticamente la orden original para reflejar que fue ganada/reembolsada en otro corte.
      const crossRefunds = payout.raw_payload?.cross_payout_refunds
      if (Array.isArray(crossRefunds) && crossRefunds.length > 0) {
        for (const cr of crossRefunds) {
          if (!cr?.orderCode) continue
          const { data: targetOrders } = await supabaseAdmin
            .from('delivery_platform_orders')
            .select('id, raw_payload, dispute_notes')
            .eq('store_id', mapping.store_id)
            .eq('platform', payout.platform)
            .ilike('platform_order_id', cr.orderCode)

          for (const tOrdRow of targetOrders || []) {
            const mergedRaw = {
              ...(tOrdRow.raw_payload || {}),
              reimbursement_payout_ref: cr.payoutRef,
              reimbursement_period: `${cr.periodStart} al ${cr.periodEnd}`,
              reimbursement_deposit_date: cr.depositDate,
              reimbursement_amount: cr.amount,
              reimbursement_description: cr.description,
            }
            const autoNote = `Disputa negada inicialmente en portal, peleada por correo y REEMBOLSADA (+$${Number(
              cr.amount || 0
            ).toFixed(2)}) en Corte Posterior #${cr.payoutRef} (${cr.periodStart} al ${
              cr.periodEnd
            }, dep. ${cr.depositDate}) — Concepto: "${cr.description}".`

            await supabaseAdmin
              .from('delivery_platform_orders')
              .update({
                is_disputed: true,
                dispute_status: 'APPROVED',
                dispute_amount: round2(Number(cr.amount || 0)),
                dispute_notes: tOrdRow.dispute_notes || autoNote,
                raw_payload: mergedRaw,
                updated_at: new Date().toISOString(),
              })
              .eq('id', tOrdRow.id)
          }
        }
      }

      const { data: payoutOrders } = await supabaseAdmin
        .from('delivery_platform_orders')
        .select('toast_net_sales, toast_tax, toast_expected_gross, toast_order_guid')
        .eq('store_id', mapping.store_id)
        .eq('platform', payout.platform)
        .eq('payout_reference_id', payout.payout_reference_id)

      if (payoutOrders && payoutOrders.length > 0) {
        let tNet = 0
        let tTax = 0
        let tExp = 0
        let matchedCnt = 0
        for (const po of payoutOrders) {
          if (po.toast_order_guid) matchedCnt++
          tNet += Number(po.toast_net_sales || 0)
          tTax += Number(po.toast_tax || 0)
          tExp += Number(po.toast_expected_gross || 0)
        }
        tNet = round2(tNet)
        tTax = round2(tTax)
        tExp = round2(tExp)
        const grossVar = round2(Number(payout.platform_gross_receivable || 0) - tExp)

        await supabaseAdmin
          .from('delivery_platform_payouts')
          .update({
            toast_matched_orders_count: matchedCnt,
            toast_net_sales: tNet,
            toast_tax_amount: tTax,
            toast_expected_gross: tExp,
            gross_variance: grossVar,
            status: Math.abs(grossVar) <= 0.1 && matchedCnt > 0 ? 'RECONCILED' : 'POSTED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', payout.id)
      }
    }
  }

  // Contar resultados finales
  const { data: finalOrders } = await supabaseAdmin
    .from('delivery_platform_orders')
    .select('reconciliation_status')
    .in(
      'store_id',
      targetMappings.map((m) => m.store_id)
    )
    .in('business_date', businessDates)

  let matchedCount = 0
  let discrepancyCount = 0
  for (const r of finalOrders || []) {
    if (r.reconciliation_status === 'MATCHED') matchedCount++
    else discrepancyCount++
  }

  return {
    toastOrdersSynced,
    platformOrdersSynced,
    payoutsSynced,
    matchedCount,
    discrepancyCount,
  }
}

function buildReconciledOrderRow(
  pOrd: PlatformOrderInput,
  tOrd: ToastDeliveryOrderRecord | null,
  confidence: 'EXACT_ID' | 'FUZZY_TIME_AMOUNT' | 'PLATFORM_ONLY',
  packingAuditId?: string
): Record<string, any> {
  // Si la orden proviene del feed en vivo de DoorDash (`get_orders`) donde solo viene `orderValue` (subtotal)
  // antes de liquidarse en `payout_transactions`, usar el tax de Toast cuando el subtotal cuadra al centavo.
  if (
    tOrd &&
    pOrd.platform === 'DOORDASH' &&
    pOrd.rawPayload?.orderValue !== undefined &&
    pOrd.rawPayload?.taxAmount === undefined &&
    Math.abs(pOrd.platformSubtotal - tOrd.netSales) <= 0.05
  ) {
    pOrd.platformTax = tOrd.taxAmount
    pOrd.platformTaxPaidToMerchant = tOrd.taxAmount
    pOrd.platformGrossReceivable = round2(pOrd.platformSubtotal + tOrd.taxAmount)
  }

  const toastNet = tOrd ? tOrd.netSales : 0
  const toastTax = tOrd ? tOrd.taxAmount : 0
  const toastExpectedGross = tOrd ? tOrd.expectedGross : 0

  const subtotalDiff = tOrd ? round2(pOrd.platformSubtotal - toastNet) : round2(pOrd.platformSubtotal)
  const expectedMerchantTax =
    tOrd && (pOrd.platform === 'DOORDASH' || pOrd.platform === 'GRUBHUB') ? toastTax : 0
  const taxDiff = tOrd
    ? round2(pOrd.platformTaxPaidToMerchant - expectedMerchantTax)
    : round2(pOrd.platformTaxPaidToMerchant)
  const grossDiff = tOrd
    ? round2(pOrd.platformGrossReceivable - toastExpectedGross)
    : round2(pOrd.platformGrossReceivable)

  let status: ReconciliationStatus = 'MATCHED'
  let isDisputed = false
  let disputeStatus = 'NONE'
  let disputeAmount = 0

  if (
    pOrd.errorCharge < -0.01 ||
    pOrd.transactionType === 'REFUND' ||
    pOrd.transactionType === 'ERROR_CHARGE'
  ) {
    status = 'REFUNDED_OR_DISPUTED'
    isDisputed = true
    const orderTag = String(pOrd.rawPayload?.orderTag || '').toUpperCase()
    if (pOrd.rawPayload?.reimbursement_payout_ref) {
      disputeStatus = 'APPROVED'
    } else if (orderTag.includes('APPROVED') || orderTag.includes('REFUNDED')) {
      disputeStatus = 'APPROVED'
    } else if (orderTag.includes('DENIED')) {
      disputeStatus = 'DENIED'
    } else if (orderTag.includes('PENDING') || orderTag.includes('REVIEW')) {
      disputeStatus = 'SUBMITTED'
    } else {
      disputeStatus = 'NEEDS_DISPUTE'
    }
    disputeAmount =
      Number(pOrd.rawPayload?.reimbursement_amount || 0) ||
      Math.abs(pOrd.errorCharge) ||
      Math.abs(grossDiff)
  } else if (pOrd.transactionType === 'CANCELLATION' && pOrd.netPayout <= 0) {
    status = 'CANCELLED_UNPAID'
    isDisputed = true
    disputeStatus = 'NEEDS_DISPUTE'
    disputeAmount = toastExpectedGross
  } else if (!tOrd) {
    status = 'MISSING_IN_TOAST'
  } else if (Math.abs(subtotalDiff) > 0.05) {
    status = 'AMOUNT_MISMATCH'
    if (subtotalDiff < -0.05) {
      isDisputed = true
      disputeStatus = 'NEEDS_DISPUTE'
      disputeAmount = Math.abs(grossDiff)
    }
  } else if (Math.abs(grossDiff) > 0.05) {
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
    payout_reference_id: pOrd.payoutReferenceId || null,
    payout_date: pOrd.payoutDate || null,
    fulfillment_type: pOrd.fulfillmentType || tOrd?.fulfillmentType || 'DELIVERY',
    transaction_type: pOrd.transactionType,
    platform_subtotal: pOrd.platformSubtotal,
    platform_tax: pOrd.platformTax,
    platform_tax_withheld: pOrd.platformTaxWithheld,
    platform_tax_paid_to_merchant: pOrd.platformTaxPaidToMerchant,
    platform_gross_receivable: pOrd.platformGrossReceivable,
    commission_fee: pOrd.commissionFee,
    delivery_fee: pOrd.deliveryFee,
    processing_fee: pOrd.processingFee,
    marketing_fee: pOrd.marketingFee,
    error_charge: pOrd.errorCharge,
    adjustment_amount: pOrd.adjustmentAmount,
    tip_amount: pOrd.tipAmount,
    net_payout: pOrd.netPayout,
    toast_order_guid: tOrd?.toastOrderGuid || null,
    toast_display_number: tOrd?.toastDisplayNumber || null,
    toast_tab_name: tOrd?.toastTabName || null,
    toast_opened_at: tOrd?.openedAt || null,
    toast_dining_option: tOrd?.diningOptionName || null,
    toast_net_sales: toastNet,
    toast_tax: toastTax,
    toast_expected_gross: toastExpectedGross,
    subtotal_diff: subtotalDiff,
    tax_diff: taxDiff,
    gross_diff: grossDiff,
    reconciliation_status: status,
    match_confidence: confidence,
    is_disputed: isDisputed,
    dispute_status: disputeStatus,
    dispute_reason: pOrd.disputeReason || null,
    dispute_amount: round2(disputeAmount),
    packing_audit_id: packingAuditId || null,
    items_summary: tOrd?.itemsSummary?.length ? tOrd.itemsSummary : pOrd.itemsSummary || [],
    raw_payload: pOrd.rawPayload || {},
    updated_at: new Date().toISOString(),
  }
}

function buildToastOnlyOrderRow(
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
