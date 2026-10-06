/**
 * @module lib/order-ready-sync
 * @description Sincronización activa (polling) del Order Ready Board contra la API de Toast.
 *
 * @businessRules
 * - **Doble tap del expediter (KDS bump)**: Toast NO dispara webhook cuando el KDS marca los platillos como listos.
 *   Se verificó con datos reales (LA Central #1361: READY en Toast 08:22:33, en BD seguía IN_PROGRESS). Por eso se consulta
 *   `/orders/v2/ordersBulk` (filtrado por fecha de modificación) y se leen los `selections[].fulfillmentStatus`.
 * - **Orden lista**: al menos un platillo no anulado con `fulfillmentStatus = READY`. Las bebidas/flan que no pasan por el KDS
 *   quedan `SENT` para siempre (14 de 107 órdenes de Lynwood son "mixtas"), por lo que exigir "todos READY" dejaría órdenes sin anunciar.
 *   El bump del expediter marca todos los platillos del KDS en el mismo milisegundo.
 * - **Hora real de cierre**: `ready_at` = mayor `modifiedDate` entre los platillos READY (momento real del doble tap), no el momento en
 *   que nos enteramos. Con esto el tablero anuncia en el orden en que se cerraron las órdenes.
 * - **Anuncios viejos en silencio**: si una orden se detecta READY con más de 2 min de antigüedad se guarda con `announced=true`
 *   (evita que al abrir el tablero se anuncien órdenes de hace rato).
 * - **Día laboral oficial (6:00 AM a 5:59:59 AM)**:
 *   - Toda orden se etiqueta con su `business_date` oficial según la regla de las 6 AM de Tacos Gavilan (medianoche a 5:59 AM cuenta como día anterior).
 *   - Al inicio del nuevo día laboral (6:00 AM), el inicio de ventana de sincronización nunca retrocede antes de las 6:00 AM de hoy,
 *     asegurando que el restaurante amanezca con el tablero 100% limpio y sin residuos del turno nocturno anterior.
 *
 * @dataFlow
 * - Board (poll cada 4 s) -> GET /api/order-ready/orders -> syncStoreFromToast() (throttle 5 s por tienda)
 *   -> Toast ordersBulk -> upsert en order_ready_announcements -> Board.
 * - Webhook `order_updated` reutiliza `evaluateToastOrder()` para clasificar con la misma lógica.
 *
 * @notes
 * - Mapa de tiendas Toast GUID <-> código vive aquí (única fuente) y lo importa el webhook.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'
import { getCaliforniaBusinessDate, getBusinessDayStartMs } from '@/lib/business-date'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

import { TOAST_STORE_MAP, STORE_GUID_BY_CODE } from '@/lib/toast-stores'
export { TOAST_STORE_MAP, STORE_GUID_BY_CODE }

export type OrderReadyStatus = 'IN_PROGRESS' | 'READY' | 'COMPLETED'

export interface ToastOrderEvaluation {
  status: OrderReadyStatus
  /** Momento real del doble tap (ISO) cuando status = READY */
  readyAt: string | null
  /** Momento en que la orden se envió a cocina / expediter (ISO) */
  sentAt: string | null
  activeItems: number
  sentItems: number
  readyItems: number
}

