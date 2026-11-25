/**
 * @module lib/inventory/store-transfers
 * @description Gestión y agregación determinista de Traspasos / Préstamos de insumos entre
 *              sucursales (`public.inventory_store_transfers`) en Tacos Gavilan.
 *
 * @businessRules
 * - Cuando una sucursal A le presta bolsas/unidades de insumo a una sucursal B durante el día
 *   laboral `transfer_date` (`06:00 AM` a `05:59 AM` LA):
 *     * Para la sucursal que PRESTA (`from_store_id`), el disponible físico disminuye en `-quantity`.
 *     * Para la sucursal que RECIBE (`to_store_id`), el disponible físico aumenta en `+quantity`.
 * - Únicamente los traspasos con `status = 'confirmed'` impactan los cálculos oficiales de:
 *     1. Orden Diaria (`app/inventory/orders/actions.ts` — sobrante sugerido telescópico).
 *     2. Balance de Masas Histórico (`lib/inventory/historical-mass-balance.ts`).
 *     3. Toast Vendido vs. Sobrantes (`lib/inventory/toast-meat-sold-resolver.ts` y `/api/inventory/meat-analysis`).
 *     4. Alertas Ejecutivas de Porciones y Sobrantes (`lib/inventory/portion-control-alerts.ts`).
 * - Convención temporal exacta: un traspaso con `transfer_date = D` ocurre físicamente durante la
 *   jornada comercial `D` (después del conteo de cierre de `D - 1` y antes del conteo de cierre de `D`),
 *   por lo que en cualquier tramo telescópico entre conteos `(t0, t1]` se suman los traspasos con
 *   `t0 < transfer_date <= t1` (`[t0 + 1 .. t1]`).
 *
 * @dataFlow
 * - `public.inventory_store_transfers` -> `fetchConfirmedStoreTransfers()` ->
 *   `buildStoreItemDateNetTransferMap()` -> Motores de Orden Diaria, Sobrantes y Alertas.
 *
 * @notes
 * - Incluye paginación `.range()` anti-límite de 1,000 filas de PostgREST.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'

export type StoreTransferStatus = 'pending' | 'confirmed' | 'rejected'

export interface StoreTransferRecord {
  id: string
  transferDate: string
  fromStoreId: number
  toStoreId: number
  inventoryItemId: string
  quantity: number
  status: StoreTransferStatus
  notes: string | null
  createdByUserId: number | null
  createdByName: string | null
  confirmedByUserId: number | null
  confirmedByName: string | null
  confirmedAt: string | null
  createdAt: string
}

export interface NetStoreTransferBucket {
  netQty: number
  inQty: number
  outQty: number
  transferTags: string[]
}

const PAGE_SIZE = 1000

export async function fetchConfirmedStoreTransfers(params: {
  supabase?: any
  storeIds?: number[]
  itemIds?: string[]
  minDate: string
  maxDate: string
}): Promise<StoreTransferRecord[]> {
  const { storeIds, itemIds, minDate, maxDate } = params
  if (!minDate || !maxDate || minDate > maxDate) return []
  if (storeIds && storeIds.length === 0) return []
  if (itemIds && itemIds.length === 0) return []

  const db = params.supabase || (await getSupabaseAdminClient())
  const storeSet = storeIds ? new Set(storeIds.map(Number).filter(Number.isFinite)) : null
  const storeFilterCsv =
    storeSet && storeSet.size > 0 ? Array.from(storeSet).join(',') : null

  const rows: any[] = []
  let from = 0
  while (true) {
    const to = from + PAGE_SIZE - 1
    let query = db
      .from('inventory_store_transfers')
      .select(
        'id, transfer_date, from_store_id, to_store_id, inventory_item_id, quantity, status, notes, created_by_user_id, created_by_name, confirmed_by_user_id, confirmed_by_name, confirmed_at, created_at'
      )
      .eq('status', 'confirmed')
      .gte('transfer_date', minDate)
      .lte('transfer_date', maxDate)
      .order('transfer_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)

    if (itemIds && itemIds.length > 0) {
      query = query.in('inventory_item_id', itemIds)
    }
    if (storeFilterCsv) {
      query = query.or(`from_store_id.in.(${storeFilterCsv}),to_store_id.in.(${storeFilterCsv})`)
    }

    const { data, error } = await query
    if (error) {
      // Si en algún entorno de prueba aislado aún no existe la tabla, degradar limpio sin romper el flujo
      if (String(error.code || '') === '42P01') return []
      throw new Error(`Error consultando inventory_store_transfers: ${error.message}`)
    }
    const batch = data || []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  const mapped: StoreTransferRecord[] = []
  for (const r of rows) {
    const qty = Number(r.quantity)
    const fromId = Number(r.from_store_id)
    const toId = Number(r.to_store_id)
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(fromId) || !Number.isFinite(toId)) {
      continue
    }
    if (storeSet && !storeSet.has(fromId) && !storeSet.has(toId)) {
      continue
    }
    mapped.push({
      id: String(r.id),
      transferDate: String(r.transfer_date),
      fromStoreId: fromId,
      toStoreId: toId,
      inventoryItemId: String(r.inventory_item_id),
      quantity: qty,
      status: (r.status as StoreTransferStatus) || 'confirmed',
      notes: r.notes ? String(r.notes) : null,
      createdByUserId: r.created_by_user_id !== null && r.created_by_user_id !== undefined ? Number(r.created_by_user_id) : null,
      createdByName: r.created_by_name ? String(r.created_by_name) : null,
      confirmedByUserId: r.confirmed_by_user_id !== null && r.confirmed_by_user_id !== undefined ? Number(r.confirmed_by_user_id) : null,
      confirmedByName: r.confirmed_by_name ? String(r.confirmed_by_name) : null,
      confirmedAt: r.confirmed_at ? String(r.confirmed_at) : null,
      createdAt: String(r.created_at || ''),
    })
  }

  return mapped
}

/**
 * Construye un mapa indexado por `${storeId}::${inventoryItemId}::${transferDate}` con el flujo
 * neto (`+recibido - prestado`) y etiquetas legibles para trazabilidad en Libro Diario / Facturas.
 */
