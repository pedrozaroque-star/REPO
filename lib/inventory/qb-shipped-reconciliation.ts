/**
 * @module lib/inventory/qb-shipped-reconciliation
 * @description Conciliación determinista de retorno QuickBooks Online (`Invoice` -> `inventory_order_lines`)
 *              para cerrar la brecha entre lo solicitado por la sucursal (`Estimate`) y lo realmente
 *              despachado/facturado por La Bodega Central en Vernon (`Invoice`).
 *
 * @businessRules
 * - Cuando la tienda envía su Orden Diaria, el sistema genera un `Estimate` en QBO con `PrivateNote`
 *   que contiene `TEG_ORDER_ID:<inventory_orders.id>`.
 * - Al despachar en la madrugada, La Bodega convierte ese `Estimate` en un `Invoice` en QBO, el cual
 *   conserva `LinkedTxn: [{ TxnType: 'Estimate', TxnId: '<qb_estimate_id>' }]` y `TEG_ORDER_ID:<id>`.
 * - Si La Bodega recorta un artículo agotado, ajusta cantidades o agrega un insumo en el `Invoice`,
 *   este módulo actualiza `inventory_order_lines.final_qty` (preservando `calculated_qty`, `adjusted_qty`,
 *   `par_value` y `leftover_value` como historial de lo solicitado originalmente) y marca la orden como
 *   `status = 'received'` con `qb_invoice_id`, `qb_invoice_number` y `qb_invoiced_at`.
 * - Las unidades de `SalesItemLineDetail.Qty` en `Invoice` son 1:1 con las unidades de pedido de tienda
 *   (verificado en producción, incluyendo `Papelito Para Torta` en piezas individuales).
 * - Falla de forma segura y no bloqueante (`fail-safe`): si el token de QBO expiró o La Bodega aún no
 *   convierte el `Estimate` a `Invoice`, conserva intacto `status = 'sent'` y las cantidades pedidas.
 *
 * @dataFlow
 *   Supabase (`inventory_orders`, `inventory_order_lines`, `stores`, `quickbooks_mappings`)
 *   + QuickBooks Online REST v3 (`Invoice`) -> `reconcileStoreOrdersWithQbInvoices()`
 *   -> actualiza `inventory_order_lines.final_qty` + `inventory_orders` (`status = 'received'`).
 *
 * @notes
 * - [2026-11-10] Creado en Upgrade 2 del sistema de Orden Diaria para evitar que recortes o ajustes
 *   de La Bodega en QBO distorsionen `arrivedToday` y el Balance de Masas Histórico.
 * - [2026-11-11] Cooldown de 3 min en lecturas repetidas sin facturas nuevas (con bypass en `forceResync: true`)
 *   para acelerar aperturas e interacciones en las 15 sucursales.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { getQuickBooksClient } from '@/lib/quickbooks'
import { EXTERNAL_TRACK_ONLY_DESSERT_IDS } from './automation-pilot'

export interface QbOrderLineDiff {
  orderId: string
  orderDate: string
  storeId: number
  invoiceNumber: string
  inventoryItemId: string
  previousFinalQty: number
  invoicedQty: number
  changeType: 'updated' | 'cut_to_zero' | 'added_by_warehouse'
}

export interface QbShippedReconciliationResult {
  skipped: boolean
  reason?: string
  candidateOrders: number
  reconciledOrders: number
  updatedLines: number
  zeroedLines: number
  addedLines: number
  diffs: QbOrderLineDiff[]
}

function shiftIsoDate(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().split('T')[0]
}

function isVoidedQbInvoice(inv: any): boolean {
  const note = String(inv?.PrivateNote || '')
  if (/\bvoided\b/i.test(note) && Number(inv?.TotalAmt || 0) === 0) {
    const hasPositiveQty = Array.isArray(inv?.Line) && inv.Line.some((line: any) =>
      line?.DetailType === 'SalesItemLineDetail' && Number(line?.SalesItemLineDetail?.Qty || 0) > 0
    )
    if (!hasPositiveQty) return true
  }
  return false
}

async function queryQbInvoices(params: {
  accessToken: string
  realmId: string
  useSandbox: boolean
  customerIds: string[]
  minTxnDate: string
}): Promise<any[]> {
  const { accessToken, realmId, useSandbox, customerIds, minTxnDate } = params
  const baseHost = useSandbox
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'

  const runQuery = async (sql: string): Promise<any[] | null> => {
    const url = `${baseHost}/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(sql)}&minorversion=70`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json()
    return Array.isArray(json?.QueryResponse?.Invoice) ? json.QueryResponse.Invoice : []
  }

  const sanitizedCustomerIds = customerIds
    .map(id => String(id || '').trim())
    .filter(id => /^\d+$/.test(id))

  if (sanitizedCustomerIds.length > 0) {
    const customerClause = sanitizedCustomerIds.length === 1
      ? `CustomerRef = '${sanitizedCustomerIds[0]}'`
      : `CustomerRef IN (${sanitizedCustomerIds.map(id => `'${id}'`).join(', ')})`
    const targetedSql = `SELECT * FROM Invoice WHERE ${customerClause} AND TxnDate >= '${minTxnDate}' ORDERBY TxnDate DESC MAXRESULTS 1000`
    const targeted = await runQuery(targetedSql)
    if (targeted !== null) return targeted
  }

  const fallbackSql = `SELECT * FROM Invoice WHERE TxnDate >= '${minTxnDate}' ORDERBY TxnDate DESC MAXRESULTS 1000`
  const fallback = await runQuery(fallbackSql)
  return fallback || []
}

const qbReconcileCooldownCache = new Map<string, number>()
const QB_RECONCILE_COOLDOWN_MS = 3 * 60 * 1000 // 3 min de enfriamiento en llamadas repetitivas de UI

/**
 * Concilia órdenes enviadas (`status = 'sent'` o con `forceResync`) contra `Invoices` reales de QBO.
 * Idempotente: si no hay órdenes pendientes de conciliar, retorna en milisegundos sin llamar a QBO.
 */