/** Clasifica una orden de Toast leyendo el fulfillmentStatus de cada platillo (selection). */
export function evaluateToastOrder(order: any): ToastOrderEvaluation {
  if (!order || order.voided || order.deleted) {
    return { status: 'COMPLETED', readyAt: null, sentAt: null, activeItems: 0, sentItems: 0, readyItems: 0 }
  }

  let activeItems = 0
  let sentItems = 0
  let readyItems = 0
  let latestReadyMs = 0
  let earliestSentMs = Infinity

  for (const check of order.checks || []) {
    if (check?.voided || check?.deleted) continue
    for (const sel of check.selections || []) {
      if (!sel || sel.voided || sel.deleted) continue
      const name = String(sel.displayName || '')
      // Separadores de tacos del POS ("------- Taco Separator-------") no son platillos reales
      if (name.includes('---')) continue
      activeItems++

      const itemDateStr = sel.sentDate || sel.createdDate || sel.modifiedDate
      const itemDateMs = Date.parse(itemDateStr || '')
      if (Number.isFinite(itemDateMs) && itemDateMs < earliestSentMs) {
        earliestSentMs = itemDateMs
      }

      const st = String(sel.fulfillmentStatus || '').toUpperCase()
      if (st === 'READY' || st === 'FULFILLED') {
        readyItems++
        const ms = Date.parse(sel.modifiedDate || '')
        if (Number.isFinite(ms) && ms > latestReadyMs) latestReadyMs = ms
      } else if (st === 'SENT') {
        sentItems++
      }
    }
  }

  const orderOpenedMs = Date.parse(order.openedDate || order.createdDate || '')
  if (Number.isFinite(orderOpenedMs) && orderOpenedMs < earliestSentMs) {
    earliestSentMs = orderOpenedMs
  }
  const sentAt = Number.isFinite(earliestSentMs) ? new Date(earliestSentMs).toISOString() : null

  // 1. Si no hay platillos activos, la orden no es válida para el tablero
  if (activeItems === 0) {
    return { status: 'COMPLETED', readyAt: null, sentAt, activeItems: 0, sentItems: 0, readyItems: 0 }
  }

  // 2. Si ya tiene platillos marcados con doble tap en expediter -> READY
  if (readyItems > 0) {
    return {
      status: 'READY',
      readyAt: new Date(latestReadyMs || Date.now()).toISOString(),
      sentAt,
      activeItems,
      sentItems,
      readyItems
    }
  }

  // 3. Si está enviada al expediter pero aún no lista -> IN_PROGRESS
  // REGLA CRÍTICA: Debe tener platillos en estado 'SENT' en la cocina.
  // Si la orden está abierta en la caja sin enviar al expediter (draft / no enviada),
  // ningún platillo tendrá fulfillmentStatus = 'SENT' ni 'READY'.
  if (sentItems > 0) {
    return {
      status: 'IN_PROGRESS',
      readyAt: null,
      sentAt,
      activeItems,
      sentItems,
      readyItems
    }
  }

  // 4. Si no tiene platillos SENT ni READY, la orden está abierta en la caja sin enviar al expediter
  // -> No debe aparecer en "EN PREPARACIÓN"
  return { status: 'COMPLETED', readyAt: null, sentAt, activeItems, sentItems, readyItems }
}

/** Traduce el nombre de la dining option de Toast al canal del tablero. */
export function classifyDiningName(raw: string): 'TOGO' | 'FOR_HERE' | 'DELIVERY' | 'DRIVE_THRU' {
  const up = (raw || '').toUpperCase()
  if (up.includes('HERE') || up.includes('DINE')) return 'FOR_HERE'
  if (up.includes('UBER') || up.includes('DOORDASH') || up.includes('GRUBHUB') || up.includes('DELIVERY')) return 'DELIVERY'
  if (up.includes('DRIVE')) return 'DRIVE_THRU'
  return 'TOGO'
}

// ── Mapa GUID -> nombre de dining option por tienda (cache 30 min). NUNCA hardcodear GUIDs de dining options. ──
const diningCache = new Map<string, { at: number; map: Record<string, string> }>()