export function buildStoreItemDateNetTransferMap(
  transfers: StoreTransferRecord[],
  allowedStoreIds?: Set<number>
): Map<string, NetStoreTransferBucket> {
  const map = new Map<string, NetStoreTransferBucket>()

  const applyDelta = (storeId: number, itemId: string, dateStr: string, delta: number, tag: string) => {
    if (allowedStoreIds && !allowedStoreIds.has(storeId)) return
    const key = `${storeId}::${itemId}::${dateStr}`
    const cur = map.get(key) || { netQty: 0, inQty: 0, outQty: 0, transferTags: [] }
    cur.netQty = Math.round((cur.netQty + delta) * 10000) / 10000
    if (delta > 0) cur.inQty = Math.round((cur.inQty + delta) * 10000) / 10000
    if (delta < 0) cur.outQty = Math.round((cur.outQty + Math.abs(delta)) * 10000) / 10000
    if (!cur.transferTags.includes(tag)) cur.transferTags.push(tag)
    map.set(key, cur)
  }

  for (const t of transfers) {
    const qtyFmt = Number.isInteger(t.quantity) ? String(t.quantity) : t.quantity.toFixed(2)
    applyDelta(
      t.fromStoreId,
      t.inventoryItemId,
      t.transferDate,
      -t.quantity,
      `Traspaso -> #${t.toStoreId} (-${qtyFmt})`
    )
    applyDelta(
      t.toStoreId,
      t.inventoryItemId,
      t.transferDate,
      t.quantity,
      `Traspaso <- #${t.fromStoreId} (+${qtyFmt})`
    )
  }

  return map
}
