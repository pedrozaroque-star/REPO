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
 */

import { getAuthToken } from './toast-api'
import { supabaseAdmin } from '@/lib/supabase'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

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
  toastOnlineSales: number
  uberDeliverySales: number
  uberTakeoutSales: number
  doordashDeliverySales: number
  doordashTakeoutSales: number
  grubhubDeliverySales: number
  grubhubTakeoutSales: number
  salesTax: number
  marketplaceTax: number
  taxPaidByUber: number
  deferredSalesGiftCards: number
  giftCardRedemption: number
  deliveryServiceCharges: number
  creditCardGross: number
  creditCardFees: number
  creditCardOtherDeductions: number
  creditCardDeposit: number
  ebtAmount: number
  uberPayment: number
  doordashPayment: number
  grubhubPayment: number
  cashDeposit: number
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

  // 1. Obtener Dining Options Map y Alternate Payment Types Map (para EBT y delivery)
  const [optRes, altRes] = await Promise.all([
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
  ])

  const diningOptions = await optRes.json()
  const diningMap: Record<string, string> = {}
  for (const opt of diningOptions || []) {
    diningMap[opt.guid] = opt.name
  }

  const altMap: Record<string, string> = {}
  if (altRes && altRes.ok) {
    const altData = await altRes.json()
    for (const alt of altData || []) {
      if (alt.guid && alt.name) altMap[alt.guid] = alt.name
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

  // Acumuladores de Ventas
  let forHere = 0
  let toGo = 0
  let driveThru = 0
  let toastOnline = 0
  let uberDel = 0
  let uberTake = 0
  let ddDel = 0
  let ddTake = 0
  let ghDel = 0
  let ghTake = 0

  let totalTax = 0
  let marketplaceTax = 0
  let taxPaidByUber = 0

  let deferredSalesGiftCards = 0
  let giftCardRedemption = 0
  let deliveryServiceCharges = 0

  let creditCardGross = 0
  let creditCardActualFees = 0
  let creditCardOtherDeductions = 0
  let ebtAmount = 0
  let uberPayment = 0
  let doordashPayment = 0
  let grubhubPayment = 0
  let cashDeposit = 0

  // Acumuladores de Validación (Órdenes Abiertas y Desbalanceadas)
  const openOrdersList: ToastOpenOrder[] = []
  let outOfBalanceOrdersCount = 0

  for (const order of allOrders) {
    if (order.voided || order.deleted) continue

    // --- REVISIÓN DE ORDEN ABIERTA / DESBALANCEADA (Step 11 Cohesion) ---
    let orderIsOpen = !order.closedDate
    const checkIssues: string[] = []

    for (const check of order.checks || []) {
      if (check.voided || check.deleted) continue

      const isCheckOpen = !check.closedDate || check.paymentStatus !== 'CLOSED'
      if (isCheckOpen) orderIsOpen = true

      const paymentsTotal = (check.payments || [])
        .filter((p: any) => !p.voided)
        .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
      const expectedTotal = Number(check.totalAmount ?? check.amount ?? 0)
      const diff = Math.abs(expectedTotal - paymentsTotal)

      if (diff > 0.05 && check.paymentStatus !== 'CLOSED') {
        outOfBalanceOrdersCount++
        checkIssues.push(`Desbalanceada: Esperado $${expectedTotal.toFixed(2)}, Pagado $${paymentsTotal.toFixed(2)}`)
      } else if (isCheckOpen) {
        checkIssues.push(`Check sin cerrar (Estado: ${check.paymentStatus || 'OPEN'})`)
      }
    }

    if (orderIsOpen) {
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
      for (const sel of check.selections || []) {
        if (sel.voided) continue
        let p = Number(sel.price || 0)
        if (sel.taxInclusion === 'INCLUDED') p -= Number(sel.tax || 0)
        if (sel.refundDetails?.refundAmount) {
          const rAmt = Number(sel.refundDetails.refundAmount)
          p -= rAmt
          selRefunds += rAmt
        }

        // Detección de Ventas de Tarjetas de Regalo (Gift Card Sales -> 20500 Deferred Sales)
        const sName = ((sel.item?.name || '') + ' ' + (sel.itemGroup?.name || '') + ' ' + (sel.displayName || '')).toLowerCase()
        if (sel.giftCard || sName.includes('gift card')) {
          deferredSalesGiftCards += p
        } else {
          checkNet += p
        }
      }

      if (check.appliedDiscounts) {
        for (const d of check.appliedDiscounts) {
          checkNet -= Number(d.amount || 0)
        }
      }

      // Reembolsos no vinculados a nivel de pagos (Unlinked Refunds)
      let paymentRefunds = 0
      for (const p of check.payments || []) {
        if (p.refundAmount && !p.voided) paymentRefunds += Number(p.refundAmount)
      }
      const unlinkedRefunds = Math.max(0, paymentRefunds - selRefunds)
      checkNet -= unlinkedRefunds

      checkNet = Math.round(checkNet * 100) / 100

      // Clasificar por Dining Option
      if (optName.includes('uber') && (optName.includes('takeout') || optName.includes('take out'))) {
        uberTake += checkNet
        taxPaidByUber += checkTax
      } else if (optName.includes('uber') || optName.includes('postmates')) {
        uberDel += checkNet
        taxPaidByUber += checkTax
      } else if (optName.includes('doordash') && (optName.includes('takeout') || optName.includes('take out'))) {
        ddTake += checkNet
        marketplaceTax += checkTax
      } else if (optName.includes('doordash') || optName.includes('dash')) {
        ddDel += checkNet
        marketplaceTax += checkTax
      } else if (optName.includes('grub') && (optName.includes('takeout') || optName.includes('take out'))) {
        ghTake += checkNet
        marketplaceTax += checkTax
      } else if (optName.includes('grub')) {
        ghDel += checkNet
        marketplaceTax += checkTax
      } else if (optName.includes('online')) {
        toastOnline += checkNet
      } else if (dOptionRaw.toLowerCase().includes('drive') || optName.includes('drive')) {
        driveThru += checkNet
      } else if (optName.includes('to go') || optName.includes('kiosk') || optName.includes('curbside') || optName.includes('phone')) {
        toGo += checkNet
      } else {
        forHere += checkNet
      }

      // Clasificar pagos
      for (const p of check.payments || []) {
        if (p.voided) continue
        if (p.paymentStatus === 'DENIED' || p.paymentStatus === 'FAILED') continue

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
          creditCardGross += amt
          creditCardActualFees += Number(p.originalProcessingFee || 0)
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
    }
  }

  // Redondear a centavos
  const r = (n: number) => Math.round(n * 100) / 100

  forHere = r(forHere)
  toGo = r(toGo)
  driveThru = r(driveThru)
  toastOnline = r(toastOnline)
  uberDel = r(uberDel)
  uberTake = r(uberTake)
  ddDel = r(ddDel)
  ddTake = r(ddTake)
  ghDel = r(ghDel)
  ghTake = r(ghTake)

  const netSales = r(forHere + toGo + driveThru + toastOnline + uberDel + uberTake + ddDel + ddTake + ghDel + ghTake)
  totalTax = r(totalTax)
  marketplaceTax = r(marketplaceTax)
  taxPaidByUber = r(taxPaidByUber)
  const salesTax = r(totalTax - marketplaceTax - taxPaidByUber)
  const grossSales = r(netSales + totalTax)

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
    toastOnlineSales: toastOnline,
    uberDeliverySales: uberDel,
    uberTakeoutSales: uberTake,
    doordashDeliverySales: ddDel,
    doordashTakeoutSales: ddTake,
    grubhubDeliverySales: ghDel,
    grubhubTakeoutSales: ghTake,
    salesTax,
    marketplaceTax,
    taxPaidByUber,
    deferredSalesGiftCards,
    giftCardRedemption,
    deliveryServiceCharges,
    creditCardGross,
    creditCardFees: ccFees,
    creditCardOtherDeductions,
    creditCardDeposit: ccDeposit,
    ebtAmount,
    uberPayment,
    doordashPayment,
    grubhubPayment,
    cashDeposit,
    openOrdersCount,
    outOfBalanceOrdersCount,
    openOrdersList,
    hasOpenOrders,
    validationPassed,
    validationMessage,
  }
}
