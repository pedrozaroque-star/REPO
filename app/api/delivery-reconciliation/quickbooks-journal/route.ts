/**
 * @module app/api/delivery-reconciliation/quickbooks-journal/route
 * @description Endpoint para previsualizar, auditar (con órdenes e impuestos involucrados) y publicar en QuickBooks Online
 *              las Pólizas Semanales de Liquidación de Plataformas Delivery (`Settlement Journal Entries` para Uber Eats, DoorDash y Grubhub).
 *
 * @businessRules
 * 1. Replica la autenticación OAuth 2.0 y flujo de creación individual/por lote del módulo `Crear Bills` (`/api/quickbooks/bills`).
 * 2. Estructura Oficial de 4 Líneas en QuickBooks Online (Tacos Gavilan LLC):
 *    - **Línea 1 (DEBIT)**: Cuenta Bancaria de la Sucursal (`10000`–`10017`, ej. `10014 Norwalk` `QB_ID: 378`) por `net_payout_amount`.
 *    - **Línea 2 (DEBIT)**: Cuenta de Comisiones (`50039 Uber Eats Fee` `ID 353` | `50036 Doordash Fees` `ID 375` | `50037 Grubhub Fees` `ID 374`) por `|total_fees|`.
 *    - **Línea 3 (CREDIT)**: Cuenta por Cobrar (`12050 Uber Eats` `ID 349` | `12053 DoorDash` `ID 372` | `12054 Grubhub` `ID 373`) por el Bruto Reconocido (`Gross - Facilitator Tax`), con descripción `MM.DD.YY-MM.DD.YY [Platform] Settlement`.
 *    - **Línea 4 (DEBIT o CREDIT)**: Cuenta de Ventas (`40060 Sales-Uber Eats` `ID 277` | `40062 Sales - Doordash` `ID 370` | `40063 Sales - Grubhub` `ID 371`) por el neto de `error_charges + adjustments_amount` (`CUSTOMER REFUNDS / ERROR CHARGES`).
 * 3. Opción de Recuperación de Sales Tax (`splitTaxOnRefunds` para DoorDash y Grubhub):
 *    - Separa automáticamente el `Sales Tax (~10.25%)` embebido en los `Error Charges / Customer Refunds` de DoorDash y Grubhub hacia un `DEBIT` en `24001 Sales tax payable` (`QB_ID: 40`) para evitar pagar al estado impuestos de órdenes descontadas o no logradas.
 * 4. Transparencia Orden por Orden:
 *    - Expone qué órdenes específicas integran los descuentos/reembolsos de la Línea 4 (incluyendo reembolsos en cortes posteriores como `#650DD`) y qué órdenes cerradas en Toast POS no fueron pagadas en el corte.
 *
 * @dataFlow
 * - GET `/api/delivery-reconciliation/quickbooks-journal` -> Cruza `delivery_platform_payouts` + `delivery_platform_orders` + QBO `JournalEntry`.
 * - POST `/api/delivery-reconciliation/quickbooks-journal` -> Crea uno o múltiples `JournalEntry` en QuickBooks Online y guarda `qb_journal_entry_id`.
 *
 * @notes
 * - Incluye validación anti-duplicados contra QuickBooks Online antes de publicar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthClient } from '@/lib/quickbooks'
import { getQBStoreRefs } from '@/lib/qb-classes-locations'
import { DeliveryPlatformCode, getStorePlatformMappings, round2 } from '@/lib/delivery-reconciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface PlatformQBConfig {
  receivableAccountNum: string
  receivableQbId: string
  receivableName: string
  feeAccountNum: string
  feeQbId: string
  feeName: string
  salesAccountNum: string
  salesQbId: string
  salesName: string
  settlementTitle: string
  refundLineTitle: string
}

const PLATFORM_QB_CONFIG: Record<DeliveryPlatformCode, PlatformQBConfig> = {
  UBER_EATS: {
    receivableAccountNum: '12050',
    receivableQbId: '349',
    receivableName: 'Receivables Due from Uber Eats',
    feeAccountNum: '50039',
    feeQbId: '353',
    feeName: 'Uber Eats Fee',
    salesAccountNum: '40060',
    salesQbId: '277',
    salesName: 'Sales-Uber Eats',
    settlementTitle: 'Uber Eats Settlement',
    refundLineTitle: 'Uber Eats Settlement - CUSTOMER REFUNDS',
  },
  DOORDASH: {
    receivableAccountNum: '12053',
    receivableQbId: '372',
    receivableName: 'Receivables Due from Doordash',
    feeAccountNum: '50036',
    feeQbId: '375',
    feeName: 'Doordash Fees',
    salesAccountNum: '40062',
    salesQbId: '370',
    salesName: 'Sales - Doordash',
    settlementTitle: 'Doordash Statement',
    refundLineTitle: 'Doordash Statement - ERROR CHARGES',
  },
  GRUBHUB: {
    receivableAccountNum: '12054',
    receivableQbId: '373',
    receivableName: 'Receivables Due from Grubhub',
    feeAccountNum: '50037',
    feeQbId: '374',
    feeName: 'Grubhub Fees',
    salesAccountNum: '40063',
    salesQbId: '371',
    salesName: 'Sales - Grubhub',
    settlementTitle: 'Grubhub Settlement',
    refundLineTitle: 'Grubhub Settlement - REFUNDS',
  },
}

const SALES_TAX_PAYABLE_QB = {
  accountNum: '24001',
  qbId: '40',
  name: 'Sales tax payable',
}

function fmtShortPeriodDot(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const parts = String(isoDate).slice(0, 10).split('-')
  if (parts.length !== 3) return String(isoDate)
  return `${parts[1]}.${parts[2]}.${parts[0].slice(2)}`
}

async function getValidQuickBooksToken(): Promise<{ token: string; realmId: string }> {
  const { data: integ, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  if (error || !integ || !integ.access_token) {
    throw new Error('No active QuickBooks token found. Please re-authenticate.')
  }

  let token = integ.access_token
  const realmId = integ.realm_id

  if (new Date(integ.expires_at) <= new Date(Date.now() + 60000)) {
    const authClient = getAuthClient()
    const refreshRes = await authClient.refreshUsingToken(integ.refresh_token)
    const newTokens = refreshRes.getJson()
    token = newTokens.access_token

    await supabaseAdmin
      .from('integrations')
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', integ.id)
  }

  return { token, realmId }
}

export interface SettlementJournalLinePreview {
  lineNumber: number
  accountNumber: string
  accountQbId: string
  accountName: string
  postingType: 'Debit' | 'Credit'
  amount: number
  description: string
  locationName: string
  locationId: string
  className: string
  classId: string
}

export function buildPayoutJournalPreview(params: {
  payout: any
  storeName: string
  storeOrders: any[]
  splitTaxOnRefunds?: boolean
}) {
  const { payout, storeName, storeOrders, splitTaxOnRefunds = false } = params
  const plat = (payout.platform as DeliveryPlatformCode) || 'UBER_EATS'
  const cfg = PLATFORM_QB_CONFIG[plat] || PLATFORM_QB_CONFIG.UBER_EATS
  const storeRefs = getQBStoreRefs(storeName)

  const parseRawMoney = (val: any): number | null => {
    if (typeof val === 'number' && Number.isFinite(val)) return round2(val)
    if (typeof val === 'string' && val.trim()) {
      const cleaned = val.replace(/[^0-9.-]/g, '')
      const n = Number(cleaned)
      if (Number.isFinite(n)) return round2(n)
    }
    return null
  }

  const netPayout = round2(Number(payout.net_payout_amount || 0))

  // En Uber Eats, `raw_payload.uberFees` + `raw_payload.marketing` tiene el total exacto de comisiones del estado de cuenta semanal
  let totalFees = round2(
    Math.abs(
      Number(payout.commission_fees || 0) +
        Number(payout.delivery_fees || 0) +
        Number(payout.processing_fees || 0) +
        Number(payout.marketing_fees || 0)
    )
  )
  if (plat === 'UBER_EATS' && payout.raw_payload?.uberFees !== undefined) {
    const uFees = Math.abs(parseRawMoney(payout.raw_payload.uberFees) ?? 0)
    const uMkt = Math.abs(parseRawMoney(payout.raw_payload.marketing) ?? 0)
    if (uFees + uMkt > 0) {
      totalFees = round2(uFees + uMkt)
    }
  }

  // En Uber Eats, la Línea 3 (`12050 Receivables Due from Uber Eats`) es `Gross Sales (earnings) - Marketplace Facilitator Tax`
  // Y la Línea 4 (`40060 Sales-Uber Eats`) es `Amendments + Marketplace Facilitator Tax` = `(netPayout + totalFees) - receivableCredit`
  let receivableCredit = 0
  let rawErrAdj = 0

  if (plat === 'UBER_EATS') {
    const grossEarnings = parseRawMoney(payout.raw_payload?.earnings)
    const facTax = Number(payout.tax_remitted_by_platform || 0)
    if (grossEarnings !== null && grossEarnings > 0 && facTax > 0) {
      receivableCredit = round2(grossEarnings - facTax)
      rawErrAdj = round2(netPayout + totalFees - receivableCredit)
    } else {
      rawErrAdj = round2(Number(payout.error_charges || 0) + Number(payout.adjustments_amount || 0))
      receivableCredit = round2(netPayout + totalFees - rawErrAdj)
    }
  } else {
    rawErrAdj = round2(Number(payout.error_charges || 0) + Number(payout.adjustments_amount || 0))
    receivableCredit = round2(netPayout + totalFees - rawErrAdj)
  }

  const pStartDot = fmtShortPeriodDot(payout.period_start || payout.payout_date)
  const pEndDot = fmtShortPeriodDot(payout.period_end || payout.payout_date)
  const periodPrefix = pStartDot && pEndDot ? `${pStartDot}-${pEndDot} ` : ''

  const lines: SettlementJournalLinePreview[] = [
    {
      lineNumber: 1,
      accountNumber: storeRefs.bankAccount,
      accountQbId: storeRefs.bankAccountQbId,
      accountName: `${storeRefs.bankAccount} ${storeRefs.bankAccountName.replace(/^\d+\s*-\s*/, '')}`,
      postingType: netPayout >= 0 ? 'Debit' : 'Credit',
      amount: Math.abs(netPayout),
      description: cfg.settlementTitle,
      locationName: storeRefs.locationName,
      locationId: storeRefs.locationId,
      className: storeRefs.className,
      classId: storeRefs.classId,
    },
    {
      lineNumber: 2,
      accountNumber: cfg.feeAccountNum,
      accountQbId: cfg.feeQbId,
      accountName: `${cfg.feeAccountNum} ${cfg.feeName}`,
      postingType: 'Debit',
      amount: totalFees,
      description: cfg.settlementTitle,
      locationName: storeRefs.locationName,
      locationId: storeRefs.locationId,
      className: storeRefs.className,
      classId: storeRefs.classId,
    },
    {
      lineNumber: 3,
      accountNumber: cfg.receivableAccountNum,
      accountQbId: cfg.receivableQbId,
      accountName: `${cfg.receivableAccountNum} ${cfg.receivableName}`,
      postingType: 'Credit',
      amount: Math.abs(receivableCredit),
      description: `${periodPrefix}${cfg.settlementTitle}`,
      locationName: storeRefs.locationName,
      locationId: storeRefs.locationId,
      className: storeRefs.className,
      classId: storeRefs.classId,
    },
  ]

  // Impuesto embebido en cargos por error de DoorDash / Grubhub (cuando nos descuentan órdenes con tax incluido)
  const embeddedRefundTax =
    plat !== 'UBER_EATS' && rawErrAdj < -0.01
      ? round2(Math.abs(rawErrAdj) - Math.abs(rawErrAdj) / 1.1025)
      : 0

  if (Math.abs(rawErrAdj) >= 0.01) {
    if (splitTaxOnRefunds && embeddedRefundTax > 0.01 && rawErrAdj < 0) {
      const subtotalPortion = round2(Math.abs(rawErrAdj) - embeddedRefundTax)
      lines.push({
        lineNumber: 4,
        accountNumber: cfg.salesAccountNum,
        accountQbId: cfg.salesQbId,
        accountName: `${cfg.salesAccountNum} ${cfg.salesName}`,
        postingType: 'Debit',
        amount: subtotalPortion,
        description: `${cfg.refundLineTitle} (Subtotal excl. Tax)`,
        locationName: storeRefs.locationName,
        locationId: storeRefs.locationId,
        className: storeRefs.className,
        classId: storeRefs.classId,
      })
      lines.push({
        lineNumber: 5,
        accountNumber: SALES_TAX_PAYABLE_QB.accountNum,
        accountQbId: SALES_TAX_PAYABLE_QB.qbId,
        accountName: `${SALES_TAX_PAYABLE_QB.accountNum} ${SALES_TAX_PAYABLE_QB.name}`,
        postingType: 'Debit',
        amount: embeddedRefundTax,
        description: `${cfg.refundLineTitle} (Reversión Sales Tax 24001)`,
        locationName: storeRefs.locationName,
        locationId: storeRefs.locationId,
        className: storeRefs.className,
        classId: storeRefs.classId,
      })
    } else {
      lines.push({
        lineNumber: 4,
        accountNumber: cfg.salesAccountNum,
        accountQbId: cfg.salesQbId,
        accountName: `${cfg.salesAccountNum} ${cfg.salesName}`,
        // Si rawErrAdj < 0 (nos quitaron dinero por reembolsos/errores), es un DEBIT que disminuye Ventas.
        // Si rawErrAdj > 0 (nos devolvieron dinero neto por disputas ganadas como #650DD +$240.99 - $27.05 = +$213.94), es un CREDIT.
        postingType: rawErrAdj < 0 ? 'Debit' : 'Credit',
        amount: Math.abs(rawErrAdj),
        description: cfg.refundLineTitle,
        locationName: storeRefs.locationName,
        locationId: storeRefs.locationId,
        className: storeRefs.className,
        classId: storeRefs.classId,
      })
    }
  }

  const totalDebits = round2(
    lines.filter((l) => l.postingType === 'Debit').reduce((acc, l) => acc + l.amount, 0)
  )
  const totalCredits = round2(
    lines.filter((l) => l.postingType === 'Credit').reduce((acc, l) => acc + l.amount, 0)
  )

  // Identificar órdenes involucradas en este corte o rango de fechas
  const pStart = payout.period_start || payout.payout_date || ''
  const pEnd = payout.period_end || payout.payout_date || ''

  const periodOrders = storeOrders.filter(
    (o) =>
      o.platform === plat &&
      (o.payout_reference_id === payout.payout_reference_id ||
        (pStart && pEnd && o.business_date >= pStart && o.business_date <= pEnd))
  )

  const settledOrdersInCut = periodOrders.filter(
    (o) => o.match_confidence !== 'TOAST_ONLY' && o.reconciliation_status !== 'MISSING_IN_PLATFORM'
  )

  const deductedOrders = settledOrdersInCut.filter(
    (o) =>
      Number(o.error_charge || 0) < -0.01 ||
      Number(o.adjustment_amount || 0) !== 0 ||
      o.reconciliation_status === 'REFUNDED_OR_DISPUTED' ||
      o.is_disputed
  )

  const crossPayoutRefunds: Array<{
    orderCode: string
    orderDate: string | null
    amount: number
    description: string
  }> = Array.isArray(payout.raw_payload?.cross_payout_refunds)
    ? payout.raw_payload.cross_payout_refunds
    : []

  const unpaidToastOrders = periodOrders.filter(
    (o) => o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
  )

  const unpaidToastSubtotal = round2(
    unpaidToastOrders.reduce((acc, o) => acc + Number(o.toast_net_sales || 0), 0)
  )
  const unpaidToastTax = round2(
    unpaidToastOrders.reduce((acc, o) => acc + Number(o.toast_tax || 0), 0)
  )

  // Impuesto de órdenes descontadas en este corte (según Toast Tax de las órdenes con error_charge < 0)
  const deductedOrdersToastTax = round2(
    deductedOrders
      .filter((o) => Number(o.error_charge || 0) < -0.01)
      .reduce((acc, o) => acc + Number(o.toast_tax || 0), 0)
  )

  const adjustmentsInCut = round2(Number(payout.adjustments_amount || 0))
  const chargebacksInCut = round2(rawErrAdj - adjustmentsInCut)

  return {
    txnDate: payout.period_end || payout.payout_date || new Date().toISOString().slice(0, 10),
    lines,
    totalDebits,
    totalCredits,
    isBalanced: Math.abs(totalDebits - totalCredits) <= 0.02,
    receivableCredit,
    rawErrAdj,
    chargebacksInCut,
    adjustmentsInCut,
    embeddedRefundTax,
    auditBreakdown: {
      settledOrdersCount: settledOrdersInCut.length || Number(payout.orders_count || 0),
      deductedOrders: deductedOrders.map((o) => ({
        id: o.id,
        platform_order_id: o.platform_order_id,
        business_date: o.business_date,
        toast_display_number: o.toast_display_number,
        toast_tab_name: o.toast_tab_name,
        toast_net_sales: Number(o.toast_net_sales || 0),
        toast_tax: Number(o.toast_tax || 0),
        platform_subtotal: Number(o.platform_subtotal || 0),
        error_charge: Number(o.error_charge || 0),
        adjustment_amount: Number(o.adjustment_amount || 0),
        net_payout: Number(o.net_payout || 0),
        dispute_status: o.dispute_status,
        dispute_reason: o.dispute_reason,
        reimbursement_payout_ref: o.raw_payload?.reimbursement_payout_ref || null,
        reimbursement_amount: o.raw_payload?.reimbursement_amount || null,
      })),
      crossPayoutRefunds,
      unpaidToastOrdersCount: unpaidToastOrders.length,
      unpaidToastSubtotal,
      unpaidToastTax,
      deductedOrdersToastTax,
      totalAtRiskTax: round2(
        (plat !== 'UBER_EATS' ? Math.max(embeddedRefundTax, deductedOrdersToastTax) : 0) +
          (plat !== 'UBER_EATS' ? unpaidToastTax : 0)
      ),
      unpaidToastOrdersSample: unpaidToastOrders.slice(0, 15).map((o) => ({
        id: o.id,
        platform_order_id: o.platform_order_id,
        business_date: o.business_date,
        toast_display_number: o.toast_display_number,
        toast_tab_name: o.toast_tab_name,
        toast_net_sales: Number(o.toast_net_sales || 0),
        toast_tax: Number(o.toast_tax || 0),
        toast_expected_gross: Number(o.toast_expected_gross || 0),
      })),
    },
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('store_id')
    const platformParam = searchParams.get('platform')
    const statusParam = searchParams.get('status') || 'ALL'
    const startDate = searchParams.get('start_date') || ''
    const endDate = searchParams.get('end_date') || ''
    const search = (searchParams.get('search') || '').trim().toLowerCase()

    const mappings = await getStorePlatformMappings()
    const storeNameMap = new Map<number, { name: string; code: string }>()
    for (const m of mappings) {
      storeNameMap.set(m.store_id, { name: m.store_name, code: m.store_code })
    }

    let payoutsQuery = supabaseAdmin
      .from('delivery_platform_payouts')
      .select('*')
      .order('period_end', { ascending: false })
      .order('payout_date', { ascending: false })

    let ordersQuery = supabaseAdmin
      .from('delivery_platform_orders')
      .select('*')
      .order('business_date', { ascending: false })

    if (storeIdParam && storeIdParam !== 'ALL' && Number.isFinite(Number(storeIdParam))) {
      const sId = Number(storeIdParam)
      payoutsQuery = payoutsQuery.eq('store_id', sId)
      ordersQuery = ordersQuery.eq('store_id', sId)
    }

    if (platformParam && platformParam !== 'ALL') {
      payoutsQuery = payoutsQuery.eq('platform', platformParam)
      ordersQuery = ordersQuery.eq('platform', platformParam)
    }

    const [{ data: rawPayoutsAll, error: payErr }, { data: rawOrders, error: ordErr }] = await Promise.all([
      payoutsQuery.limit(400),
      ordersQuery.limit(4000),
    ])

    if (payErr) throw new Error(payErr.message)
    if (ordErr) throw new Error(ordErr.message)

    // Filtrar cortes por rango de fechas [startDate, endDate] (salvo cuando hay una búsqueda específica por folio/orden)
    const rawPayouts = (rawPayoutsAll || []).filter((p: any) => {
      if (search && search.length >= 2) return true
      if (!startDate && !endDate) return true
      const pEnd = p.period_end || ''
      const pStart = p.period_start || pEnd
      const pPay = p.payout_date || ''
      const effStart = startDate || '2020-01-01'
      const effEnd = endDate || '2099-12-31'
      if (pStart && pEnd) {
        return pStart <= effEnd && pEnd >= effStart
      }
      if (pPay) {
        return pPay >= effStart && pPay <= effEnd
      }
      return true
    })

    // Calcular ventana de fechas dinámica para consultar en QuickBooks Online el 100% de las pólizas del rango seleccionado
    let minQbDate = startDate || '2026-09-01'
    let maxQbDate = endDate || new Date().toISOString().slice(0, 10)
    for (const p of rawPayouts) {
      const ps = p.period_start || p.payout_date || ''
      const pe = p.payout_date || p.period_end || ''
      if (ps && ps < minQbDate) minQbDate = ps
      if (pe && pe > maxQbDate) maxQbDate = pe
    }
    const minQbDateBuffered = new Date(new Date(`${minQbDate}T12:00:00Z`).getTime() - 7 * 86400000)
      .toISOString()
      .slice(0, 10)
    const maxQbDateBuffered = new Date(new Date(`${maxQbDate}T12:00:00Z`).getTime() + 14 * 86400000)
      .toISOString()
      .slice(0, 10)

    // Consultar Journal Entries existentes en QuickBooks Online para cruzar cuáles cortes ya están publicados
    let qbJournalEntries: any[] = []
    let isAuthError = false
    let qbErrorMsg: string | null = null
    let nextSuggestedDocNumber = '20261060'

    try {
      const { token, realmId } = await getValidQuickBooksToken()
      for (const startPos of [1, 1001]) {
        const q = encodeURIComponent(
          `select * from JournalEntry where TxnDate >= '${minQbDateBuffered}' and TxnDate <= '${maxQbDateBuffered}' orderby TxnDate desc startposition ${startPos} maxresults 1000`
        )
        const qbRes = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${q}&minorversion=75`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (qbRes.status === 401) {
          isAuthError = true
          qbErrorMsg = 'La sesión de QuickBooks Online ha expirado. Por favor reconecta la cuenta.'
          break
        } else if (qbRes.ok) {
          const qbJson = await qbRes.json()
          const pageEntries: any[] = qbJson?.QueryResponse?.JournalEntry || []
          qbJournalEntries.push(...pageEntries)
          if (pageEntries.length < 1000) break
        } else {
          break
        }
      }

      if (qbJournalEntries.length > 0) {
        // Calcular el siguiente DocNumber secuencial tipo 202610XX
        let maxNum = 20261000
        for (const je of qbJournalEntries) {
          const doc = String(je.DocNumber || '').trim()
          if (/^2026\d{4}$/.test(doc)) {
            const n = parseInt(doc, 10)
            if (n > maxNum) maxNum = n
          }
        }
        nextSuggestedDocNumber = String(maxNum + 1)
      }
    } catch (qbErr: any) {
      const msg = String(qbErr?.message || '')
      if (
        msg.includes('token') ||
        msg.includes('auth') ||
        msg.includes('invalid_grant') ||
        msg.includes('401') ||
        msg.includes('re-authenticate')
      ) {
        isAuthError = true
        qbErrorMsg = 'La sesión de QuickBooks Online ha expirado. Por favor reconecta la cuenta.'
      }
    }

    const ordersByStore = new Map<number, any[]>()
    for (const o of rawOrders || []) {
      const sId = Number(o.store_id)
      const arr = ordersByStore.get(sId) || []
      arr.push(o)
      ordersByStore.set(sId, arr)
    }

    let enrichedRecords = (rawPayouts || []).map((p: any) => {
      const storeMeta = storeNameMap.get(p.store_id) || { name: `Store #${p.store_id}`, code: '' }
      const storeRefs = getQBStoreRefs(storeMeta.name)
      const plat = (p.platform as DeliveryPlatformCode) || 'UBER_EATS'
      const cfg = PLATFORM_QB_CONFIG[plat] || PLATFORM_QB_CONFIG.UBER_EATS
      const storeOrders = ordersByStore.get(p.store_id) || []

      const preview = buildPayoutJournalPreview({
        payout: p,
        storeName: storeMeta.name,
        storeOrders,
        splitTaxOnRefunds: false,
      })

      // Verificar si ya existe en QuickBooks Online (por ID guardado o por match de Location + Cuenta CxC + Monto/Fecha)
      const savedQbId = p.raw_payload?.qb_journal_entry_id
      let matchedJe = savedQbId
        ? qbJournalEntries.find((je) => String(je.Id) === String(savedQbId))
        : null

      if (!matchedJe && qbJournalEntries.length > 0) {
        matchedJe = qbJournalEntries.find((je) => {
          const lines: any[] = je.Line || []
          // Debe pertenecer a la misma sucursal (DepartmentRef) y tener la cuenta CxC de la plataforma (349, 372 o 373)
          const hasDeptAndPlatformAr = lines.some(
            (l) =>
              String(l?.JournalEntryLineDetail?.DepartmentRef?.value) === String(storeRefs.locationId) &&
              String(l?.JournalEntryLineDetail?.AccountRef?.value) === String(cfg.receivableQbId) &&
              l?.JournalEntryLineDetail?.PostingType === 'Credit'
          )
          if (!hasDeptAndPlatformAr) return false

          // Verificar coincidencia de monto en banco (±$1.00) o coincidencia de fecha del corte
          const bankLine = lines.find(
            (l) =>
              String(l?.JournalEntryLineDetail?.AccountRef?.value) === String(storeRefs.bankAccountQbId) &&
              l?.JournalEntryLineDetail?.PostingType === 'Debit'
          )
          const bankAmt = Number(bankLine?.Amount || 0)
          const netPay = Math.abs(Number(p.net_payout_amount || 0))
          if (netPay > 0 && Math.abs(bankAmt - netPay) <= 1.0) {
            return true
          }
          return false
        })
      }

      const hasJournalEntry = Boolean(matchedJe || savedQbId)
      const qbJournalEntry = matchedJe
        ? {
            id: String(matchedJe.Id),
            docNumber: String(matchedJe.DocNumber || p.raw_payload?.qb_doc_number || ''),
            txnDate: String(matchedJe.TxnDate || preview.txnDate),
            totalAmount: preview.totalDebits,
          }
        : savedQbId
        ? {
            id: String(savedQbId),
            docNumber: String(p.raw_payload?.qb_doc_number || ''),
            txnDate: String(p.raw_payload?.qb_txn_date || preview.txnDate),
            totalAmount: preview.totalDebits,
          }
        : null

      return {
        id: p.id,
        store_id: p.store_id,
        store_name: storeMeta.name,
        store_code: storeMeta.code,
        platform: plat,
        payout_reference_id: p.payout_reference_id,
        period_start: p.period_start,
        period_end: p.period_end,
        payout_date: p.payout_date,
        net_payout_amount: Number(p.net_payout_amount || 0),
        platform_gross_receivable: preview.receivableCredit,
        total_fees: round2(
          Math.abs(
            Number(p.commission_fees || 0) +
              Number(p.delivery_fees || 0) +
              Number(p.processing_fees || 0) +
              Number(p.marketing_fees || 0)
          )
        ),
        net_refunds_adjustments: preview.rawErrAdj,
        hasJournalEntry,
        qbJournalEntry,
        journalPreview: preview,
      }
    })

    if (search) {
      enrichedRecords = enrichedRecords.filter((r) => {
        const audit = r.journalPreview?.auditBreakdown || {}
        const hasOrderMatch =
          (audit.deductedOrders || []).some(
            (o: any) =>
              String(o.platform_order_id || '').toLowerCase().includes(search) ||
              String(o.toast_display_number || '').toLowerCase().includes(search) ||
              String(o.toast_tab_name || '').toLowerCase().includes(search)
          ) ||
          (audit.crossPayoutRefunds || []).some(
            (cr: any) =>
              String(cr.orderCode || '').toLowerCase().includes(search) ||
              String(cr.description || '').toLowerCase().includes(search)
          )
        return (
          String(r.payout_reference_id || '').toLowerCase().includes(search) ||
          String(r.store_name || '').toLowerCase().includes(search) ||
          String(r.platform || '').toLowerCase().includes(search) ||
          String(r.period_start || '').toLowerCase().includes(search) ||
          String(r.period_end || '').toLowerCase().includes(search) ||
          String(r.payout_date || '').toLowerCase().includes(search) ||
          String(r.qbJournalEntry?.docNumber || '').toLowerCase().includes(search) ||
          String(r.qbJournalEntry?.id || '').toLowerCase().includes(search) ||
          hasOrderMatch
        )
      })
    }

    if (statusParam && statusParam !== 'ALL') {
      enrichedRecords = enrichedRecords.filter((r) => {
        const audit = r.journalPreview?.auditBreakdown || {}
        if (statusParam === 'QB_CREATED') return r.hasJournalEntry
        if (statusParam === 'QB_PENDING') return !r.hasJournalEntry
        if (statusParam === 'MATCHED') return Math.abs(r.net_refunds_adjustments || 0) < 0.01
        if (statusParam === 'REFUNDED_OR_DISPUTED') {
          return (
            Math.abs(r.net_refunds_adjustments || 0) >= 0.01 ||
            (audit.deductedOrders?.length || 0) > 0 ||
            (audit.crossPayoutRefunds?.length || 0) > 0
          )
        }
        if (statusParam === 'TAX_MISMATCH' || statusParam === 'MISSING_IN_PLATFORM') {
          return (audit.totalAtRiskTax || 0) > 0.01 || (audit.unpaidToastOrdersCount || 0) > 0
        }
        return true
      })
    }

    const createdCount = enrichedRecords.filter((r) => r.hasJournalEntry).length
    const pendingCount = enrichedRecords.length - createdCount

    return NextResponse.json({
      success: true,
      isAuthError,
      reauthUrl: '/api/integrations/quickbooks/auth',
      qbErrorMsg,
      nextSuggestedDocNumber,
      records: enrichedRecords,
      summary: {
        totalCount: enrichedRecords.length,
        createdCount,
        pendingCount,
        totalNetPayout: round2(
          enrichedRecords.reduce((acc, r) => acc + Number(r.net_payout_amount || 0), 0)
        ),
        pendingNetPayout: round2(
          enrichedRecords
            .filter((r) => !r.hasJournalEntry)
            .reduce((acc, r) => acc + Number(r.net_payout_amount || 0), 0)
        ),
      },
    })
  } catch (error: any) {
    console.error('[GET /api/delivery-reconciliation/quickbooks-journal] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al obtener pólizas de liquidación de QuickBooks',
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const payoutIds: string[] = Array.isArray(body.payoutIds)
      ? body.payoutIds.map((id: any) => String(id).trim()).filter(Boolean)
      : body.payoutId
      ? [String(body.payoutId).trim()]
      : []

    if (payoutIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Debe seleccionar al menos un corte para crear el Journal Entry.' },
        { status: 400 }
      )
    }

    const customTxnDate: string | undefined = body.txnDate
    const customDocNumber: string | undefined = body.docNumber
    const splitTaxOnRefunds: boolean = Boolean(body.splitTaxOnRefunds)

    const { token, realmId } = await getValidQuickBooksToken()
    const mappings = await getStorePlatformMappings()
    const storeNameMap = new Map<number, string>()
    for (const m of mappings) {
      storeNameMap.set(m.store_id, m.store_name)
    }

    const { data: payouts, error: payErr } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .select('*')
      .in('id', payoutIds)

    if (payErr || !payouts || payouts.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No se encontraron los cortes seleccionados en la base de datos.' },
        { status: 404 }
      )
    }

    // Obtener el último DocNumber secuencial 2026XXXX en QBO
    let runningDocNum = 20261060
    try {
      const q = encodeURIComponent(
        `select Id, DocNumber from JournalEntry where DocNumber LIKE '2026%' maxresults 300`
      )
      const r = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${q}&minorversion=75`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      )
      if (r.ok) {
        const j = await r.json()
        for (const je of j?.QueryResponse?.JournalEntry || []) {
          const doc = String(je.DocNumber || '').trim()
          if (/^2026\d{4}$/.test(doc)) {
            const n = parseInt(doc, 10)
            if (n >= runningDocNum) runningDocNum = n + 1
          }
        }
      }
    } catch {}

    const results: Array<{
      payoutId: string
      payoutRef: string
      storeName: string
      platform: string
      success: boolean
      journalEntry?: { id: string; docNumber: string; txnDate: string }
      error?: string
    }> = []

    for (let idx = 0; idx < payouts.length; idx++) {
      const p = payouts[idx]
      const storeName = storeNameMap.get(p.store_id) || `Store #${p.store_id}`
      const preview = buildPayoutJournalPreview({
        payout: p,
        storeName,
        storeOrders: [],
        splitTaxOnRefunds,
      })

      const txnDate = customTxnDate || preview.txnDate
      const docNumber =
        payouts.length === 1 && customDocNumber?.trim()
          ? customDocNumber.trim()
          : String(runningDocNum++)

      const qbLines = preview.lines
        .filter((l) => l.amount > 0)
        .map((l) => ({
          Amount: l.amount,
          DetailType: 'JournalEntryLineDetail' as const,
          Description: l.description,
          JournalEntryLineDetail: {
            PostingType: l.postingType,
            AccountRef: {
              value: l.accountQbId,
              name: l.accountName,
            },
            ClassRef: {
              value: l.classId,
              name: l.className,
            },
            DepartmentRef: {
              value: l.locationId,
              name: l.locationName,
            },
          },
        }))

      const qbPayload = {
        TxnDate: txnDate,
        DocNumber: docNumber,
        PrivateNote: `${p.platform} Settlement #${p.payout_reference_id} (${p.period_start || ''} to ${
          p.period_end || ''
        }) - ${storeName}`,
        Line: qbLines,
      }

      try {
        const qbRes = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/journalentry?minorversion=75`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(qbPayload),
          }
        )

        if (!qbRes.ok) {
          const errTxt = await qbRes.text()
          throw new Error(`QuickBooks API Error (${qbRes.status}): ${errTxt}`)
        }

        const qbData = await qbRes.json()
        const jeCreated = qbData.JournalEntry || qbData
        const jeId = String(jeCreated.Id || '')

        // Persistir el vínculo en delivery_platform_payouts.raw_payload
        const mergedRaw = {
          ...(p.raw_payload || {}),
          qb_journal_entry_id: jeId,
          qb_doc_number: String(jeCreated.DocNumber || docNumber),
          qb_txn_date: String(jeCreated.TxnDate || txnDate),
          qb_published_at: new Date().toISOString(),
        }

        await supabaseAdmin
          .from('delivery_platform_payouts')
          .update({
            raw_payload: mergedRaw,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id)

        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          success: true,
          journalEntry: {
            id: jeId,
            docNumber: String(jeCreated.DocNumber || docNumber),
            txnDate: String(jeCreated.TxnDate || txnDate),
          },
        })
      } catch (err: any) {
        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          success: false,
          error: err.message || 'Error al publicar Journal Entry en QuickBooks Online',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    return NextResponse.json({
      success: successCount > 0,
      results,
      summary: {
        total: results.length,
        successCount,
        failCount: results.length - successCount,
      },
    })
  } catch (error: any) {
    console.error('[POST /api/delivery-reconciliation/quickbooks-journal] Error:', error)
    const errMsg = String(error?.message || '')
    const isAuthError =
      errMsg.includes('token') ||
      errMsg.includes('auth') ||
      errMsg.includes('invalid_grant') ||
      errMsg.includes('401') ||
      errMsg.includes('re-authenticate')

    return NextResponse.json(
      {
        success: false,
        isAuthError,
        reauthUrl: '/api/integrations/quickbooks/auth',
        error: isAuthError
          ? 'La sesión de QuickBooks Online ha expirado. Por favor reconecta la cuenta.'
          : error.message || 'Error al crear Journal Entry en QuickBooks Online',
      },
      { status: isAuthError ? 401 : 500 }
    )
  }
}