export async function reconcileStoreOrdersWithQbInvoices(options?: {
  storeId?: number | string
  orderDate?: string
  lookbackDays?: number
  forceResync?: boolean
}): Promise<QbShippedReconciliationResult> {
  const cooldownKey = `${options?.storeId ?? 'all'}:${options?.orderDate ?? 'lookback'}:${options?.lookbackDays ?? 14}`
  if (!options?.forceResync) {
    const expiresAt = qbReconcileCooldownCache.get(cooldownKey)
    if (expiresAt && expiresAt > Date.now()) {
      return {
        skipped: false,
        reason: 'cooldown_cached',
        candidateOrders: 0,
        reconciledOrders: 0,
        updatedLines: 0,
        zeroedLines: 0,
        addedLines: 0,
        diffs: [],
      }
    }
  }

  const lookbackDays = Math.max(1, Math.min(60, options?.lookbackDays ?? 14))
  const todayIso = new Date().toISOString().split('T')[0]
  const minOrderDate = options?.orderDate || shiftIsoDate(todayIso, -lookbackDays)

  try {
    const db = await getSupabaseAdminClient()

    let ordersQuery = db
      .from('inventory_orders')
      .select('id, store_id, order_date, status, qb_estimate_id, qb_estimate_number, qb_invoice_id, qb_invoice_number, order_type')
      .eq('order_type', 'daily')
      .not('qb_estimate_id', 'is', null)

    if (options?.storeId !== undefined && options?.storeId !== null && String(options.storeId) !== '') {
      ordersQuery = ordersQuery.eq('store_id', Number(options.storeId))
    }

    if (options?.orderDate) {
      ordersQuery = ordersQuery.eq('order_date', options.orderDate)
    } else {
      ordersQuery = ordersQuery.gte('order_date', minOrderDate)
    }

    if (options?.forceResync) {
      ordersQuery = ordersQuery.in('status', ['sent', 'received'])
    } else {
      ordersQuery = ordersQuery.eq('status', 'sent').is('qb_invoice_id', null)
    }

    const { data: candidateOrders, error: ordersErr } = await ordersQuery
    if (ordersErr) {
      return {
        skipped: true,
        reason: `db_orders_error: ${ordersErr.message}`,
        candidateOrders: 0,
        reconciledOrders: 0,
        updatedLines: 0,
        zeroedLines: 0,
        addedLines: 0,
        diffs: [],
      }
    }

    if (!candidateOrders || candidateOrders.length === 0) {
      return {
        skipped: false,
        candidateOrders: 0,
        reconciledOrders: 0,
        updatedLines: 0,
        zeroedLines: 0,
        addedLines: 0,
        diffs: [],
      }
    }

    // Obtener QBO client con renovación automática de token
    let qbo: any
    try {
      qbo = await getQuickBooksClient()
    } catch (qbAuthErr: any) {
      return {
        skipped: true,
        reason: qbAuthErr?.message || 'qb_auth_unavailable',
        candidateOrders: candidateOrders.length,
        reconciledOrders: 0,
        updatedLines: 0,
        zeroedLines: 0,
        addedLines: 0,
        diffs: [],
      }
    }

    const storeIds = Array.from(new Set(candidateOrders.map((o: any) => Number(o.store_id))))
    const [{ data: storesData }, { data: mappingsData }] = await Promise.all([
      db.from('stores').select('id, qb_customer_id').in('id', storeIds),
      db.from('quickbooks_mappings').select('qb_item_id, inventory_item_id'),
    ])

    const customerIds = Array.from(
      new Set(
        (storesData || [])
          .map((s: any) => String(s.qb_customer_id || '').trim())
          .filter(Boolean)
      )
    )

    const qbToInventoryItem = new Map<string, string>()
    for (const m of mappingsData || []) {
      if (m.qb_item_id && m.inventory_item_id) {
        qbToInventoryItem.set(String(m.qb_item_id).trim(), String(m.inventory_item_id).trim())
      }
    }

    const earliestOrderDate = candidateOrders
      .map((o: any) => String(o.order_date))
      .sort()[0] || minOrderDate

    const invoices = await queryQbInvoices({
      accessToken: String(qbo.token || ''),
      realmId: String(qbo.realmId || ''),
      useSandbox: Boolean(qbo.useSandbox),
      customerIds,
      minTxnDate: earliestOrderDate,
    })

    if (invoices.length === 0) {
      qbReconcileCooldownCache.set(cooldownKey, Date.now() + QB_RECONCILE_COOLDOWN_MS)
      return {
        skipped: false,
        candidateOrders: candidateOrders.length,
        reconciledOrders: 0,
        updatedLines: 0,
        zeroedLines: 0,
        addedLines: 0,
        diffs: [],
      }
    }

    // Indexar Invoices válidos por LinkedTxn Estimate Id y por TEG_ORDER_ID
    const invoicesByEstimateId = new Map<string, any[]>()
    const invoicesByTegOrderId = new Map<string, any[]>()

    for (const inv of invoices) {
      if (isVoidedQbInvoice(inv)) continue

      const linkedList = Array.isArray(inv.LinkedTxn) ? inv.LinkedTxn : []
      for (const link of linkedList) {
        if (link?.TxnType === 'Estimate' && link?.TxnId) {
          const estId = String(link.TxnId).trim()
          if (!invoicesByEstimateId.has(estId)) invoicesByEstimateId.set(estId, [])
          invoicesByEstimateId.get(estId)!.push(inv)
        }
      }

      const privateNote = String(inv.PrivateNote || '')
      const tegMatch = privateNote.match(/TEG_ORDER_ID:([0-9a-fA-F-]{36})/)
      if (tegMatch?.[1]) {
        const ordId = tegMatch[1].toLowerCase()
        if (!invoicesByTegOrderId.has(ordId)) invoicesByTegOrderId.set(ordId, [])
        invoicesByTegOrderId.get(ordId)!.push(inv)
      }
    }

    let reconciledOrders = 0
    let updatedLines = 0
    let zeroedLines = 0
    let addedLines = 0
    const diffs: QbOrderLineDiff[] = []
    const nowIso = new Date().toISOString()

    for (const order of candidateOrders) {
      const estId = String(order.qb_estimate_id || '').trim()
      const ordIdLower = String(order.id).toLowerCase()

      const matchedMap = new Map<string, any>()
      for (const inv of invoicesByEstimateId.get(estId) || []) {
        matchedMap.set(String(inv.Id), inv)
      }
      if (matchedMap.size === 0) {
        for (const inv of invoicesByTegOrderId.get(ordIdLower) || []) {
          matchedMap.set(String(inv.Id), inv)
        }
      }

      if (matchedMap.size === 0) continue

      const matchedInvoices = Array.from(matchedMap.values())
      const primaryInvoice = matchedInvoices[0]
      const invoiceIdsStr = matchedInvoices.map(i => String(i.Id)).join(',')
      const invoiceNumbersStr = matchedInvoices
        .map(i => String(i.DocNumber || i.Id))
        .join(',')

      // Sumar cantidades reales facturadas por inventory_item_id
      const invoicedQtyByItemId = new Map<string, number>()
      let hasMappedSalesLines = false

      for (const inv of matchedInvoices) {
        const lines = Array.isArray(inv.Line) ? inv.Line : []
        for (const line of lines) {
          if (line?.DetailType !== 'SalesItemLineDetail') continue
          const qbItemId = String(line?.SalesItemLineDetail?.ItemRef?.value || '').trim()
          if (!qbItemId) continue
          const internalItemId = qbToInventoryItem.get(qbItemId)
          if (!internalItemId) continue
          if (EXTERNAL_TRACK_ONLY_DESSERT_IDS.has(internalItemId)) continue

          const rawQty = Number(line?.SalesItemLineDetail?.Qty ?? 0)
          const safeQty = Number.isFinite(rawQty) && rawQty >= 0 ? rawQty : 0
          invoicedQtyByItemId.set(internalItemId, (invoicedQtyByItemId.get(internalItemId) || 0) + safeQty)
          hasMappedSalesLines = true
        }
      }

      if (!hasMappedSalesLines) continue

      const { data: existingLines, error: linesFetchErr } = await db
        .from('inventory_order_lines')
        .select('id, inventory_item_id, calculated_qty, adjusted_qty, final_qty')
        .eq('order_id', order.id)

      if (linesFetchErr) continue

      const seenItemIds = new Set<string>()

      for (const dbLine of existingLines || []) {
        const itemId = String(dbLine.inventory_item_id)
        if (EXTERNAL_TRACK_ONLY_DESSERT_IDS.has(itemId)) continue
        seenItemIds.add(itemId)

        const prevFinal = Number(dbLine.final_qty ?? dbLine.adjusted_qty ?? dbLine.calculated_qty ?? 0)
        const invoicedQty = invoicedQtyByItemId.get(itemId) ?? 0

        if (Math.abs(prevFinal - invoicedQty) > 0.0001) {
          const { error: updErr } = await db
            .from('inventory_order_lines')
            .update({ final_qty: invoicedQty })
            .eq('id', dbLine.id)

          if (!updErr) {
            if (invoicedQty === 0 && prevFinal > 0) {
              zeroedLines++
              diffs.push({
                orderId: order.id,
                orderDate: String(order.order_date),
                storeId: Number(order.store_id),
                invoiceNumber: invoiceNumbersStr,
                inventoryItemId: itemId,
                previousFinalQty: prevFinal,
                invoicedQty: 0,
                changeType: 'cut_to_zero',
              })
            } else {
              updatedLines++
              diffs.push({
                orderId: order.id,
                orderDate: String(order.order_date),
                storeId: Number(order.store_id),
                invoiceNumber: invoiceNumbersStr,
                inventoryItemId: itemId,
                previousFinalQty: prevFinal,
                invoicedQty,
                changeType: 'updated',
              })
            }
          }
        }
      }

      // Insertar artículos que La Bodega haya agregado directamente en el Invoice de QBO
      const newWarehouseLines: Array<{
        order_id: string
        inventory_item_id: string
        calculated_qty: number
        adjusted_qty: number
        final_qty: number
        par_value: number
        leftover_value: number
      }> = []

      for (const [itemId, invoicedQty] of invoicedQtyByItemId.entries()) {
        if (seenItemIds.has(itemId) || invoicedQty <= 0) continue
        if (EXTERNAL_TRACK_ONLY_DESSERT_IDS.has(itemId)) continue
        newWarehouseLines.push({
          order_id: order.id,
          inventory_item_id: itemId,
          calculated_qty: 0,
          adjusted_qty: invoicedQty,
          final_qty: invoicedQty,
          par_value: 0,
          leftover_value: 0,
        })
      }

      if (newWarehouseLines.length > 0) {
        const { error: insErr } = await db
          .from('inventory_order_lines')
          .insert(newWarehouseLines)
        if (!insErr) {
          addedLines += newWarehouseLines.length
          for (const nl of newWarehouseLines) {
            diffs.push({
              orderId: order.id,
              orderDate: String(order.order_date),
              storeId: Number(order.store_id),
              invoiceNumber: invoiceNumbersStr,
              inventoryItemId: nl.inventory_item_id,
              previousFinalQty: 0,
              invoicedQty: nl.final_qty,
              changeType: 'added_by_warehouse',
            })
          }
        }
      }

      const invoiceTxnDate = primaryInvoice?.MetaData?.CreateTime || nowIso
      const { error: orderUpdErr } = await db
        .from('inventory_orders')
        .update({
          status: 'received',
          qb_invoice_id: invoiceIdsStr,
          qb_invoice_number: invoiceNumbersStr,
          qb_invoiced_at: invoiceTxnDate,
          updated_at: nowIso,
        })
        .eq('id', order.id)

      if (!orderUpdErr) {
        reconciledOrders++
      }
    }

    if (reconciledOrders === 0 && candidateOrders.length > 0) {
      qbReconcileCooldownCache.set(cooldownKey, Date.now() + QB_RECONCILE_COOLDOWN_MS)
    }

    return {
      skipped: false,
      candidateOrders: candidateOrders.length,
      reconciledOrders,
      updatedLines,
      zeroedLines,
      addedLines,
      diffs,
    }
  } catch (err: any) {
    return {
      skipped: true,
      reason: err instanceof Error ? err.message : String(err),
      candidateOrders: 0,
      reconciledOrders: 0,
      updatedLines: 0,
      zeroedLines: 0,
      addedLines: 0,
      diffs: [],
    }
  }
}
