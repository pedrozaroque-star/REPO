/**
 * @module app/api/delivery-reconciliation/route
 * @description Endpoint REST para el Módulo Conciliar Delivery Plataformas (DoorDash, Uber Eats, Grubhub vs Toast POS).
 *
 * @businessRules
 * - Soporta consulta filtrada por sucursal, plataforma, estado de conciliación y rango de fechas operativas (6:00 AM - 5:59 AM PT).
 * - Calcula KPIs financieros respetando la regla de impuestos de Tacos Gavilan:
 *   * DoorDash y Grubhub entregan el Sales Tax al restaurante -> `Toast Expected Gross = Net Sales + Tax`.
 *   * Uber Eats retiene y declara el Sales Tax directamente -> `Toast Expected Gross = Net Sales`.
 * - Permite sincronización en vivo con Toast POS y Grubhub Accounting API, importación universal de reportes CSV/JSON
 *   de DoorDash / Uber Eats / Grubhub, y gestión de estado de disputas.
 *
 * @dataFlow
 * - GET `/api/delivery-reconciliation` -> Consulta `delivery_platform_orders`, `delivery_platform_payouts`, `delivery_platform_store_mappings` y genera `summary`.
 * - POST `/api/delivery-reconciliation` -> Ejecuta `sync_live`, `import_report`, `update_dispute`, `update_mapping`.
 *
 * @notes
 * - No incluye ninguna columna autogenerada (`GENERATED ALWAYS AS`) en mutaciones SQL.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  DeliveryPlatformCode,
  getStorePlatformMappings,
  parsePlatformReportPayload,
  reconcileAndPersistDeliveryData,
  round2,
} from '@/lib/delivery-reconciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('store_id')
    const platformParam = searchParams.get('platform')
    const statusParam = searchParams.get('status')
    const startDate = searchParams.get('start_date') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const endDate = searchParams.get('end_date') || new Date().toISOString().slice(0, 10)
    const search = (searchParams.get('search') || '').trim().toLowerCase()

    const mappings = await getStorePlatformMappings()
    const storeNameMap = new Map<number, { name: string; code: string }>()
    for (const m of mappings) {
      storeNameMap.set(m.store_id, { name: m.store_name, code: m.store_code })
    }

    let ordersQuery = supabaseAdmin
      .from('delivery_platform_orders')
      .select('*')
      .order('business_date', { ascending: false })
      .order('placed_at', { ascending: false })

    // Si el usuario NO está buscando un código de orden específico, filtrar por rango de fechas
    if (!search || search.length < 2) {
      ordersQuery = ordersQuery.gte('business_date', startDate).lte('business_date', endDate)
    }

    let disputedCrossPayoutQuery = supabaseAdmin
      .from('delivery_platform_orders')
      .select('*')
      .eq('is_disputed', true)

    let payoutsQuery = supabaseAdmin
      .from('delivery_platform_payouts')
      .select('*')
      .order('payout_date', { ascending: false })

    if (storeIdParam && storeIdParam !== 'ALL' && Number.isFinite(Number(storeIdParam))) {
      const sId = Number(storeIdParam)
      ordersQuery = ordersQuery.eq('store_id', sId)
      disputedCrossPayoutQuery = disputedCrossPayoutQuery.eq('store_id', sId)
      payoutsQuery = payoutsQuery.eq('store_id', sId)
    }

    if (platformParam && platformParam !== 'ALL') {
      ordersQuery = ordersQuery.eq('platform', platformParam)
      disputedCrossPayoutQuery = disputedCrossPayoutQuery.eq('platform', platformParam)
      payoutsQuery = payoutsQuery.eq('platform', platformParam)
    }

    if (statusParam && statusParam !== 'ALL') {
      ordersQuery = ordersQuery.eq('reconciliation_status', statusParam)
      disputedCrossPayoutQuery = disputedCrossPayoutQuery.eq('reconciliation_status', statusParam)
    }

    const [
      { data: rawOrdersRange, error: ordErr },
      { data: disputedOrdersAll },
      { data: rawPayouts, error: payErr },
      { data: allSyncOrders },
      { data: allSyncPayouts },
    ] = await Promise.all([
      ordersQuery.limit(2500),
      disputedCrossPayoutQuery.limit(200),
      payoutsQuery.limit(500),
      supabaseAdmin
        .from('delivery_platform_orders')
        .select('store_id, platform, business_date, match_confidence, toast_order_guid, updated_at')
        .limit(5000),
      supabaseAdmin
        .from('delivery_platform_payouts')
        .select('store_id, platform, payout_date, period_end, updated_at')
        .limit(1000),
    ])

    if (ordErr) throw new Error(`Error querying delivery_platform_orders: ${ordErr.message}`)
    if (payErr) throw new Error(`Error querying delivery_platform_payouts: ${payErr.message}`)

    // Unir órdenes del rango con órdenes en disputa que tengan reembolso en otro corte posterior (ej. #650DD)
    const rawOrdersMap = new Map<string, any>()
    for (const r of rawOrdersRange || []) {
      rawOrdersMap.set(String(r.id), r)
    }
    for (const d of disputedOrdersAll || []) {
      if (d?.raw_payload?.reimbursement_payout_ref && !rawOrdersMap.has(String(d.id))) {
        rawOrdersMap.set(String(d.id), d)
      }
    }
    const rawOrders = Array.from(rawOrdersMap.values())

    // Calcular Estado de Última Sincronización (Global, Por Tienda Seleccionada y Por las 15 Sucursales)
    const selectedStoreNum =
      storeIdParam && storeIdParam !== 'ALL' && Number.isFinite(Number(storeIdParam))
        ? Number(storeIdParam)
        : null

    type PlatformSyncMeta = {
      lastSyncedAt: string | null
      latestBusinessDate: string | null
      ordersCount: number
      payoutsCount: number
      globalLastSyncedAt: string | null
      globalLatestBusinessDate: string | null
      globalOrdersCount: number
      globalPayoutsCount: number
    }

    const initMeta = (): PlatformSyncMeta => ({
      lastSyncedAt: null,
      latestBusinessDate: null,
      ordersCount: 0,
      payoutsCount: 0,
      globalLastSyncedAt: null,
      globalLatestBusinessDate: null,
      globalOrdersCount: 0,
      globalPayoutsCount: 0,
    })

    const syncStatus: {
      TOAST: PlatformSyncMeta
      DOORDASH: PlatformSyncMeta
      GRUBHUB: PlatformSyncMeta
      UBER_EATS: PlatformSyncMeta
      byStore: Record<
        number,
        {
          toastLastSync: string | null
          toastOrders: number
          ddLastSync: string | null
          ddOrders: number
          ddPayouts: number
          ghLastSync: string | null
          ghOrders: number
          ghPayouts: number
          ueLastSync: string | null
          ueOrders: number
          uePayouts: number
        }
      >
    } = {
      TOAST: initMeta(),
      DOORDASH: initMeta(),
      GRUBHUB: initMeta(),
      UBER_EATS: initMeta(),
      byStore: {},
    }

    for (const m of mappings) {
      syncStatus.byStore[m.store_id] = {
        toastLastSync: null,
        toastOrders: 0,
        ddLastSync: null,
        ddOrders: 0,
        ddPayouts: 0,
        ghLastSync: null,
        ghOrders: 0,
        ghPayouts: 0,
        ueLastSync: null,
        ueOrders: 0,
        uePayouts: 0,
      }
    }

    const maxIso = (a: string | null, b: string | null | undefined): string | null => {
      if (!b) return a
      if (!a) return b
      return b > a ? b : a
    }

    for (const so of allSyncOrders || []) {
      const sId = Number(so.store_id)
      const plat = (so.platform as DeliveryPlatformCode) || 'DOORDASH'
      const upd = so.updated_at || null
      const bDate = so.business_date || null
      const isSelectedStore = selectedStoreNum === null || sId === selectedStoreNum
      const stEntry = syncStatus.byStore[sId]

      // Si tiene toast_order_guid, cuenta como orden sincronizada de Toast POS
      if (so.toast_order_guid) {
        syncStatus.TOAST.globalOrdersCount++
        syncStatus.TOAST.globalLastSyncedAt = maxIso(syncStatus.TOAST.globalLastSyncedAt, upd)
        syncStatus.TOAST.globalLatestBusinessDate = maxIso(syncStatus.TOAST.globalLatestBusinessDate, bDate)
        if (isSelectedStore) {
          syncStatus.TOAST.ordersCount++
          syncStatus.TOAST.lastSyncedAt = maxIso(syncStatus.TOAST.lastSyncedAt, upd)
          syncStatus.TOAST.latestBusinessDate = maxIso(syncStatus.TOAST.latestBusinessDate, bDate)
        }
        if (stEntry) {
          stEntry.toastOrders++
          stEntry.toastLastSync = maxIso(stEntry.toastLastSync, upd)
        }
      }

      // Si NO es TOAST_ONLY, proviene de la plataforma (DoorDash, Grubhub, Uber Eats)
      if (so.match_confidence !== 'TOAST_ONLY' && syncStatus[plat]) {
        syncStatus[plat].globalOrdersCount++
        syncStatus[plat].globalLastSyncedAt = maxIso(syncStatus[plat].globalLastSyncedAt, upd)
        syncStatus[plat].globalLatestBusinessDate = maxIso(syncStatus[plat].globalLatestBusinessDate, bDate)
        if (isSelectedStore) {
          syncStatus[plat].ordersCount++
          syncStatus[plat].lastSyncedAt = maxIso(syncStatus[plat].lastSyncedAt, upd)
          syncStatus[plat].latestBusinessDate = maxIso(syncStatus[plat].latestBusinessDate, bDate)
        }
        if (stEntry) {
          if (plat === 'DOORDASH') {
            stEntry.ddOrders++
            stEntry.ddLastSync = maxIso(stEntry.ddLastSync, upd)
          } else if (plat === 'GRUBHUB') {
            stEntry.ghOrders++
            stEntry.ghLastSync = maxIso(stEntry.ghLastSync, upd)
          } else if (plat === 'UBER_EATS') {
            stEntry.ueOrders++
            stEntry.ueLastSync = maxIso(stEntry.ueLastSync, upd)
          }
        }
      }
    }

    for (const sp of allSyncPayouts || []) {
      const sId = Number(sp.store_id)
      const plat = (sp.platform as DeliveryPlatformCode) || 'DOORDASH'
      const upd = sp.updated_at || null
      const pDate = sp.payout_date || sp.period_end || null
      const isSelectedStore = selectedStoreNum === null || sId === selectedStoreNum
      const stEntry = syncStatus.byStore[sId]

      if (syncStatus[plat]) {
        syncStatus[plat].globalPayoutsCount++
        syncStatus[plat].globalLastSyncedAt = maxIso(syncStatus[plat].globalLastSyncedAt, upd)
        syncStatus[plat].globalLatestBusinessDate = maxIso(syncStatus[plat].globalLatestBusinessDate, pDate)
        if (isSelectedStore) {
          syncStatus[plat].payoutsCount++
          syncStatus[plat].lastSyncedAt = maxIso(syncStatus[plat].lastSyncedAt, upd)
          syncStatus[plat].latestBusinessDate = maxIso(syncStatus[plat].latestBusinessDate, pDate)
        }
      }
      if (stEntry) {
        if (plat === 'DOORDASH') {
          stEntry.ddPayouts++
          stEntry.ddLastSync = maxIso(stEntry.ddLastSync, upd)
        } else if (plat === 'GRUBHUB') {
          stEntry.ghPayouts++
          stEntry.ghLastSync = maxIso(stEntry.ghLastSync, upd)
        } else if (plat === 'UBER_EATS') {
          stEntry.uePayouts++
          stEntry.ueLastSync = maxIso(stEntry.ueLastSync, upd)
        }
      }
    }

    let orders = (rawOrders || []).map((o: any) => ({
      ...o,
      store_name: storeNameMap.get(o.store_id)?.name || `Store #${o.store_id}`,
      store_code: storeNameMap.get(o.store_id)?.code || '',
    }))

    if (search) {
      orders = orders.filter(
        (o: any) =>
          String(o.platform_order_id || '').toLowerCase().includes(search) ||
          String(o.toast_display_number || '').toLowerCase().includes(search) ||
          String(o.toast_tab_name || '').toLowerCase().includes(search) ||
          String(o.payout_reference_id || '').toLowerCase().includes(search) ||
          String(o.raw_payload?.reimbursement_payout_ref || '').toLowerCase().includes(search) ||
          String(o.raw_payload?.reimbursement_description || '').toLowerCase().includes(search) ||
          String(o.store_name || '').toLowerCase().includes(search)
      )
    }

    // Ordenar para que primero se vean las órdenes ya reportadas/conciliadas con la plataforma y luego las pendientes de corte (TOAST_ONLY)
    orders.sort((a: any, b: any) => {
      const aToastOnly = a.match_confidence === 'TOAST_ONLY' ? 1 : 0
      const bToastOnly = b.match_confidence === 'TOAST_ONLY' ? 1 : 0
      if (aToastOnly !== bToastOnly) return aToastOnly - bToastOnly
      if (a.business_date !== b.business_date) return a.business_date > b.business_date ? -1 : 1
      return String(b.placed_at || b.toast_opened_at || '').localeCompare(
        String(a.placed_at || a.toast_opened_at || '')
      )
    })

    const payouts = (rawPayouts || [])
      .filter((p: any) => {
        // Mostrar cortes cuya fecha de pago o periodo se traslape con el rango consultado (±7 días)
        const pDate = p.payout_date || p.period_end || ''
        const pStart = p.period_start || pDate
        if (!pDate) return true
        return pDate >= startDate || pStart <= endDate
      })
      .map((p: any) => ({
        ...p,
        store_name: storeNameMap.get(p.store_id)?.name || `Store #${p.store_id}`,
        store_code: storeNameMap.get(p.store_id)?.code || '',
      }))

    // Calcular Resumen Ejecutivo (KPIs) separando Órdenes Liquidadas/Cruzadas vs Pendientes de Corte en Toast
    let toastNetTotal = 0
    let toastTaxTotal = 0
    let toastTaxForMerchantTotal = 0
    let toastExpectedGrossTotal = 0

    let platformSubtotalTotal = 0
    let platformTaxTotal = 0
    let platformTaxPaidToMerchantTotal = 0
    let platformTaxWithheldTotal = 0
    let platformGrossTotal = 0

    let commissionAndDeliveryTotal = 0
    let processingAndMarketingTotal = 0
    let errorAndAdjustmentTotal = 0
    let netPayoutOrdersTotal = 0

    let matchedOrdersCount = 0
    let discrepancyOrdersCount = 0
    let disputedOrdersCount = 0

    let settledOrdersCount = 0
    let settledToastExpectedTotal = 0
    let settledPlatformGrossTotal = 0
    let pendingToastOnlyCount = 0
    let pendingToastOnlyGross = 0

    const initPlatSummary = () => ({
      ordersCount: 0,
      settledOrdersCount: 0,
      matchedCount: 0,
      disputedCount: 0,
      pendingToastCount: 0,
      pendingToastGross: 0,
      toastNet: 0,
      toastTax: 0,
      toastExpectedGross: 0,
      settledToastExpected: 0,
      platformSubtotal: 0,
      platformTaxToMerchant: 0,
      platformTaxWithheld: 0,
      platformGross: 0,
      settledPlatformGross: 0,
      totalFees: 0,
      errorCharges: 0,
      netPayout: 0,
      variance: 0,
      settledVariance: 0,
      payoutsCount: 0,
      payoutsNetTotal: 0,
    })

    const byPlatform: Record<DeliveryPlatformCode, ReturnType<typeof initPlatSummary>> = {
      DOORDASH: initPlatSummary(),
      UBER_EATS: initPlatSummary(),
      GRUBHUB: initPlatSummary(),
    }

    for (const p of payouts) {
      const plat = (p.platform as DeliveryPlatformCode) || 'DOORDASH'
      if (byPlatform[plat]) {
        byPlatform[plat].payoutsCount++
        byPlatform[plat].payoutsNetTotal = round2(
          byPlatform[plat].payoutsNetTotal + Number(p.net_payout_amount || 0)
        )
      }
    }

    for (const o of orders) {
      const plat = (o.platform as DeliveryPlatformCode) || 'DOORDASH'
      const isToastOnly = o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
      const isMatchedBothSides = Boolean(o.toast_order_guid) && !isToastOnly

      const tNet = Number(o.toast_net_sales || 0)
      const tTax = Number(o.toast_tax || 0)
      const tExp = Number(o.toast_expected_gross || 0)

      const pSub = Number(o.platform_subtotal || 0)
      const pTax = Number(o.platform_tax || 0)
      const pTaxMerch = Number(o.platform_tax_paid_to_merchant || 0)
      const pTaxWithheld = Number(o.platform_tax_withheld || 0)
      const pGross = Number(o.platform_gross_receivable || 0)

      const commDel = Number(o.commission_fee || 0) + Number(o.delivery_fee || 0)
      const procMkt = Number(o.processing_fee || 0) + Number(o.marketing_fee || 0)
      const errAdj = Number(o.error_charge || 0) + Number(o.adjustment_amount || 0)
      const netPay = Number(o.net_payout || 0)

      toastNetTotal += tNet
      toastTaxTotal += tTax
      if (plat === 'DOORDASH' || plat === 'GRUBHUB') {
        toastTaxForMerchantTotal += tTax
      }
      toastExpectedGrossTotal += tExp

      platformSubtotalTotal += pSub
      platformTaxTotal += pTax
      platformTaxPaidToMerchantTotal += pTaxMerch
      platformTaxWithheldTotal += pTaxWithheld
      platformGrossTotal += pGross

      commissionAndDeliveryTotal += commDel
      processingAndMarketingTotal += procMkt
      errorAndAdjustmentTotal += errAdj
      netPayoutOrdersTotal += netPay

      if (isToastOnly) {
        pendingToastOnlyCount++
        pendingToastOnlyGross = round2(pendingToastOnlyGross + tExp)
      } else {
        settledOrdersCount++
        if (isMatchedBothSides) {
          settledToastExpectedTotal = round2(settledToastExpectedTotal + tExp)
          settledPlatformGrossTotal = round2(settledPlatformGrossTotal + pGross)
        }
      }

      if (o.reconciliation_status === 'MATCHED') {
        matchedOrdersCount++
      } else if (!isToastOnly) {
        discrepancyOrdersCount++
      }

      const isOrderDisputed =
        o.is_disputed ||
        o.reconciliation_status === 'REFUNDED_OR_DISPUTED' ||
        o.reconciliation_status === 'AMOUNT_MISMATCH' ||
        o.reconciliation_status === 'TAX_MISMATCH' ||
        Number(o.error_charge || 0) < -0.01

      if (isOrderDisputed) {
        disputedOrdersCount++
      }

      if (byPlatform[plat]) {
        byPlatform[plat].ordersCount++
        byPlatform[plat].toastNet = round2(byPlatform[plat].toastNet + tNet)
        byPlatform[plat].toastTax = round2(byPlatform[plat].toastTax + tTax)
        byPlatform[plat].toastExpectedGross = round2(byPlatform[plat].toastExpectedGross + tExp)
        byPlatform[plat].platformSubtotal = round2(byPlatform[plat].platformSubtotal + pSub)
        byPlatform[plat].platformTaxToMerchant = round2(byPlatform[plat].platformTaxToMerchant + pTaxMerch)
        byPlatform[plat].platformTaxWithheld = round2(byPlatform[plat].platformTaxWithheld + pTaxWithheld)
        byPlatform[plat].platformGross = round2(byPlatform[plat].platformGross + pGross)
        byPlatform[plat].totalFees = round2(byPlatform[plat].totalFees + commDel + procMkt)
        byPlatform[plat].errorCharges = round2(byPlatform[plat].errorCharges + errAdj)
        byPlatform[plat].netPayout = round2(byPlatform[plat].netPayout + netPay)
        byPlatform[plat].variance = round2(byPlatform[plat].platformGross - byPlatform[plat].toastExpectedGross)

        if (isToastOnly) {
          byPlatform[plat].pendingToastCount++
          byPlatform[plat].pendingToastGross = round2(byPlatform[plat].pendingToastGross + tExp)
        } else {
          byPlatform[plat].settledOrdersCount++
          if (isMatchedBothSides) {
            byPlatform[plat].settledToastExpected = round2(byPlatform[plat].settledToastExpected + tExp)
            byPlatform[plat].settledPlatformGross = round2(byPlatform[plat].settledPlatformGross + pGross)
            byPlatform[plat].settledVariance = round2(
              byPlatform[plat].settledPlatformGross - byPlatform[plat].settledToastExpected
            )
          }
        }
        if (o.reconciliation_status === 'MATCHED') {
          byPlatform[plat].matchedCount++
        }
        if (isOrderDisputed) {
          byPlatform[plat].disputedCount++
        }
      }
    }

    const totalFeesAll = round2(commissionAndDeliveryTotal + processingAndMarketingTotal)
    const effectiveFeePct =
      platformGrossTotal > 0 ? round2((Math.abs(totalFeesAll) / platformGrossTotal) * 100) : 0
    const settledVarianceTotal = round2(settledPlatformGrossTotal - settledToastExpectedTotal)

    const summary = {
      totalOrders: orders.length,
      settledOrdersCount,
      matchedOrdersCount,
      discrepancyOrdersCount,
      disputedOrdersCount,
      pendingToastOnlyCount,
      pendingToastOnlyGross: round2(pendingToastOnlyGross),
      settledToastExpectedTotal: round2(settledToastExpectedTotal),
      settledPlatformGrossTotal: round2(settledPlatformGrossTotal),
      settledVarianceTotal,
      payoutsCount: payouts.length,
      toastNetTotal: round2(toastNetTotal),
      toastTaxTotal: round2(toastTaxTotal),
      toastTaxForMerchantTotal: round2(toastTaxForMerchantTotal),
      toastExpectedGrossTotal: round2(toastExpectedGrossTotal),
      platformSubtotalTotal: round2(platformSubtotalTotal),
      platformTaxTotal: round2(platformTaxTotal),
      platformTaxPaidToMerchantTotal: round2(platformTaxPaidToMerchantTotal),
      platformTaxWithheldTotal: round2(platformTaxWithheldTotal),
      platformGrossTotal: round2(platformGrossTotal),
      commissionAndDeliveryTotal: round2(commissionAndDeliveryTotal),
      processingAndMarketingTotal: round2(processingAndMarketingTotal),
      totalFeesAll,
      effectiveFeePct,
      errorAndAdjustmentTotal: round2(errorAndAdjustmentTotal),
      netPayoutOrdersTotal: round2(netPayoutOrdersTotal),
      grossVarianceTotal: round2(platformGrossTotal - toastExpectedGrossTotal),
      byPlatform,
    }

    return NextResponse.json({
      success: true,
      mappings,
      orders,
      payouts,
      summary,
      syncStatus,
    })
  } catch (error: any) {
    console.error('[GET /api/delivery-reconciliation] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = body.action

    if (action === 'sync_live') {
      const storeId = body.store_id && body.store_id !== 'ALL' ? [Number(body.store_id)] : []
      const startDate = body.start_date || new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
      const endDate = body.end_date || new Date().toISOString().slice(0, 10)

      const result = await reconcileAndPersistDeliveryData({
        storeIds: storeId,
        startDate,
        endDate,
        syncToast: body.sync_toast !== false,
        syncGrubhubLive: body.sync_grubhub !== false,
      })

      return NextResponse.json({
        success: true,
        ...result,
      })
    }

    if (action === 'import_report') {
      const rawContent = String(body.raw_content || '')
      const forcedPlatform = body.platform || 'AUTO'
      const defaultStoreId = body.store_id && body.store_id !== 'ALL' ? Number(body.store_id) : 14

      if (!rawContent.trim()) {
        return NextResponse.json({ success: false, error: 'El contenido del archivo está vacío.' }, { status: 400 })
      }

      const parsed = await parsePlatformReportPayload(rawContent, forcedPlatform, defaultStoreId)
      if (parsed.orders.length === 0 && parsed.payouts.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No se encontraron transacciones válidas en el archivo.' },
          { status: 400 }
        )
      }

      // Determinar el rango de fechas y sucursales involucradas en el archivo importado
      const storeIdsSet = new Set<number>()
      let minDate = body.start_date || '2099-12-31'
      let maxDate = body.end_date || '2000-01-01'

      for (const o of parsed.orders) {
        storeIdsSet.add(o.storeId)
        if (o.businessDate < minDate) minDate = o.businessDate
        if (o.businessDate > maxDate) maxDate = o.businessDate
      }
      for (const p of parsed.payouts) {
        if (p.store_id) storeIdsSet.add(Number(p.store_id))
      }

      if (minDate > maxDate) {
        const today = new Date().toISOString().slice(0, 10)
        minDate = today
        maxDate = today
      }

      const result = await reconcileAndPersistDeliveryData({
        storeIds: Array.from(storeIdsSet),
        startDate: minDate,
        endDate: maxDate,
        syncToast: body.sync_toast !== false,
        syncGrubhubLive: false,
        importedPlatformOrders: parsed.orders,
        importedPayouts: parsed.payouts,
      })

      return NextResponse.json({
        success: true,
        detectedPlatform: parsed.detectedPlatform,
        importedOrdersCount: parsed.orders.length,
        importedPayoutsCount: parsed.payouts.length,
        ...result,
      })
    }

    if (action === 'update_dispute') {
      const {
        id,
        dispute_status,
        dispute_notes,
        dispute_reason,
        reimbursement_payout_ref,
        reimbursement_amount,
        reimbursement_deposit_date,
        reimbursement_description,
      } = body
      if (!id) {
        return NextResponse.json({ success: false, error: 'Missing order id' }, { status: 400 })
      }

      const { data: existingOrd } = await supabaseAdmin
        .from('delivery_platform_orders')
        .select('raw_payload, dispute_amount')
        .eq('id', id)
        .single()

      const updatedRaw = {
        ...(existingOrd?.raw_payload || {}),
        ...(reimbursement_payout_ref !== undefined ? { reimbursement_payout_ref } : {}),
        ...(reimbursement_amount !== undefined ? { reimbursement_amount: Number(reimbursement_amount || 0) } : {}),
        ...(reimbursement_deposit_date !== undefined ? { reimbursement_deposit_date } : {}),
        ...(reimbursement_description !== undefined ? { reimbursement_description } : {}),
      }

      const isDisputed = dispute_status && dispute_status !== 'NONE'
      const updatePayload: Record<string, any> = {
        is_disputed: Boolean(isDisputed),
        dispute_status: dispute_status || 'NONE',
        dispute_notes: dispute_notes ?? null,
        dispute_reason: dispute_reason ?? null,
        raw_payload: updatedRaw,
        updated_at: new Date().toISOString(),
      }
      if (reimbursement_amount !== undefined && Number(reimbursement_amount) > 0) {
        updatePayload.dispute_amount = round2(Number(reimbursement_amount))
      }

      const { data, error } = await supabaseAdmin
        .from('delivery_platform_orders')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, order: data })
    }

    if (action === 'update_mapping') {
      const { store_id, updates } = body
      if (!store_id || !updates) {
        return NextResponse.json({ success: false, error: 'Missing store_id or updates' }, { status: 400 })
      }

      const { data, error } = await supabaseAdmin
        .from('delivery_platform_store_mappings')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('store_id', Number(store_id))
        .select()
        .single()

      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, mapping: data })
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error: any) {
    console.error('[POST /api/delivery-reconciliation] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
