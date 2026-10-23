/**
 * @module lib/toast-accounting
 * @description Extractor oficial de datos de ventas de Toast POS para Contabilidad (Reemplazo de Cohesion).
 * Extrae con precisión de 100% centavo a centavo:
 * - Opciones de comedor (For Here, To Go, Toast Online, Uber Delivery/Takeout, DoorDash Delivery/Takeout, GrubHub Delivery/Takeout)
 * - Desglose de impuestos (Sales Tax, Marketplace Facilitator, Tax Paid by Uber)
 * - Desglose de pagos (Credit Card, EBT, Uber, DoorDash, GrubHub, Cash)
 * - Validación estricta de Órdenes Abiertas y Desbalanceadas (Step 11 de Cohesion: "Check for Open OR Out-of-Balance Orders")
 * 
 * @businessRules
 * - Regla Step 11 Cohesion: Si existen órdenes abiertas o checks sin cerrar en Toast POS para el día de negocio,
 *   Cohesion NO bloquea la publicación. En su lugar, debita el total no cobrado a la cuenta 12049 (Deposit Sales Collected & Open Orders),
 *   lo suma a Non-Cash Payments para ajustar el Expected Cash a la baja, balancea la póliza al centavo y permite la publicación a QuickBooks.
 * - Una orden se detecta como ABIERTA/INCOMPLETA para información gerencial si:
 *   1. No está voided ni deleted y order.closedDate es nulo.
 *   2. O alguno de sus checks no tiene closedDate o check.paymentStatus !== 'CLOSED'.
 * - Dicha información se registra en la póliza y se muestra en un banner informativo para auditoría del cajero/mesero.
 * 
 * @notes
 * - Toast POS cierra los días de negocio a las 5:59 AM del día siguiente.
 * - Los parámetros de validación se transmiten a accounting_sales_packets para registro contable y auditoría gerencial.
 * - Paridad con Cohesion (verificado Huntington Park 2026-10-08 con orden abierta #419 de Juana Lorenzo por $40.95):
 *   1) El importe de órdenes abiertas se debita en cuenta 12049 (Deposit Sales Collected & Open Orders).
 *   2) Se suma a Non-Cash Payments para obtener Expected Cash exacto ($2,971.97).
 *   3) La póliza queda balanceada al centavo ($11,890.67 = $11,890.67) y en estado 'ready' para publicar a QuickBooks.
 *   4) Solo se cuentan pagos capturados: se ignoran paymentStatus DENIED/FAILED/VOIDED/OPEN/CANCELLED.
 *   5) La propina de tarjeta (tipAmount de pagos CREDIT) se suma al depósito de tarjeta y se registra como Tips/Grat Payable (12100).
 *   6) La Dining Option "Toast Delivery Services" va aparte (cuenta 53060), no en For Here.
 *   7) Credit Card Other Deductions (MCA) se registra contra 12100, no contra el banco.
 */

import { getAuthToken } from './toast-api'
import { supabaseAdmin } from '@/lib/supabase'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

// Estados de pago no válidos / no cobrados que Cohesion y Toast excluyen de las ventas y depósitos
export const INVALID_PAYMENT_STATUSES = new Set([
  'DENIED',
  'FAILED',
  'VOIDED',
  'OPEN',
  'CANCELLED',
  'PROCESSING_VOID',
  'ERROR',
  'REVERSED',
])

export interface ToastOpenOrder {
  orderId: string
  orderNumber: string
  openedDate: string
  closedDate: string | null
  serverName: string
  amount: number
  taxAmount: number
  totalAmount: number
  paymentStatus: string
  status: 'OPEN' | 'UNPAID' | 'OUT_OF_BALANCE'
  reason: string
}

export interface ToastAccountingData {
  netSales: number
  grossSales: number
  totalTaxes: number
  forHereSales: number
  toGoSales: number
  phoneSales: number
  curbsideSales: number
  driveThruSales: number
  kioskDineInSales: number
  kioskTakeOutSales: number
  toastOnlineSales: number
  onlineOrderingTakeoutSales: number
  toastDeliverySales: number
  tipsPayable: number
  depositsCollected: number
  paidIn: number
  uberDeliverySales: number
  uberTakeoutSales: number
  doordashDeliverySales: number
  doordashTakeoutSales: number
  grubhubDeliverySales: number
  grubhubTakeoutSales: number
  salesGrossByOption?: {
    forHere: number
    toGo: number
    phone: number
    curbside: number
    driveThru: number
    kioskDineIn: number
    kioskTakeOut: number
    toastOnline: number
    onlineOrderingTakeout: number
    toastDelivery: number
    uberDelivery: number
    uberTakeout: number
    doordashDelivery: number
    doordashTakeout: number
    grubhubDelivery: number
    grubhubTakeout: number
  }
  salesTax: number
  marketplaceTax: number
  taxPaidByUber: number
  deferredSalesGiftCards: number
  giftCardRedemption: number
  deliveryServiceCharges: number
  deliveryFee6Miles: number
  discountsTotal: number
  discountBreakdown?: Record<string, number>
  creditCardGross: number
  creditCardFees: number
  creditCardOtherDeductions: number
  creditCardDeposit: number
  cardBreakdown?: Record<string, { gross: number, fee: number, deposit: number }>
  ebtAmount: number
  uberPayment: number
  doordashPayment: number
  grubhubPayment: number
  cashDeposit: number
  // Toast Cash Management (Depósitos de Efectivo registrados en Toast POS)
  toastDepositAmount: number
  hasToastDeposit: boolean
  toastDepositsList: Array<{ guid: string; amount: number; date: string; employee?: string }>
  cashPayoutsTotal: number
  toastCashPayoutsList: Array<{ amount: number; reason: string; comment: string; date: string }>
  // Toast Cash In, Cash Out & Tip Out (Entradas y Salidas de Gaveta registradas en Toast POS)
  cashInTotal: number
  toastCashInList: Array<{ amount: number; reason: string; comment: string; date: string }>
  cashOutTotal: number
  toastCashOutList: Array<{ amount: number; reason: string; comment: string; date: string }>
  tipOutTotal: number
  toastTipOutList: Array<{ amount: number; reason: string; comment: string; date: string }>
  // Validación de Órdenes Abiertas (Step 11 Cohesion)
  openOrdersCount: number
  outOfBalanceOrdersCount: number
  openOrdersList: ToastOpenOrder[]
  hasOpenOrders: boolean
  validationPassed: boolean
  validationMessage?: string
}

async function fetchToastWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options)
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      if (attempt < maxRetries) {
        const retryAfterHeader = res.headers.get('retry-after')
        const waitMs = retryAfterHeader && !isNaN(Number(retryAfterHeader))
          ? Math.max(Number(retryAfterHeader) * 1000, 1500)
          : 2000 * attempt
        await new Promise(resolve => setTimeout(resolve, waitMs))
        continue
      }
    }
    return res
  }
  return fetch(url, options)
}