async function getDiningMap(token: string, restaurantGuid: string): Promise<Record<string, string>> {
  const cached = diningCache.get(restaurantGuid)
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.map
  const map: Record<string, string> = {}
  try {
    const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions?pageSize=100`, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': restaurantGuid }
    })
    if (res.ok) {
      const list: any[] = await res.json()
      for (const d of list) if (d?.guid) map[d.guid] = d.name || ''
    }
  } catch {
    /* se reintenta en el siguiente ciclo */
  }
  if (Object.keys(map).length > 0) diningCache.set(restaurantGuid, { at: Date.now(), map })
  return map
}

// ── Throttle por tienda: varias tablets abiertas no multiplican las llamadas a Toast ──
const lastRun = new Map<string, number>()
const inflight = new Map<string, Promise<void>>()
const THROTTLE_MS = 5000
const WINDOW_MINUTES = 25
const SILENT_AFTER_MS = 2 * 60 * 1000

function toastDate(d: Date): string {
  return d.toISOString().replace('Z', '+0000')
}

/**
 * Sincroniza las órdenes recientes (modificadas en los últimos 25 min) de una tienda desde Toast.
 * - Orden nueva  -> INSERT (IN_PROGRESS, o READY si el bump fue reciente)
 * - IN_PROGRESS que Toast ya marcó READY -> UPDATE a READY con ready_at real
 */
export async function syncStoreFromToast(storeCode: string, force = false): Promise<void> {
  const restaurantGuid = STORE_GUID_BY_CODE[storeCode]
  if (!restaurantGuid) return

  const running = inflight.get(storeCode)
  if (running) return running
  if (!force && Date.now() - (lastRun.get(storeCode) || 0) < THROTTLE_MS) return

  const job = (async () => {
    try {
      const token = await getAuthToken()
      if (!token) return
      lastRun.set(storeCode, Date.now())

      const end = new Date()
      const bDayStartMs = getBusinessDayStartMs(end)
      // La ventana no debe traspasar hacia atrás la frontera de las 6:00 AM de hoy
      const windowStartMs = Math.max(end.getTime() - WINDOW_MINUTES * 60 * 1000, bDayStartMs)
      const start = new Date(windowStartMs)

      const orders: any[] = []
      for (let page = 1; page <= 4; page++) {
        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.set('startDate', toastDate(start))
        url.searchParams.set('endDate', toastDate(end))
        url.searchParams.set('pageSize', '100')
        url.searchParams.set('page', String(page))
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': restaurantGuid }
        })
        if (!res.ok) break
        const batch = await res.json()
        if (!Array.isArray(batch)) break
        orders.push(...batch)
        if (batch.length < 100) break
      }
      if (orders.length === 0) return

      const guids = orders.map(o => o.guid).filter(Boolean)
      const { data: existingRows } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('id, status, order_guid, order_number')
        .eq('store_code', storeCode)
        .in('order_guid', guids)

      const byGuid = new Map<string, any>((existingRows || []).map((r: any) => [r.order_guid, r]))
      const diningMap = await getDiningMap(token, restaurantGuid)
      const storeInfo = TOAST_STORE_MAP[restaurantGuid]
      const nowMs = Date.now()

      for (const ord of orders) {
        const ev = evaluateToastOrder(ord)
        const number = ord.displayNumber || ord.checks?.[0]?.displayNumber
        if (!number || !ord.guid) continue

        const row = byGuid.get(ord.guid)
        const readyMs = ev.readyAt ? Date.parse(ev.readyAt) : null
        const isStale = readyMs !== null && nowMs - readyMs > SILENT_AFTER_MS

        if (row) {
          if (ev.status === 'READY' && row.status === 'IN_PROGRESS') {
            await supabaseAdmin
              .from('order_ready_announcements')
              .update({ status: 'READY', ready_at: ev.readyAt, announced: isStale })
              .eq('id', row.id)
          } else if (ev.status === 'COMPLETED' && row.status === 'IN_PROGRESS') {
            await supabaseAdmin
              .from('order_ready_announcements')
              .update({ status: 'COMPLETED' })
              .eq('id', row.id)
          }
          continue
        }

        if (ev.status === 'COMPLETED') continue

        // Orden desconocida (el webhook no llegó): solo la insertamos si sigue activa o se cerró hace poco
        if (ev.status === 'READY' && readyMs !== null && nowMs - readyMs > 10 * 60 * 1000) continue

        const diningName = diningMap[ord.diningOption?.guid] || ord.diningOption?.name || ''
        const orderDate = ev.sentAt || ord.createdDate || ord.openedDate || ord.paidDate || new Date().toISOString()
        const bDate = getCaliforniaBusinessDate(orderDate)

        await supabaseAdmin.from('order_ready_announcements').insert({
          store_code: storeCode,
          store_id: restaurantGuid,
          store_name: storeInfo.name,
          order_number: String(number),
          order_guid: ord.guid,
          dining_option: classifyDiningName(diningName),
          customer_name: ord.customer?.firstName || null,
          status: ev.status,
          business_date: bDate,
          announced: ev.status === 'READY' ? isStale : false,
          ready_at: ev.status === 'READY' ? ev.readyAt : null,
          created_at: orderDate
        })
      }
    } catch (err) {
      console.warn('[order-ready-sync] error:', err)
    } finally {
      inflight.delete(storeCode)
    }
  })()

  inflight.set(storeCode, job)
  return job
}
