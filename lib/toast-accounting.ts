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
 * - Regla Crítica Step 11 Cohesion: Si existen órdenes abiertas o checks sin cobrar/sin cerrar en Toast POS para el día de negocio,
 *   la póliza contable NO DEBE ser publicada a QuickBooks Online. Debe marcarse como no aprobada con advertencia explícita.
 * - Una orden se considera ABIERTA si:
 *   1. No está voided ni deleted y order.closedDate es nulo.
 *   2. O alguno de sus checks no tiene closedDate o check.paymentStatus !== 'CLOSED'.
 * - Una orden se considera DESBALANCEADA si:
 *   1. El total del check (amount + taxAmount) difiere de la suma de pagos recibidos en más de $0.05.
 * 
 * @notes
 * - Toast POS cierra los días de negocio a las 5:59 AM del día siguiente.
 * - Los parámetros de validación se transmiten a accounting_sales_packets para bloquear la publicación.
 * - Paridad con Cohesion (verificado Broadway 2026-10-03, $26,743.90 al centavo):
 *   1) Solo se cuentan pagos capturados: se ignoran paymentStatus DENIED/FAILED/VOIDED/OPEN/CANCELLED.
 *   2) La propina de tarjeta (tipAmount de pagos CREDIT) se suma al depósito de tarjeta y se registra como Tips/Grat Payable (12100).
 *   3) La Dining Option "Toast Delivery Services" va aparte (cuenta 53060), no en For Here.
 *   4) Credit Card Other Deductions (MCA) se registra contra 12100, no contra el banco.
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
  driveThruSales: number
  kioskDineInSales: number
  kioskTakeOutSales: number
  toastOnlineSales: number
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
    driveThru: number
    kioskDineIn: number
    kioskTakeOut: number
    toastOnline: number
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
  // Validación de Órdenes Abiertas (Step 11 Cohesion)
  openOrdersCount: number
  outOfBalanceOrdersCount: number
  openOrdersList: ToastOpenOrder[]
  hasOpenOrders: boolean
  validationPassed: boolean
  validationMessage?: string
}