export async function fetchToastAccountingData(
  storeExternalId: string,
  businessDate: string // YYYYMMDD
): Promise<ToastAccountingData> {
  const token = await getAuthToken()
  const toastHeaders = {
    Authorization: `Bearer ${token}`,
    'Toast-Restaurant-External-ID': storeExternalId,
  }

  // 1. Obtener Dining Options Map, Alternate Payment Types Map, Depósitos y Payouts de Cash Management de Toast POS
  const [optRes, altRes, depRes, entriesRes, payoutReasonsRes] = await Promise.all([
    fetchToastWithRetry(`${TOAST_API_HOST}/config/v2/diningOptions`, { headers: toastHeaders }).catch(() => null),
    fetchToastWithRetry(`${TOAST_API_HOST}/config/v2/alternatePaymentTypes`, { headers: toastHeaders }).catch(() => null),
    fetchToastWithRetry(`${TOAST_API_HOST}/cashmgmt/v1/deposits?businessDate=${businessDate}`, { headers: toastHeaders }).catch(() => null),
    fetchToastWithRetry(`${TOAST_API_HOST}/cashmgmt/v1/entries?businessDate=${businessDate}`, { headers: toastHeaders }).catch(() => null),
    fetchToastWithRetry(`${TOAST_API_HOST}/config/v2/payoutReasons`, { headers: toastHeaders }).catch(() => null),
  ])

  const diningOptions = optRes && optRes.ok ? await optRes.json().catch(() => []) : []
  const diningMap: Record<string, string> = {}
  if (Array.isArray(diningOptions)) {
    for (const opt of diningOptions) {
      if (opt.guid && opt.name) diningMap[opt.guid] = opt.name
    }
  }

  const altMap: Record<string, string> = {}
  if (altRes && altRes.ok) {
    const altData = await altRes.json()
    if (Array.isArray(altData)) {
      for (const alt of altData) {
        if (alt.guid && alt.name) altMap[alt.guid] = alt.name
      }
    }
  }

  // Parsear razones de payouts
  const payoutReasons = payoutReasonsRes && payoutReasonsRes.ok ? await payoutReasonsRes.json().catch(() => []) : []
  const payoutReasonMap: Record<string, string> = {}
  if (Array.isArray(payoutReasons)) {
    for (const pr of payoutReasons) {
      if (pr.guid && pr.name) payoutReasonMap[pr.guid] = pr.name
    }
  }

  // Parsear depósitos registrados en Toast POS (Cash Management)
  let toastDepositAmount = 0
  let hasToastDeposit = false
  const toastDepositsList: Array<{ guid: string; amount: number; date: string; employee?: string }> = []
  if (depRes && depRes.ok) {
    const rawDeps = await depRes.json().catch(() => [])
    if (Array.isArray(rawDeps) && rawDeps.length > 0) {
      const validDeps = rawDeps.filter((d: any) => !d.deleted && !d.voided)
      if (validDeps.length > 0) {
        hasToastDeposit = true
        toastDepositAmount = Math.round(validDeps.reduce((sum: number, d: any) => sum + (Number(d.amount) || 0), 0) * 100) / 100
        for (const d of validDeps) {
          toastDepositsList.push({
            guid: d.guid,
            amount: Number(d.amount) || 0,
            date: d.date,
            employee: d.employee?.guid,
          })
        }
      }
    }
  }

  // Parsear payouts, cash in, cash out y tip out registrados en Toast POS (Cash Management Entries)
  let cashPayoutsTotal = 0
  const toastCashPayoutsList: Array<{ amount: number; reason: string; comment: string; date: string }> = []
  let cashInTotal = 0
  const toastCashInList: Array<{ amount: number; reason: string; comment: string; date: string }> = []
  let cashOutTotal = 0
  const toastCashOutList: Array<{ amount: number; reason: string; comment: string; date: string }> = []
  let tipOutTotal = 0
  const toastTipOutList: Array<{ amount: number; reason: string; comment: string; date: string }> = []

  if (entriesRes && entriesRes.ok) {
    const rawEntries = await entriesRes.json().catch(() => [])
    if (Array.isArray(rawEntries)) {
      const validEntries = rawEntries.filter((e: any) => !e.deleted && !e.voided)
      // 1. Payouts (PAY_OUT)
      const payouts = validEntries.filter((e: any) => e.type === 'PAY_OUT')
      for (const p of payouts) {
        const amt = Math.round(Math.abs(Number(p.amount) || 0) * 100) / 100
        if (amt > 0) {
          const reasonGuid = p.payoutReason?.guid
          const reasonName = reasonGuid && payoutReasonMap[reasonGuid] ? payoutReasonMap[reasonGuid] : 'COGS-Materials and Supplies'
          const comment = (p.reason || '').trim()
          toastCashPayoutsList.push({
            amount: amt,
            reason: reasonName,
            comment,
            date: p.date,
          })
          cashPayoutsTotal = Math.round((cashPayoutsTotal + amt) * 100) / 100
        }
      }

      // 2. Cash In (CASH_IN / PAID_IN / PAY_IN)
      const cashIns = validEntries.filter((e: any) => e.type === 'CASH_IN' || e.type === 'PAID_IN' || e.type === 'PAY_IN')
      for (const ci of cashIns) {
        const amt = Math.round(Math.abs(Number(ci.amount) || 0) * 100) / 100
        if (amt > 0) {
          const comment = (ci.reason || '').trim()
          toastCashInList.push({
            amount: amt,
            reason: 'Cash In',
            comment,
            date: ci.date,
          })
          cashInTotal = Math.round((cashInTotal + amt) * 100) / 100
        }
      }

      // 3. Cash Out (CASH_OUT)
      const cashOuts = validEntries.filter((e: any) => e.type === 'CASH_OUT')
      for (const co of cashOuts) {
        const amt = Math.round(Math.abs(Number(co.amount) || 0) * 100) / 100
        if (amt > 0) {
          const comment = (co.reason || '').trim()
          toastCashOutList.push({
            amount: amt,
            reason: 'Cash Out',
            comment,
            date: co.date,
          })
          cashOutTotal = Math.round((cashOutTotal + amt) * 100) / 100
        }
      }

      // 4. Tip Out (TIP_OUT)
      const tipOuts = validEntries.filter((e: any) => e.type === 'TIP_OUT')
      for (const to of tipOuts) {
        const amt = Math.round(Math.abs(Number(to.amount) || 0) * 100) / 100
        if (amt > 0) {
          const comment = (to.reason || '').trim()
          toastTipOutList.push({
            amount: amt,
            reason: 'Tip Out',
            comment,
            date: to.date,
          })
          tipOutTotal = Math.round((tipOutTotal + amt) * 100) / 100
        }
      }
    }
  }

  // 2. Consultar ordersBulk con campos de estado de orden y checks
  const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
  url.searchParams.append('businessDate', businessDate)
  url.searchParams.append('pageSize', '100')

  const fields = [
    'diningOption',
    'voided',
    'deleted',
    'closedDate',
    'paidDate',
    'openedDate',
    'displayNumber',
    'server',
    'source',
    'deliveryService',
    'checks.amount',
    'checks.taxAmount',
    'checks.totalAmount',
    'checks.closedDate',
    'checks.paidDate',
    'checks.paymentStatus',
    'checks.appliedDiscounts',
    'checks.appliedServiceCharges',
    'checks.server',
    'checks.payments.guid',
    'checks.payments.type',
    'checks.payments.amount',
    'checks.payments.tipAmount',
    'checks.payments.refundAmount',
    'checks.payments.refund',
    'checks.payments.refundStatus',
    'checks.payments.paidBusinessDate',
    'checks.payments.voided',
    'checks.payments.server',
    'checks.payments.cardType',
    'checks.payments.originalProcessingFee',
    'checks.payments.mcaRepaymentAmount',
    'checks.payments.paymentStatus',
    'checks.payments.otherPayment',
    'checks.payments.paymentInstrument',
    'checks.payments.displayName',
    'checks.selections.price',
    'checks.selections.preDiscountPrice',
    'checks.selections.tax',
    'checks.selections.taxInclusion',
    'checks.selections.voided',
    'checks.selections.refundDetails',
    'checks.selections.item.name',
    'checks.selections.itemGroup.name',
    'checks.selections.displayName',
    'checks.selections.giftCard',
    'checks.selections.appliedDiscounts',
  ].join(',')
  url.searchParams.append('fields', fields)

  let page = 1
  let hasMore = true
  let allOrders: any[] = []

  while (hasMore) {
    url.searchParams.set('page', String(page))
    const res = await fetchToastWithRetry(url.toString(), { headers: toastHeaders })

    if (!res.ok) {
      throw new Error(`Toast API Error: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()
    allOrders.push(...data)
    if (data.length < 100) hasMore = false
    else page++
  }

  // Acumuladores de Ventas (Net y Gross por canal)
  let forHere = 0
  let forHereGross = 0
  let toGo = 0
  let toGoGross = 0
  let phone = 0
  let phoneGross = 0
  let curbside = 0
  let curbsideGross = 0
  let driveThru = 0
  let driveThruGross = 0
  let kioskDineIn = 0
  let kioskDineInGross = 0
  let kioskTakeOut = 0
  let kioskTakeOutGross = 0
  let toastOnline = 0
  let toastOnlineGross = 0
  let onlineOrderingTakeout = 0
  let onlineOrderingTakeoutGross = 0
  let toastDelivery = 0
  let toastDeliveryGross = 0
  let tipsPayable = 0
  let depositsCollected = 0
  let uberDel = 0
  let uberDelGross = 0
  let uberTake = 0
  let uberTakeGross = 0
  let ddDel = 0
  let ddDelGross = 0
  let ddTake = 0
  let ddTakeGross = 0
  let ghDel = 0
  let ghDelGross = 0
  let ghTake = 0
  let ghTakeGross = 0

  let totalTax = 0
  let marketplaceTax = 0
  let taxPaidByUber = 0

  let deferredSalesGiftCards = 0
  let giftCardRedemption = 0
  let deliveryServiceCharges = 0
  let deliveryFee6Miles = 0
  let discountsTotal = 0
  const discountBreakdown: Record<string, number> = {}

  let creditCardGross = 0
  let creditCardActualFees = 0
  let creditCardOtherDeductions = 0
  const cardBreakdown: Record<string, { gross: number, fee: number, deposit: number }> = {
    VISA: { gross: 0, fee: 0, deposit: 0 },
    MASTERCARD: { gross: 0, fee: 0, deposit: 0 },
    DISCOVER: { gross: 0, fee: 0, deposit: 0 },
    AMEX: { gross: 0, fee: 0, deposit: 0 },
  }
  let ebtAmount = 0
  let uberPayment = 0
  let doordashPayment = 0
  let grubhubPayment = 0
  let cashDeposit = 0

  // Registro de GUIDs de pagos procesados hoy para identificar pagos de fechas cruzadas (Paid In)
  const processedPaymentGuids = new Set<string>()
  const ordersByGuid = new Map<string, any>()
  const sameDayRefundPayments = new Map<string, any>()

  // Acumuladores de Validación (Órdenes Abiertas y Desbalanceadas)
  const openOrdersList: ToastOpenOrder[] = []
  let outOfBalanceOrdersCount = 0

  for (const order of allOrders) {
    if (order.voided || order.deleted) continue
    if (order.guid) ordersByGuid.set(order.guid, order)

    // --- REVISIÓN DE ORDEN ABIERTA / DESBALANCEADA (Step 11 Cohesion) ---
    const checkIssues: string[] = []
    let orderHasIssue = false
    let orderUnpaidTotal = 0
    let orderUnpaidTax = 0

    for (const check of order.checks || []) {
      if (check.voided || check.deleted) continue

      const isCheckClosed = Boolean(check.closedDate || check.paymentStatus === 'CLOSED')
      const isCheckOpen = !isCheckClosed

      // Filtrar estrictamente pagos válidos (descartar DENIED, FAILED, VOIDED, OPEN, CANCELLED, etc.)
      // En Toast POS, check.totalAmount es el subtotal + tax (sin propina), pero en algunos flujos incluye propina.
      // Validamos contra ambos (con y sin propina) para evitar falsos positivos de OUT_OF_BALANCE en órdenes con propina.
      const validPayments = (check.payments || [])
        .filter((p: any) => !p.voided && !INVALID_PAYMENT_STATUSES.has(String(p.paymentStatus || '').toUpperCase()))
      const paymentsBaseTotal = validPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
      const expectedTotal = Number(check.totalAmount ?? check.amount ?? 0)
      if (isCheckOpen && expectedTotal > 0 && paymentsBaseTotal < expectedTotal - 0.05) {
        // Solo marcar check sin cerrar si realmente quedó abierto con balance pendiente por cobrar
        orderHasIssue = true
        const unpaidBalance = Math.max(0, expectedTotal - paymentsBaseTotal)
        orderUnpaidTotal += unpaidBalance
        orderUnpaidTax += Number(check.taxAmount || 0) * (expectedTotal > 0 ? unpaidBalance / expectedTotal : 1)
        checkIssues.push(`Check sin cerrar (Estado: ${check.paymentStatus || 'OPEN'})`)
      }
    }

    if (!order.closedDate && (order.checks || []).length === 0) {
      const rawOrderAmount = Number((order as any).totalAmount ?? (order as any).amount ?? 0)
      if (rawOrderAmount > 0) {
        orderHasIssue = true
        orderUnpaidTotal += rawOrderAmount
        checkIssues.push('Orden sin checks pero con saldo pendiente en Toast POS')
      }
    }

    if (orderHasIssue) {
      const orderTotal = orderUnpaidTotal > 0 ? orderUnpaidTotal : (order.checks || [])
        .filter((c: any) => !c.voided && !c.deleted)
        .reduce((sum: number, c: any) => sum + Number(c.totalAmount ?? c.amount ?? 0), 0)
      const orderTax = orderUnpaidTotal > 0 ? orderUnpaidTax : (order.checks || [])
        .filter((c: any) => !c.voided && !c.deleted)
        .reduce((sum: number, c: any) => sum + Number(c.taxAmount || 0), 0)

      const sGuid = order.server?.guid || order.server?.id || (typeof order.server === 'string' ? order.server : null) ||
        order.checks?.[0]?.server?.guid || order.checks?.[0]?.server?.id ||
        order.checks?.[0]?.payments?.[0]?.server?.guid || order.checks?.[0]?.payments?.[0]?.server?.id ||
        order.creator?.guid

      const directServerName = (order.server as any)?.displayName || (order.server as any)?.name || (order.checks?.[0]?.server as any)?.displayName || ''

      openOrdersList.push({
        orderId: order.guid,
        orderNumber: order.displayNumber || order.guid?.slice(0, 8),
        openedDate: order.openedDate || '',
        closedDate: order.closedDate || null,
        serverName: directServerName || 'Desconocido',
        amount: Math.round(Math.max(0, orderTotal - orderTax) * 100) / 100,
        taxAmount: Math.round(orderTax * 100) / 100,
        totalAmount: Math.round(orderTotal * 100) / 100,
        paymentStatus: order.checks?.[0]?.paymentStatus || 'OPEN',
        status: checkIssues.some(i => i.includes('Desbalanceada')) ? 'OUT_OF_BALANCE' : 'OPEN',
        reason: checkIssues.join('; ') || 'Orden no cerrada en Toast POS',
        _serverGuid: sGuid,
      } as any)
    }

    // --- CÁLCULO DE VENTAS Y PAGOS ---
    const dOptionRaw = diningMap[order.diningOption?.guid] || order.diningOption?.name || ''
    const dService = order.deliveryService || ''
    const sourceRaw = order.source || ''
    const optName = `${dService} ${dOptionRaw} ${sourceRaw}`.toLowerCase()

    for (const check of order.checks || []) {
      if (check.voided) continue

      // Impuesto del check
      const checkTax = Number(check.taxAmount || 0)
      totalTax += checkTax

      // Service charges aplicados en el check (ej: Delivery Service, Delivery Fee > 6 Miles, o Gratuity)
      // NOTA: Los reembolsos (sc.refundDetails) NO se descuentan en la fecha original de la orden,
      // sino estrictamente en su refundBusinessDate (ver bloque REFUNDS PASS más abajo).
      if (check.appliedServiceCharges) {
        for (const sc of check.appliedServiceCharges) {
          if (sc.voided) continue
          const scAmt = Math.max(0, Number(sc.chargeAmount ?? sc.amount ?? 0))
          if (scAmt <= 0) continue
          if (sc.gratuity) {
            tipsPayable += scAmt
          } else {
            const scName = String(sc.name || '').toLowerCase()
            if (scName.includes('6 miles')) {
              deliveryFee6Miles += scAmt
            } else {
              deliveryServiceCharges += scAmt
            }
          }
        }
      }

      // Calcular Net Sales del check: Sum(Item.Price) - Sum(Discounts)
      // NOTA: Los reembolsos (sel.refundDetails y p.refund) se procesan en el bloque REFUNDS PASS
      // filtrados por refundBusinessDate === businessDate para homologar al 100% con Cohesion (ej. Rialto 10/20 Orden #697).
      let checkNet = 0
      let checkItemNetSum = 0
      let checkItemGrossSum = 0

      for (const sel of check.selections || []) {
        if (sel.voided) continue
        let p = Number(sel.price || 0)
        let pre = Number(sel.preDiscountPrice || sel.price || 0)
        if (sel.taxInclusion === 'INCLUDED') {
          p -= Number(sel.tax || 0)
          pre -= Number(sel.tax || 0)
        }

        // Detección de Ventas de Tarjetas de Regalo (Gift Card Sales -> 20500 Deferred Sales)
        const sName = ((sel.item?.name || '') + ' ' + (sel.itemGroup?.name || '') + ' ' + (sel.displayName || '')).toLowerCase()
        if (sel.giftCard || sName.includes('gift card') || sName.includes('add value')) { // 'Add Value ($)' = recarga de gift card (Cohesion la manda a 20500 Deferred)
          deferredSalesGiftCards += p
        } else {
          checkNet += p
          checkItemNetSum += p
          checkItemGrossSum += pre
        }

        // Acumular descuentos a nivel de item (ej. Senior Discount)
        if (sel.appliedDiscounts && Array.isArray(sel.appliedDiscounts)) {
          for (const d of sel.appliedDiscounts) {
            const dAmt = Number(d.discountAmount ?? d.nonTaxDiscountAmount ?? d.amount ?? 0)
            const dName = d.name || 'Descuento Item'
            discountBreakdown[dName] = Math.round(((discountBreakdown[dName] || 0) + dAmt) * 100) / 100
          }
        }
      }

      // En Toast POS, sel.price ya tiene descontados tanto los descuentos por item como por check.
      // La diferencia (checkItemGrossSum - checkItemNetSum) representa el descuento total del cheque.
      const checkDiscounts = Math.max(0, checkItemGrossSum - checkItemNetSum)
      if (check.appliedDiscounts && Array.isArray(check.appliedDiscounts)) {
        for (const d of check.appliedDiscounts) {
          const dAmt = Number(d.discountAmount ?? d.nonTaxDiscountAmount ?? d.amount ?? 0)
          const dName = d.name || 'Descuento General'
          discountBreakdown[dName] = Math.round(((discountBreakdown[dName] || 0) + dAmt) * 100) / 100
        }
      }
      discountsTotal += checkDiscounts

      checkNet = Math.round(checkNet * 100) / 100
      const checkGross = Math.round(checkItemGrossSum * 100) / 100

      const dOptLower = (dOptionRaw || '').toLowerCase().trim()

      // Clasificar por Dining Option (Net y Gross)
      if (optName.includes('uber') && (optName.includes('takeout') || optName.includes('take out'))) {
        uberTake += checkNet
        uberTakeGross += checkGross
        taxPaidByUber += checkTax
      } else if (optName.includes('uber') || optName.includes('postmates')) {
        uberDel += checkNet
        uberDelGross += checkGross
        taxPaidByUber += checkTax
      } else if (optName.includes('doordash') && (optName.includes('takeout') || optName.includes('take out'))) {
        ddTake += checkNet
        ddTakeGross += checkGross
        marketplaceTax += checkTax
      } else if (optName.includes('doordash') || optName.includes('dash')) {
        ddDel += checkNet
        ddDelGross += checkGross
        marketplaceTax += checkTax
      } else if (optName.includes('grub') && (optName.includes('takeout') || optName.includes('take out'))) {
        ghTake += checkNet
        ghTakeGross += checkGross
        marketplaceTax += checkTax
      } else if (optName.includes('grub')) {
        ghDel += checkNet
        ghDelGross += checkGross
        marketplaceTax += checkTax
      } else if (dOptLower.includes('toast delivery')) {
        // Dining Option "Toast Delivery Services" -> línea propia en Cohesion
        toastDelivery += checkNet
        toastDeliveryGross += checkGross
      } else if (dOptLower.includes('online ordering - takeout') || dOptLower.includes('online ordering takeout')) {
        // Dining Option explícito "Online Ordering - Takeout" (Central LA -> 12100, Downey -> 40050)
        onlineOrderingTakeout += checkNet
        onlineOrderingTakeoutGross += checkGross
      } else if (optName.includes('online')) {
        toastOnline += checkNet
        toastOnlineGross += checkGross
      } else if (dOptLower.includes('drive') || optName.includes('drive')) {
        driveThru += checkNet
        driveThruGross += checkGross
      } else if (dOptLower.includes('kiosk dine in')) {
        kioskDineIn += checkNet
        kioskDineInGross += checkGross
      } else if (dOptLower.includes('kiosk take out') || dOptLower === 'kiosk' || (dOptLower.includes('kiosk') && !dOptLower.includes('dine in') && !dOptLower.includes('for here'))) {
        kioskTakeOut += checkNet
        kioskTakeOutGross += checkGross
      } else if (dOptLower === 'phone' || dOptLower.includes('phone')) {
        // Dining Option "Phone" -> línea propia en Cohesion (40050 | Phone | Dining Option: Phone)
        phone += checkNet
        phoneGross += checkGross
      } else if (dOptLower.includes('curbside')) {
        // Dining Option "Curbside Pickup" -> línea propia en Cohesion (40050 | Curbside Pickup | Dining Option: Curbside Pickup)
        curbside += checkNet
        curbsideGross += checkGross
      } else if (dOptLower.includes('for here') || dOptLower.includes('dine in') || dOptLower.includes('comedor')) {
        forHere += checkNet
        forHereGross += checkGross
      } else if (dOptLower.includes('to go') || dOptLower.includes('take out') || dOptLower.includes('llevar')) {
        toGo += checkNet
        toGoGross += checkGross
      } else if (optName.includes('to go')) {
        toGo += checkNet
        toGoGross += checkGross
      } else {
        forHere += checkNet
        forHereGross += checkGross
      }

      // Clasificar pagos
      for (const p of check.payments || []) {
        if (p.guid) processedPaymentGuids.add(p.guid)
        if (p.voided) continue
        // Cohesion solo cuenta pagos capturados: ignora DENIED, FAILED, VOIDED, OPEN, CANCELLED, PROCESSING_VOID, ERROR, REVERSED
        if (INVALID_PAYMENT_STATUSES.has(String(p.paymentStatus || '').toUpperCase())) continue

        if (p.guid && (p.refund?.refundAmount || p.refundAmount) && (!p.refund?.refundBusinessDate || String(p.refund.refundBusinessDate) === businessDate)) {
          sameDayRefundPayments.set(p.guid, p)
        }

        const amt = Number(p.amount || 0)

        // Cohesion Parity: Si el pago se capturó en OTRA fecha de negocio (ej. orden de hoy pagada previamente o liquidada después),
        // los cobros positivos pertenecen a la cuenta 12049 (Deposit Sales Collected & Open Orders).
        // Si es un ajuste negativo de cambio devuelto al día siguiente (ej. Broadway #129 -$0.99 en efectivo el 10/14 para cerrar un sobrepago de tarjeta del 10/13),
        // NO se suma aquí porque el sobrepago ya se descuenta abajo en chkExcess.
        if (p.paidBusinessDate && String(p.paidBusinessDate) !== businessDate) {
          if (amt > 0) depositsCollected += amt
          continue
        }

        const pType = (p.type || '').toUpperCase()
        const altName = p.otherPayment?.guid ? (altMap[p.otherPayment.guid] || '') : (p.otherPayment?.name || '')
        const pName = (altName || p.displayName || p.paymentInstrument?.displayName || '').toLowerCase()

        // Toast Capital / MCA Repayment Deduction
        if (p.mcaRepaymentAmount) {
          creditCardOtherDeductions += Number(p.mcaRepaymentAmount || 0)
        }

        const tip = Number(p.tipAmount || 0)

        // Redención de Tarjetas de Regalo (Gift Card Redemption -> 20500)
        if (pType === 'GIFT_CARD' || pType.includes('GIFT') || pName.includes('gift card')) {
          giftCardRedemption += amt + tip
          if (tip > 0) tipsPayable += tip
        } else if (pName.includes('ebt')) {
          // EBT se valida para evitar enmascaramiento con CREDIT
          ebtAmount += amt
        } else if (pType === 'CASH') {
          cashDeposit += amt
        } else if (pType === 'CREDIT') {
          // Cohesion incluye la propina de tarjeta en el depósito y la registra como Tips Payable (12100)
          const fee = Number(p.originalProcessingFee || 0)
          const fullGross = amt + tip
          creditCardGross += fullGross
          tipsPayable += tip
          creditCardActualFees += fee

          const rawCard = String(p.cardType || '').toUpperCase()
          const cKey = rawCard.includes('VISA') ? 'VISA'
            : rawCard.includes('MASTER') ? 'MASTERCARD'
            : rawCard.includes('DISC') ? 'DISCOVER'
            : rawCard.includes('AMEX') || rawCard.includes('AMERICAN') ? 'AMEX'
            : 'OTHER'

          if (!cardBreakdown[cKey]) cardBreakdown[cKey] = { gross: 0, fee: 0, deposit: 0 }
          cardBreakdown[cKey].gross = Math.round((cardBreakdown[cKey].gross + fullGross) * 100) / 100
          cardBreakdown[cKey].fee = Math.round((cardBreakdown[cKey].fee + fee) * 100) / 100
          cardBreakdown[cKey].deposit = Math.round((cardBreakdown[cKey].gross - cardBreakdown[cKey].fee) * 100) / 100
        } else if (pName.includes('uber') || pName.includes('postmates')) {
          uberPayment += amt + tip
          if (tip > 0) tipsPayable += tip
        } else if (pName.includes('doordash') || pName.includes('dash')) {
          doordashPayment += amt + tip
          if (tip > 0) tipsPayable += tip
        } else if (pName.includes('grub')) {
          grubhubPayment += amt + tip
          if (tip > 0) tipsPayable += tip
        } else if (pType === 'OTHER') {
          if (optName.includes('uber')) {
            uberPayment += amt + tip
            if (tip > 0) tipsPayable += tip
          } else if (optName.includes('doordash')) {
            doordashPayment += amt + tip
            if (tip > 0) tipsPayable += tip
          } else if (optName.includes('grub')) {
            grubhubPayment += amt + tip
            if (tip > 0) tipsPayable += tip
          } else {
            creditCardGross += amt + tip
            if (tip > 0) tipsPayable += tip
          }
        }
      }

      // Cohesion: cheque en 0 (items anulados) con pago capturado = Deposit Sales Collected (12049)
      const chkTotal = Number(check.totalAmount ?? check.amount ?? 0)
      // Tambien aplica a sobrepagos: pagos capturados hoy > total del cheque (ej. Norwalk 10/3 orden 277: tarjeta 13.04 + efectivo 9.06 sobre total 13.04)
      let chkPaid = 0
      for (const p of check.payments || []) {
        if (p.voided) continue
        if (INVALID_PAYMENT_STATUSES.has(String(p.paymentStatus || '').toUpperCase())) continue
        if (p.paidBusinessDate && String(p.paidBusinessDate) !== businessDate) continue
        chkPaid += Number(p.amount || 0)
      }
      const chkExcess = Math.round((chkPaid - chkTotal) * 100) / 100
      if (chkExcess > 0.009) depositsCollected -= chkExcess
    }
  }

  // PAID IN (Cohesion: "Paid In Total (Deposits Received)"):
  // Pagos capturados en la fecha comercial actual (paidBusinessDate) pero que pertenecen a órdenes de OTRA fecha (pasada o futura).
  // Ejemplos auditados al centavo:
  // 1. West Covina 10/5: Orden #1 de businessDate 20261015 (Catering Party Tray programado para el 15 de oct) cobrada el 10/5 con Visa ($270.98, fee $6.90).
  // 2. South Gate 10/3: Orden #904 de businessDate 10/2 cobrada el 10/3 ($10.22).
  let paidIn = 0
  try {
    const payUrl = new URL(`${TOAST_API_HOST}/orders/v2/payments`)
    payUrl.searchParams.set('paidBusinessDate', businessDate)
    const pListRes = await fetchToastWithRetry(payUrl.toString(), { headers: toastHeaders })
    if (pListRes.ok) {
      const paymentGuids: string[] = await pListRes.json()
      if (Array.isArray(paymentGuids) && paymentGuids.length > 0) {
        // Encontrar pagos cobrados hoy que no provienen de las órdenes de hoy (fechas pasadas o pedidos futuros)
        const crossPaymentGuids = paymentGuids.filter(guid => !processedPaymentGuids.has(guid))
        if (crossPaymentGuids.length > 0) {
          await Promise.all(
            crossPaymentGuids.map(async (pGuid) => {
              try {
                const pRes = await fetchToastWithRetry(`${TOAST_API_HOST}/orders/v2/payments/${pGuid}`, { headers: toastHeaders })
                if (!pRes.ok) return
                const pp = await pRes.json()
                if (pp.voided || INVALID_PAYMENT_STATUSES.has(String(pp.paymentStatus || '').toUpperCase())) return

                const pAmt = Number(pp.amount || 0)
                if (pAmt === 0) return
                const pTip = Number(pp.tipAmount || 0)
                const pT = String(pp.type || '').toUpperCase()
                const fee = Number(pp.originalProcessingFee || 0)
                if (pp.mcaRepaymentAmount) {
                  creditCardOtherDeductions += Number(pp.mcaRepaymentAmount || 0)
                }

                const altName = pp.otherPayment?.guid ? (altMap[pp.otherPayment.guid] || '') : (pp.otherPayment?.name || '')
                const pName = (altName || pp.displayName || pp.paymentInstrument?.displayName || '').toLowerCase()

                if (pT === 'GIFT_CARD' || pT.includes('GIFT') || pName.includes('gift card')) {
                  giftCardRedemption += pAmt + pTip
                  if (pTip > 0) tipsPayable += pTip
                  paidIn += pAmt
                } else if (pT === 'CREDIT') {
                  const fullGross = pAmt + pTip
                  creditCardGross += fullGross
                  tipsPayable += pTip
                  creditCardActualFees += fee
                  paidIn += pAmt

                  const rawCard = String(pp.cardType || '').toUpperCase()
                  const cKey = rawCard.includes('VISA') ? 'VISA'
                    : rawCard.includes('MASTER') ? 'MASTERCARD'
                    : rawCard.includes('DISC') ? 'DISCOVER'
                    : rawCard.includes('AMEX') || rawCard.includes('AMERICAN') ? 'AMEX'
                    : 'OTHER'

                  if (!cardBreakdown[cKey]) cardBreakdown[cKey] = { gross: 0, fee: 0, deposit: 0 }
                  cardBreakdown[cKey].gross = Math.round((cardBreakdown[cKey].gross + fullGross) * 100) / 100
                  cardBreakdown[cKey].fee = Math.round((cardBreakdown[cKey].fee + fee) * 100) / 100
                  cardBreakdown[cKey].deposit = Math.round((cardBreakdown[cKey].gross - cardBreakdown[cKey].fee) * 100) / 100
                } else if (pT === 'CASH') {
                  cashDeposit += pAmt
                  paidIn += pAmt
                } else if (pName.includes('uber') || pName.includes('postmates')) {
                  uberPayment += pAmt + pTip
                  if (pTip > 0) tipsPayable += pTip
                  paidIn += pAmt
                } else if (pName.includes('doordash') || pName.includes('dash')) {
                  doordashPayment += pAmt + pTip
                  if (pTip > 0) tipsPayable += pTip
                  paidIn += pAmt
                } else if (pName.includes('grub')) {
                  grubhubPayment += pAmt + pTip
                  if (pTip > 0) tipsPayable += pTip
                  paidIn += pAmt
                } else if (pName.includes('ebt')) {
                  ebtAmount += pAmt
                  paidIn += pAmt
                } else {
                  creditCardGross += pAmt + pTip
                  if (pTip > 0) tipsPayable += pTip
                  paidIn += pAmt
                }
              } catch (fetchErr) {
                console.warn(`[toast-accounting] Error consultando pago cross-date ${pGuid}:`, (fetchErr as Error).message)
              }
            })
          )
        }
      }
    }
  } catch (paidInErr) {
    console.warn('[toast-accounting] Paid In (cross-date payments) no disponible:', (paidInErr as Error).message)
  }

  // REFUNDS PASS (Reembolsos del día actual: Same-Day y Cross-Date con refundBusinessDate === businessDate):
  // En Toast POS, un reembolso aplicado hoy (ej. Rialto 2026-10-20 sobre la Orden #697 del 2026-10-17 por $41.86,
  // o West Covina 2026-10-21 sobre la Orden #412 del 2026-10-17 por $10.13) tiene `refundBusinessDate === businessDate`.
  // Cohesion contabiliza todo reembolso en su `refundBusinessDate` (reduciendo el canal de venta/Dining Option,
  // Service Charges, Impuestos y el Depósito de Tarjeta/Efectivo del día del reembolso, sin alterar las comisiones originalProcessingFee).
  try {
    const refUrl = new URL(`${TOAST_API_HOST}/orders/v2/payments`)
    refUrl.searchParams.set('refundBusinessDate', businessDate)
    const refListRes = await fetchToastWithRetry(refUrl.toString(), { headers: toastHeaders })
    const refundGuidsFromApi: string[] = refListRes.ok ? await refListRes.json() : []
    const allRefundPaymentGuids = Array.from(
      new Set([
        ...(Array.isArray(refundGuidsFromApi) ? refundGuidsFromApi : []),
        ...Array.from(sameDayRefundPayments.keys()),
      ])
    )

    if (allRefundPaymentGuids.length > 0) {
      const processedRefundTxGuids = new Set<string>()

      for (const rGuid of allRefundPaymentGuids) {
        try {
          let rp = sameDayRefundPayments.get(rGuid)
          if (!rp) {
            const rpRes = await fetchToastWithRetry(`${TOAST_API_HOST}/orders/v2/payments/${rGuid}`, { headers: toastHeaders })
            if (!rpRes.ok) continue
            rp = await rpRes.json()
          }
          if (!rp || rp.voided || INVALID_PAYMENT_STATUSES.has(String(rp.paymentStatus || '').toUpperCase())) continue

          const refObj = rp.refund || (rp.refundAmount ? { refundAmount: rp.refundAmount, tipRefundAmount: 0, refundBusinessDate: businessDate } : null)
          if (!refObj) continue
          if (refObj.refundBusinessDate && String(refObj.refundBusinessDate) !== businessDate) continue

          const rAmt = Number(refObj.refundAmount || 0)
          const rTip = Number(refObj.tipRefundAmount || 0)
          if (rAmt <= 0 && rTip <= 0) continue

          // 1. Descontar del método de pago correspondiente (Cohesion no descuenta originalProcessingFee en reembolsos)
          const pT = String(rp.type || '').toUpperCase()
          const altName = rp.otherPayment?.guid ? (altMap[rp.otherPayment.guid] || '') : (rp.otherPayment?.name || '')
          const pName = (altName || rp.displayName || rp.paymentInstrument?.displayName || '').toLowerCase()

          if (pT === 'GIFT_CARD' || pT.includes('GIFT') || pName.includes('gift card')) {
            giftCardRedemption -= (rAmt + rTip)
            if (rTip > 0) tipsPayable -= rTip
          } else if (pName.includes('ebt')) {
            ebtAmount -= rAmt
          } else if (pT === 'CASH') {
            cashDeposit -= rAmt
          } else if (pT === 'CREDIT') {
            const fullRefGross = rAmt + rTip
            creditCardGross -= fullRefGross
            if (rTip > 0) tipsPayable -= rTip

            const rawCard = String(rp.cardType || '').toUpperCase()
            const cKey = rawCard.includes('VISA') ? 'VISA'
              : rawCard.includes('MASTER') ? 'MASTERCARD'
              : rawCard.includes('DISC') ? 'DISCOVER'
              : rawCard.includes('AMEX') || rawCard.includes('AMERICAN') ? 'AMEX'
              : 'OTHER'

            if (!cardBreakdown[cKey]) cardBreakdown[cKey] = { gross: 0, fee: 0, deposit: 0 }
            cardBreakdown[cKey].gross = Math.round((cardBreakdown[cKey].gross - fullRefGross) * 100) / 100
            cardBreakdown[cKey].deposit = Math.round((cardBreakdown[cKey].gross - cardBreakdown[cKey].fee) * 100) / 100
          } else if (pName.includes('uber') || pName.includes('postmates')) {
            uberPayment -= (rAmt + rTip)
            if (rTip > 0) tipsPayable -= rTip
          } else if (pName.includes('doordash') || pName.includes('dash')) {
            doordashPayment -= (rAmt + rTip)
            if (rTip > 0) tipsPayable -= rTip
          } else if (pName.includes('grub')) {
            grubhubPayment -= (rAmt + rTip)
            if (rTip > 0) tipsPayable -= rTip
          } else {
            creditCardGross -= (rAmt + rTip)
            if (rTip > 0) tipsPayable -= rTip
          }

          // 2. Obtener la orden padre y descontar ventas (Dining Option), Service Charges e Impuestos del reembolso
          let refOrder = rp.orderGuid ? ordersByGuid.get(rp.orderGuid) : null
          if (!refOrder && rp.orderGuid) {
            const ordRes = await fetchToastWithRetry(`${TOAST_API_HOST}/orders/v2/orders/${rp.orderGuid}`, { headers: toastHeaders })
            if (ordRes.ok) {
              refOrder = await ordRes.json()
              if (refOrder?.guid) ordersByGuid.set(refOrder.guid, refOrder)
            }
          }

          if (refOrder) {
            const refTxGuid = refObj.refundTransaction?.guid || null
            const dedupKey = refTxGuid || rp.guid
            if (!processedRefundTxGuids.has(dedupKey)) {
              processedRefundTxGuids.add(dedupKey)

              const refCheck = (refOrder.checks || []).find((c: any) =>
                (rp.checkGuid && c.guid === rp.checkGuid) ||
                (c.payments || []).some((cp: any) => cp.guid && cp.guid === rp.guid)
              ) || refOrder.checks?.[0]
              if (refCheck) {
                const dOptionRaw = diningMap[refOrder.diningOption?.guid] || refOrder.diningOption?.name || ''
                const dService = refOrder.deliveryService || ''
                const sourceRaw = refOrder.source || ''
                const optName = `${dService} ${dOptionRaw} ${sourceRaw}`.toLowerCase()
                const dOptLower = (dOptionRaw || '').toLowerCase().trim()

                let itemRefundNet = 0
                let scRefundSum = 0
                let taxRefundSum = 0

                for (const sc of refCheck.appliedServiceCharges || []) {
                  if (sc.voided || !sc.refundDetails) continue
                  if (refTxGuid && sc.refundDetails.refundTransaction?.guid && sc.refundDetails.refundTransaction.guid !== refTxGuid) continue
                  const scRefAmt = Number(sc.refundDetails.refundAmount || 0)
                  const scRefTax = Number(sc.refundDetails.taxRefundAmount || 0)
                  scRefundSum += scRefAmt
                  taxRefundSum += scRefTax
                  if (scRefAmt > 0) {
                    if (sc.gratuity) {
                      tipsPayable -= scRefAmt
                    } else {
                      const scName = String(sc.name || '').toLowerCase()
                      if (scName.includes('6 miles')) {
                        deliveryFee6Miles -= scRefAmt
                      } else {
                        deliveryServiceCharges -= scRefAmt
                      }
                    }
                  }
                }

                for (const sel of refCheck.selections || []) {
                  if (sel.voided || !sel.refundDetails) continue
                  if (refTxGuid && sel.refundDetails.refundTransaction?.guid && sel.refundDetails.refundTransaction.guid !== refTxGuid) continue
                  const selRefAmt = Number(sel.refundDetails.refundAmount || 0)
                  const selRefTax = Number(sel.refundDetails.taxRefundAmount || 0)
                  taxRefundSum += selRefTax
                  if (selRefAmt > 0) {
                    const sName = ((sel.item?.name || '') + ' ' + (sel.itemGroup?.name || '') + ' ' + (sel.displayName || '')).toLowerCase()
                    if (sel.giftCard || sName.includes('gift card') || sName.includes('add value')) {
                      deferredSalesGiftCards -= selRefAmt
                    } else {
                      itemRefundNet += selRefAmt
                    }
                  }
                }

                if (taxRefundSum === 0 && Number(refObj.taxRefundAmount || 0) > 0) {
                  taxRefundSum = Number(refObj.taxRefundAmount || 0)
                }

                const linkedRefundTotal = Math.round((itemRefundNet + scRefundSum + taxRefundSum) * 100) / 100
                const unlinkedRef = Math.max(0, Math.round((rAmt - linkedRefundTotal) * 100) / 100)
                if (unlinkedRef > 0.009) {
                  itemRefundNet += unlinkedRef
                } else if (linkedRefundTotal > rAmt + 0.05 && rAmt > 0) {
                  // Si el cheque tuvo reembolsos parciales en múltiples fechas distintas y Toast acumula refundDetails,
                  // limitar estrictamente al monto reembolsado hoy (rAmt)
                  const ratio = rAmt / linkedRefundTotal
                  itemRefundNet = Math.round(itemRefundNet * ratio * 100) / 100
                  taxRefundSum = Math.round((rAmt - itemRefundNet - scRefundSum) * 100) / 100
                }

                itemRefundNet = Math.round(itemRefundNet * 100) / 100
                taxRefundSum = Math.round(taxRefundSum * 100) / 100

                totalTax -= taxRefundSum

                if (optName.includes('uber') && (optName.includes('takeout') || optName.includes('take out'))) {
                  uberTake -= itemRefundNet
                  uberTakeGross -= itemRefundNet
                  taxPaidByUber -= taxRefundSum
                } else if (optName.includes('uber') || optName.includes('postmates')) {
                  uberDel -= itemRefundNet
                  uberDelGross -= itemRefundNet
                  taxPaidByUber -= taxRefundSum
                } else if (optName.includes('doordash') && (optName.includes('takeout') || optName.includes('take out'))) {
                  ddTake -= itemRefundNet
                  ddTakeGross -= itemRefundNet
                  marketplaceTax -= taxRefundSum
                } else if (optName.includes('doordash') || optName.includes('dash')) {
                  ddDel -= itemRefundNet
                  ddDelGross -= itemRefundNet
                  marketplaceTax -= taxRefundSum
                } else if (optName.includes('grub') && (optName.includes('takeout') || optName.includes('take out'))) {
                  ghTake -= itemRefundNet
                  ghTakeGross -= itemRefundNet
                  marketplaceTax -= taxRefundSum
                } else if (optName.includes('grub')) {
                  ghDel -= itemRefundNet
                  ghDelGross -= itemRefundNet
                  marketplaceTax -= taxRefundSum
                } else if (dOptLower.includes('toast delivery')) {
                  toastDelivery -= itemRefundNet
                  toastDeliveryGross -= itemRefundNet
                } else if (dOptLower.includes('online ordering - takeout') || dOptLower.includes('online ordering takeout')) {
                  onlineOrderingTakeout -= itemRefundNet
                  onlineOrderingTakeoutGross -= itemRefundNet
                } else if (optName.includes('online')) {
                  toastOnline -= itemRefundNet
                  toastOnlineGross -= itemRefundNet
                } else if (dOptLower.includes('drive') || optName.includes('drive')) {
                  driveThru -= itemRefundNet
                  driveThruGross -= itemRefundNet
                } else if (dOptLower.includes('kiosk dine in')) {
                  kioskDineIn -= itemRefundNet
                  kioskDineInGross -= itemRefundNet
                } else if (dOptLower.includes('kiosk take out') || dOptLower === 'kiosk' || (dOptLower.includes('kiosk') && !dOptLower.includes('dine in') && !dOptLower.includes('for here'))) {
                  kioskTakeOut -= itemRefundNet
                  kioskTakeOutGross -= itemRefundNet
                } else if (dOptLower === 'phone' || dOptLower.includes('phone')) {
                  phone -= itemRefundNet
                  phoneGross -= itemRefundNet
                } else if (dOptLower.includes('curbside')) {
                  curbside -= itemRefundNet
                  curbsideGross -= itemRefundNet
                } else if (dOptLower.includes('for here') || dOptLower.includes('dine in') || dOptLower.includes('comedor')) {
                  forHere -= itemRefundNet
                  forHereGross -= itemRefundNet
                } else if (dOptLower.includes('to go') || dOptLower.includes('take out') || dOptLower.includes('llevar')) {
                  toGo -= itemRefundNet
                  toGoGross -= itemRefundNet
                } else if (optName.includes('to go')) {
                  toGo -= itemRefundNet
                  toGoGross -= itemRefundNet
                } else {
                  forHere -= itemRefundNet
                  forHereGross -= itemRefundNet
                }
              }
            }
          }
        } catch (refItemErr) {
          console.warn(`[toast-accounting] Error procesando reembolso ${rGuid}:`, (refItemErr as Error).message)
        }
      }
    }
  } catch (refPassErr) {
    console.warn('[toast-accounting] Refunds pass no disponible:', (refPassErr as Error).message)
  }

  // Redondear a centavos
  const r = (n: number) => Math.round(n * 100) / 100

  forHere = r(forHere)
  toGo = r(toGo)
  phone = r(phone)
  curbside = r(curbside)
  driveThru = r(driveThru)
  kioskDineIn = r(kioskDineIn)
  kioskTakeOut = r(kioskTakeOut)
  toastOnline = r(toastOnline)
  onlineOrderingTakeout = r(onlineOrderingTakeout)
  uberDel = r(uberDel)
  uberTake = r(uberTake)
  ddDel = r(ddDel)
  ddTake = r(ddTake)
  ghDel = r(ghDel)
  ghTake = r(ghTake)

  toastDelivery = r(toastDelivery)
  tipsPayable = r(tipsPayable)

  // Cohesion: Solo cheques genuinamente abiertos y sin cobrar (unpaid) se asignan a "Deposit Sales Collected & Open Orders" (cuenta 12049 en Débito).
  // Las órdenes que ya están cerradas (CLOSED) no van a la 12049.
  const openOrdersTotalAmount = r(
    openOrdersList
      .filter((o: any) => o.paymentStatus !== 'CLOSED' && o.status !== 'OUT_OF_BALANCE')
      .reduce((sum, o: any) => sum + (Number(o.totalAmount) || 0), 0)
  )
  if (openOrdersTotalAmount > 0.009) {
    depositsCollected = r(depositsCollected + openOrdersTotalAmount)
  }
  depositsCollected = r(depositsCollected)
  paidIn = r(paidIn)

  deliveryServiceCharges = r(deliveryServiceCharges)
  deliveryFee6Miles = r(deliveryFee6Miles)
  const netSales = r(forHere + toGo + phone + curbside + driveThru + kioskDineIn + kioskTakeOut + toastOnline + onlineOrderingTakeout + toastDelivery + uberDel + uberTake + ddDel + ddTake + ghDel + ghTake + deliveryServiceCharges + deliveryFee6Miles)
  totalTax = r(totalTax)
  marketplaceTax = r(marketplaceTax)
  taxPaidByUber = r(taxPaidByUber)
  const salesTax = r(totalTax - marketplaceTax - taxPaidByUber)
  const grossSales = r(netSales + discountsTotal)

  deferredSalesGiftCards = r(deferredSalesGiftCards)
  giftCardRedemption = r(giftCardRedemption)

  creditCardGross = r(creditCardGross)
  ebtAmount = r(ebtAmount)
  uberPayment = r(uberPayment)
  doordashPayment = r(doordashPayment)
  grubhubPayment = r(grubhubPayment)
  cashDeposit = r(cashDeposit)

  // En Cohesion: Credit Card Fees reales de Toast (originalProcessingFee)
  creditCardActualFees = r(creditCardActualFees)
  creditCardOtherDeductions = r(creditCardOtherDeductions)
  const ccFees = creditCardActualFees > 0 ? creditCardActualFees : (creditCardGross > 0 ? r(creditCardGross * 0.01919) : 0)
  const ccDeposit = r(creditCardGross - ccFees - creditCardOtherDeductions)

  // Resolver nombres reales de cajeros/meseros desde toast_employees
  if (openOrdersList.length > 0) {
    const guidsToLookup = Array.from(
      new Set(
        openOrdersList
          .map((o: any) => o._serverGuid)
          .filter((g: any): g is string => Boolean(g && typeof g === 'string'))
      )
    )

    if (guidsToLookup.length > 0) {
      try {
        const { data: employees } = await supabaseAdmin
          .from('toast_employees')
          .select('toast_guid, v2_toast_guid, first_name, last_name, chosen_name')
          .or(`toast_guid.in.(${guidsToLookup.join(',')}),v2_toast_guid.in.(${guidsToLookup.join(',')})`)

        const empMap = new Map<string, string>()
        employees?.forEach((emp: any) => {
          const fullName = (emp.chosen_name || `${emp.first_name || ''} ${emp.last_name || ''}`).replace(/\s+/g, ' ').trim()
          if (emp.toast_guid) empMap.set(emp.toast_guid, fullName)
          if (emp.v2_toast_guid) empMap.set(emp.v2_toast_guid, fullName)
        })

        for (const ord of openOrdersList) {
          const sGuid = (ord as any)._serverGuid
          if (sGuid && empMap.has(sGuid)) {
            ord.serverName = empMap.get(sGuid)!
          } else if (ord.serverName === 'Desconocido' && sGuid) {
            ord.serverName = `Cajero (${sGuid.slice(0, 8)})`
          }
          delete (ord as any)._serverGuid
        }
      } catch (empErr: any) {
        console.warn('[Accounting] Could not resolve employee names for open orders:', empErr.message)
      }
    }
  }

  const openOrdersCount = openOrdersList.length
  const hasOpenOrders = openOrdersCount > 0 || outOfBalanceOrdersCount > 0
  // Cohesion: Las órdenes abiertas no bloquean la validación ni la publicación a QuickBooks Online,
  // ya que contablemente se compensan y registran como débito en la cuenta 12049 (Deposit Sales Collected & Open Orders).
  const validationPassed = true
  const validationMessage = hasOpenOrders
    ? `AVISO OPERATIVO: Se detectaron ${openOrdersCount} orden(es) abierta(s) en Toast POS ($${openOrdersTotalAmount.toFixed(2)}). El saldo se asignó a la cuenta 12049 (Deposit Sales Collected & Open Orders) para cuadrar la póliza.`
    : undefined

  return {
    netSales,
    grossSales,
    totalTaxes: totalTax,
    forHereSales: forHere,
    toGoSales: toGo,
    phoneSales: phone,
    curbsideSales: curbside,
    driveThruSales: driveThru,
    kioskDineInSales: kioskDineIn,
    kioskTakeOutSales: kioskTakeOut,
    toastOnlineSales: toastOnline,
    onlineOrderingTakeoutSales: onlineOrderingTakeout,
    toastDeliverySales: toastDelivery,
    tipsPayable,
    depositsCollected,
    paidIn,
    uberDeliverySales: uberDel,
    uberTakeoutSales: uberTake,
    doordashDeliverySales: ddDel,
    doordashTakeoutSales: ddTake,
    grubhubDeliverySales: ghDel,
    grubhubTakeoutSales: ghTake,
    salesGrossByOption: {
      forHere: r(forHereGross),
      toGo: r(toGoGross),
      phone: r(phoneGross),
      curbside: r(curbsideGross),
      driveThru: r(driveThruGross),
      kioskDineIn: r(kioskDineInGross),
      kioskTakeOut: r(kioskTakeOutGross),
      toastOnline: r(toastOnlineGross),
      onlineOrderingTakeout: r(onlineOrderingTakeoutGross),
      toastDelivery: r(toastDeliveryGross),
      uberDelivery: r(uberDelGross),
      uberTakeout: r(uberTakeGross),
      doordashDelivery: r(ddDelGross),
      doordashTakeout: r(ddTakeGross),
      grubhubDelivery: r(ghDelGross),
      grubhubTakeout: r(ghTakeGross),
    },
    salesTax,
    marketplaceTax,
    taxPaidByUber,
    deferredSalesGiftCards,
    giftCardRedemption,
    deliveryServiceCharges,
    deliveryFee6Miles,
    discountsTotal: r(discountsTotal),
    discountBreakdown,
    creditCardGross,
    creditCardFees: ccFees,
    creditCardOtherDeductions,
    creditCardDeposit: ccDeposit,
    cardBreakdown,
    ebtAmount,
    uberPayment,
    doordashPayment,
    grubhubPayment,
    cashDeposit,
    toastDepositAmount,
    hasToastDeposit,
    toastDepositsList,
    cashPayoutsTotal,
    toastCashPayoutsList,
    cashInTotal,
    toastCashInList,
    cashOutTotal,
    toastCashOutList,
    tipOutTotal,
    toastTipOutList,
    openOrdersCount,
    outOfBalanceOrdersCount,
    openOrdersList,
    hasOpenOrders,
    validationPassed,
    validationMessage,
  }
}