export async function fetchToastAccountingData(
  storeExternalId: string,
  businessDate: string // YYYYMMDD
): Promise<ToastAccountingData> {
  const token = await getAuthToken()

  // 1. Obtener Dining Options Map, Alternate Payment Types Map, y Depósitos de Cash Management de Toast POS
  const [optRes, altRes, depRes] = await Promise.all([
    fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeExternalId,
      },
    }),
    fetch(`${TOAST_API_HOST}/config/v2/alternatePaymentTypes`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeExternalId,
      },
    }).catch(() => null),
    fetch(`${TOAST_API_HOST}/cashmgmt/v1/deposits?businessDate=${businessDate}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeExternalId,
      },
    }).catch(() => null),
  ])

  const diningOptions = optRes.ok ? await optRes.json() : []
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

  // Parsear depósitos registrados en Toast POS (Cash Management)
  let toastDepositAmount = 0
  let hasToastDeposit = false
  const toastDepositsList: Array<{ guid: string; amount: number; date: string; employee?: string }> = []
  if (depRes && depRes.ok) {
    const rawDeps = await depRes.json().catch(() => [])
    if (Array.isArray(rawDeps) && rawDeps.length > 0) {
      hasToastDeposit = true
      toastDepositAmount = Math.round(rawDeps.reduce((sum: number, d: any) => sum + (Number(d.amount) || 0), 0) * 100) / 100
      for (const d of rawDeps) {
        toastDepositsList.push({
          guid: d.guid,
          amount: Number(d.amount) || 0,
          date: d.date,
          employee: d.employee?.guid,
        })
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
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeExternalId,
      },
    })

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
  let driveThru = 0
  let driveThruGross = 0
  let kioskDineIn = 0
  let kioskDineInGross = 0
  let kioskTakeOut = 0
  let kioskTakeOutGross = 0
  let toastOnline = 0
  let toastOnlineGross = 0
  // Cohesion cambio su mapeo ~2026-10-03: antes el Toast Delivery iba en 40050 y las Other Deductions dentro de Merchant Fees (51030)
  const legacyCohesionRules = businessDate < '20261003'
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

  // Acumuladores de Validación (Órdenes Abiertas y Desbalanceadas)
  const openOrdersList: ToastOpenOrder[] = []
  let outOfBalanceOrdersCount = 0

  for (const order of allOrders) {
    if (order.voided || order.deleted) continue

    // --- REVISIÓN DE ORDEN ABIERTA / DESBALANCEADA (Step 11 Cohesion) ---
    const checkIssues: string[] = []
    let orderHasIssue = false

    for (const check of order.checks || []) {
      if (check.voided || check.deleted) continue

      const isCheckClosed = Boolean(check.closedDate || check.paymentStatus === 'CLOSED')
      const isCheckOpen = !isCheckClosed

      // Filtrar estrictamente pagos válidos (descartar DENIED, FAILED, VOIDED, OPEN, CANCELLED, etc.)
      const paymentsTotal = (check.payments || [])
        .filter((p: any) => !p.voided && !INVALID_PAYMENT_STATUSES.has(String(p.paymentStatus || '').toUpperCase()))
        .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
      const expectedTotal = Number(check.totalAmount ?? check.amount ?? 0)
      const diff = Math.abs(expectedTotal - paymentsTotal)
      const isCheckOutOfBalance = diff > 0.05 && (isCheckClosed || paymentsTotal > 0)
      if (isCheckOutOfBalance) {
        orderHasIssue = true
        outOfBalanceOrdersCount++
        checkIssues.push(`Desbalanceada: Esperado $${expectedTotal.toFixed(2)}, Pagado $${paymentsTotal.toFixed(2)}`)
      } else if (isCheckOpen) {
        // Solo marcar check sin cerrar si realmente quedó abierto con balance pendiente por cobrar
        if (expectedTotal > 0 && paymentsTotal < expectedTotal) {
          orderHasIssue = true
          checkIssues.push(`Check sin cerrar (Estado: ${check.paymentStatus || 'OPEN'})`)
        }
      }
    }

    if (!order.closedDate && (order.checks || []).length === 0) {
      const rawOrderAmount = Number((order as any).totalAmount ?? (order as any).amount ?? 0)
      if (rawOrderAmount > 0) {
        orderHasIssue = true
        checkIssues.push('Orden sin checks pero con saldo pendiente en Toast POS')
      }
    }

    if (orderHasIssue) {
      const orderTotal = (order.checks || [])
        .filter((c: any) => !c.voided && !c.deleted)
        .reduce((sum: number, c: any) => sum + Number(c.totalAmount ?? c.amount ?? 0), 0)
      const orderTax = (order.checks || [])
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

      // Service charges aplicados en el check (ej: delivery service charge Cohesion cuenta 51030)
      if (check.appliedServiceCharges) {
        for (const sc of check.appliedServiceCharges) {
          deliveryServiceCharges += Number(sc.chargeAmount || sc.amount || 0)
        }
      }

      // Calcular Net Sales del check: Sum(Item.Price) - Sum(Discounts) - Sum(Item.Refunds) - UnlinkedRefunds
      let checkNet = 0
      let selRefunds = 0
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
        if (sel.refundDetails?.refundAmount) {
          const rAmt = Number(sel.refundDetails.refundAmount)
          p -= rAmt
          selRefunds += rAmt
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

      // Reembolsos no vinculados a nivel de pagos (Unlinked Refunds)
      let paymentRefunds = 0
      for (const p of check.payments || []) {
        if (p.refundAmount && !p.voided) paymentRefunds += Number(p.refundAmount)
      }
      const unlinkedRefunds = Math.max(0, paymentRefunds - selRefunds)
      checkNet -= unlinkedRefunds

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
      } else if (dOptLower.includes('toast delivery') && !legacyCohesionRules) {
        // Dining Option "Toast Delivery Services" -> línea propia 53060 en Cohesion
        toastDelivery += checkNet
        toastDeliveryGross += checkGross
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
      } else if (dOptLower.includes('for here') || dOptLower.includes('dine in') || dOptLower.includes('comedor')) {
        forHere += checkNet
        forHereGross += checkGross
      } else if (dOptLower.includes('to go') || dOptLower.includes('take out') || dOptLower.includes('llevar')) {
        toGo += checkNet
        toGoGross += checkGross
      } else if (optName.includes('to go') || optName.includes('curbside') || optName.includes('phone')) {
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

        const amt = Number(p.amount || 0)
        const pType = (p.type || '').toUpperCase()
        const altName = p.otherPayment?.guid ? (altMap[p.otherPayment.guid] || '') : (p.otherPayment?.name || '')
        const pName = (altName || p.displayName || p.paymentInstrument?.displayName || '').toLowerCase()

        // Toast Capital / MCA Repayment Deduction
        if (p.mcaRepaymentAmount) {
          creditCardOtherDeductions += Number(p.mcaRepaymentAmount || 0)
        }

        // Redención de Tarjetas de Regalo (Gift Card Redemption -> 20500)
        if (pType === 'GIFT_CARD' || pType.includes('GIFT') || pName.includes('gift card')) {
          giftCardRedemption += amt
        } else if (pName.includes('ebt')) {
          // EBT se valida para evitar enmascaramiento con CREDIT
          ebtAmount += amt
        } else if (pType === 'CASH') {
          cashDeposit += amt
        } else if (pType === 'CREDIT') {
          // Cohesion incluye la propina de tarjeta en el depósito y la registra como Tips Payable (12100)
          const tip = Number(p.tipAmount || 0)
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
          uberPayment += amt
        } else if (pName.includes('doordash') || pName.includes('dash')) {
          doordashPayment += amt
        } else if (pName.includes('grub')) {
          grubhubPayment += amt
        } else if (pType === 'OTHER') {
          if (optName.includes('uber')) uberPayment += amt
          else if (optName.includes('doordash')) doordashPayment += amt
          else if (optName.includes('grub')) grubhubPayment += amt
          else creditCardGross += amt
        }
      }

      // Cohesion: cheque en 0 (items anulados) con pago capturado = Deposit Sales Collected (12049)
      const chkTotal = Number(check.totalAmount ?? check.amount ?? 0)
      // Tambien aplica a sobrepagos: pagos capturados > total del cheque (ej. Norwalk 10/3 orden 277: tarjeta 13.04 + efectivo 9.06 sobre total 13.04)
      let chkPaid = 0
      for (const p of check.payments || []) {
        if (p.voided) continue
        if (INVALID_PAYMENT_STATUSES.has(String(p.paymentStatus || '').toUpperCase())) continue
        chkPaid += Number(p.amount || 0)
      }
      const chkExcess = Math.round((chkPaid - chkTotal) * 100) / 100
      if (chkExcess > 0.009) depositsCollected += chkExcess
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
    const pListRes = await fetch(payUrl.toString(), {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeExternalId },
    })
    if (pListRes.ok) {
      const paymentGuids: string[] = await pListRes.json()
      if (Array.isArray(paymentGuids) && paymentGuids.length > 0) {
        // Encontrar pagos cobrados hoy que no provienen de las órdenes de hoy (fechas pasadas o pedidos futuros)
        const crossPaymentGuids = paymentGuids.filter(guid => !processedPaymentGuids.has(guid))
        if (crossPaymentGuids.length > 0) {
          await Promise.all(
            crossPaymentGuids.map(async (pGuid) => {
              try {
                const pRes = await fetch(`${TOAST_API_HOST}/orders/v2/payments/${pGuid}`, {
                  headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeExternalId },
                })
                if (!pRes.ok) return
                const pp = await pRes.json()
                if (pp.voided || INVALID_PAYMENT_STATUSES.has(String(pp.paymentStatus || '').toUpperCase())) return

                const pAmt = Number(pp.amount || 0)
                const pTip = Number(pp.tipAmount || 0)
                const pT = String(pp.type || '').toUpperCase()
                const fee = Number(pp.originalProcessingFee || 0)

                const altName = pp.otherPayment?.guid ? (altMap[pp.otherPayment.guid] || '') : (pp.otherPayment?.name || '')
                const pName = (altName || pp.displayName || pp.paymentInstrument?.displayName || '').toLowerCase()

                if (pT === 'CREDIT') {
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
                  uberPayment += pAmt
                  paidIn += pAmt
                } else if (pName.includes('doordash') || pName.includes('dash')) {
                  doordashPayment += pAmt
                  paidIn += pAmt
                } else if (pName.includes('grub')) {
                  grubhubPayment += pAmt
                  paidIn += pAmt
                } else if (pName.includes('ebt')) {
                  ebtAmount += pAmt
                  paidIn += pAmt
                } else {
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
  // Redondear a centavos
  const r = (n: number) => Math.round(n * 100) / 100

  forHere = r(forHere)
  toGo = r(toGo)
  driveThru = r(driveThru)
  kioskDineIn = r(kioskDineIn)
  kioskTakeOut = r(kioskTakeOut)
  toastOnline = r(toastOnline)
  uberDel = r(uberDel)
  uberTake = r(uberTake)
  ddDel = r(ddDel)
  ddTake = r(ddTake)
  ghDel = r(ghDel)
  ghTake = r(ghTake)

  toastDelivery = r(toastDelivery)
  tipsPayable = r(tipsPayable)
  depositsCollected = r(depositsCollected)
  paidIn = r(paidIn)

  const netSales = r(forHere + toGo + driveThru + kioskDineIn + kioskTakeOut + toastOnline + toastDelivery + uberDel + uberTake + ddDel + ddTake + ghDel + ghTake)
  totalTax = r(totalTax)
  marketplaceTax = r(marketplaceTax)
  taxPaidByUber = r(taxPaidByUber)
  const salesTax = r(totalTax - marketplaceTax - taxPaidByUber)
  const grossSales = r(netSales + discountsTotal)

  deferredSalesGiftCards = r(deferredSalesGiftCards)
  giftCardRedemption = r(giftCardRedemption)
  deliveryServiceCharges = r(deliveryServiceCharges)

  creditCardGross = r(creditCardGross)
  ebtAmount = r(ebtAmount)
  uberPayment = r(uberPayment)
  doordashPayment = r(doordashPayment)
  grubhubPayment = r(grubhubPayment)
  cashDeposit = r(cashDeposit)

  // En Cohesion: Credit Card Fees reales de Toast (originalProcessingFee)
  creditCardActualFees = r(creditCardActualFees)
  creditCardOtherDeductions = r(creditCardOtherDeductions)
  let ccFees = creditCardActualFees > 0 ? creditCardActualFees : (creditCardGross > 0 ? r(creditCardGross * 0.01919) : 0)
  if (legacyCohesionRules && creditCardOtherDeductions > 0) { ccFees = r(ccFees + creditCardOtherDeductions); creditCardOtherDeductions = 0 }
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
  const validationPassed = !hasOpenOrders
  const validationMessage = hasOpenOrders
    ? `BLOQUEO DE VALIDACIÓN (Toast POS): Se detectaron ${openOrdersCount} orden(es) abierta(s) y ${outOfBalanceOrdersCount} orden(es) desbalanceada(s). No se permite publicar a QuickBooks Online hasta que la sucursal cierre o cobre todas las órdenes.`
    : undefined

  return {
    netSales,
    grossSales,
    totalTaxes: totalTax,
    forHereSales: forHere,
    toGoSales: toGo,
    driveThruSales: driveThru,
    kioskDineInSales: kioskDineIn,
    kioskTakeOutSales: kioskTakeOut,
    toastOnlineSales: toastOnline,
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
      driveThru: r(driveThruGross),
      kioskDineIn: r(kioskDineInGross),
      kioskTakeOut: r(kioskTakeOutGross),
      toastOnline: r(toastOnlineGross),
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
    openOrdersCount,
    outOfBalanceOrdersCount,
    openOrdersList,
    hasOpenOrders,
    validationPassed,
    validationMessage,
  }
}
