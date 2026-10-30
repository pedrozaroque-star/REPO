/**
 * @module lib/order-ready-sync
 * @description Sincronización activa (polling) del Order Ready Board contra la API de Toast.
 *
 * @businessRules
 * - **Doble tap del expediter (KDS bump)**: Toast NO dispara webhook cuando el KDS marca los platillos como listos.
 *   Se verificó con datos reales (LA Central #1361: READY en Toast 08:22:33, en BD seguía IN_PROGRESS). Por eso se consulta
 *   `/orders/v2/ordersBulk` (filtrado por fecha de modificación) y se leen los `selections[].fulfillmentStatus`.
 * - **Silencio en KDS bump**: Al marcarse READY por KDS, se persiste `announced = true`. El bump del KDS NO emite voz automática
 *   por los altavoces del restaurante. La voz se emite exclusivamente desde la tableta del preparador (`/inventory/preparador`).
 * - **Sincronización bidireccional y RECALL en KDS**:
 *   - Al marcarse READY en KDS, la orden sale automáticamente de la tableta del preparador (que solo muestra `status = IN_PROGRESS`).
 *   - Si el cocinero presiona RECALL en KDS, Toast revierte a SENT -> la orden regresa a `status = IN_PROGRESS` y reaparece de inmediato en la tableta del preparador.
 *   - Si el cocinero vuelve a borrar la orden en KDS, regresa a READY y se retira de nuevo de la tableta.
 * - **Hora real de cierre**: `ready_at` = mayor `modifiedDate` entre los platillos READY (momento real del doble tap).
 * - **Día laboral oficial (6:00 AM a 5:59:59 AM)**:
 *   - Toda orden se etiqueta con su `business_date` oficial según la regla de las 6 AM de Tacos Gavilan (medianoche a 5:59 AM cuenta como día anterior).
 *   - Al inicio del nuevo día laboral (6:00 AM), el inicio de ventana de sincronización nunca retrocede antes de las 6:00 AM de hoy,
 *     asegurando que el restaurante amanezca con el tablero 100% limpio y sin residuos del turno nocturno anterior.
 *
 * - **Persistencia KDS / Contenido de Comanda (items_summary)**:
 *   - Extrae los platillos no anulados (`selections`) y sus modificadores de Toast, consolidando platillos idénticos (ej. 9x Taco Asada).
 *   - Regla de cantidad (`quantity`): usa la propiedad oficial `quantity` (con soporte de lectura para `qty` heredado). Si `quantity` no viene definido (`null`/`undefined`), su valor por defecto es `1`. Si un platillo trae explícitamente `quantity <= 0` o un valor no finito (`NaN`/`Infinity`), NO se convierte silenciosamente en `1`, sino que se descarta de la preparación activa de cocina.
 *   - Persiste en `order_ready_announcements.items_summary` como JSON estructurado y ordenado canónicamente para el KDS y la tableta del preparador.
 *
 * - **Exclusión de Bebidas y Postres en Pantalla de Preparación (isDrinkOrDessertOnlyOrder)**:
 *   - Las órdenes compuestas EXCLUSIVAMENTE por bebidas (horchata, sodas, café, aguas, champurrado) o postres (flan, cheesecake)
 *     se atienden directamente en mostrador/caja y NO deben colocarse en la pantalla de preparación del preparador/parrilla (/inventory/preparador).
 *   - Si la comanda contiene al menos un platillo de cocina (tacos, burritos, quesadillas, sopes, mulitas, huevos, etc.), SÍ se muestra en cocina.
 *
 * @dataFlow
 * - Sincronización Toast explícita (`syncToast=true`) -> GET /api/order-ready/orders -> syncStoreFromToast()
 *   (con lease distribuido atómico por `store_code` en PostgreSQL + throttle en memoria de 5 s)
 *   -> Toast ordersBulk -> upsert/update selectivo en order_ready_announcements -> Board / Preparador Tablet.
 * - Eventos de Supabase Realtime y reconexiones WebSocket invocan GET /api/order-ready/orders?syncToast=false (solo lectura en BD, sin llamar a Toast) para romper el ciclo Realtime -> fetch -> syncToast -> UPDATE -> Realtime.
 * - Webhook `order_updated` reutiliza `evaluateToastOrder()`, `extractOrderItemsSummary()` y `areOrderItemsSummariesEqual()`.
 *
 * @notes
 * - Mapa de tiendas Toast GUID <-> código vive aquí (única fuente) y lo importa el webhook.
 * - FIX (2026-10-22):
 *   1. `extractOrderItemsSummary` usa la clave oficial `quantity`, ordena determinísticamente tanto `modifiers` como el arreglo `items`, consolida platillos con la misma configuración sumando cantidades, preserva configuraciones distintas sin alterar nombres visuales y descarta `quantity <= 0` sin convertirlo en `1`.
 *   2. `areOrderItemsSummariesEqual` compara semánticamente `quantity` (aceptando `qty` como compatibilidad heredada), preserva cantidades reales (incluyendo `0`), no oculta JSON inválido distinto y evita ejecutar `UPDATE` redundantes cuando Toast devuelve `selections` en diferente orden.
 *   3. `syncStoreFromToast` utiliza un lease distribuido atómico en PostgreSQL (`try_acquire_order_ready_sync_lease` / `release_order_ready_sync_lease`) con expiración automática (TTL) junto con deduplicación en memoria para evitar tormentas de sincronización entre instancias serverless.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'
import { getCaliforniaBusinessDate, getBusinessDayStartMs } from '@/lib/business-date'

function getToastApiHost(): string {
  return process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
}

import { TOAST_STORE_MAP, STORE_GUID_BY_CODE } from '@/lib/toast-stores'
export { TOAST_STORE_MAP, STORE_GUID_BY_CODE }

export type OrderReadyStatus = 'IN_PROGRESS' | 'READY' | 'COMPLETED'

export interface OrderItemSummary {
  quantity: number
  name: string
  modifiers: string[]
}

function parseCanonicalItemQuantity(item: any): number {
  const raw = item?.quantity !== undefined && item?.quantity !== null ? item.quantity : item?.qty
  if (raw === undefined || raw === null || raw === '') return 1
  const num = Number(raw)
  return Number.isFinite(num) ? num : 1
}

/**
 * Extrae y consolida los platillos y modificadores de una orden de Toast en formato JSON para el KDS y la tableta del preparador.
 */
export function extractOrderItemsSummary(order: any): string | null {
  if (!order) return null
  const checks = order.checks || (order.selections ? [{ selections: order.selections }] : [])
  if (!Array.isArray(checks) || checks.length === 0) return null

  // Consolidar platillos con el mismo nombre visual y mismos modificadores ordenados
  const map = new Map<string, OrderItemSummary>()

  for (const chk of checks) {
    if (chk?.voided || chk?.deleted) continue
    for (const sel of chk.selections || []) {
      if (!sel || sel.voided || sel.deleted) continue
      const name = String(sel.displayName || sel.name || '').trim()
      const isGiftCardSel = String(sel.selectionType || '').toUpperCase() === 'GIFT_CARD'
      if (!name || isNonFoodMarkerItem(name) || isGiftCardSel) continue

      const rawQty = sel.quantity !== undefined && sel.quantity !== null ? sel.quantity : sel.qty
      const parsedQty = rawQty === undefined || rawQty === null || rawQty === '' ? 1 : Number(rawQty)
      // Regla documentada: quantity <= 0 o NaN/Infinity no se convierte silenciosamente en 1; se omite por no tener unidades activas
      if (!Number.isFinite(parsedQty) || parsedQty <= 0) continue
      const q = parsedQty

      const mods: string[] = []
      if (Array.isArray(sel.modifiers)) {
        for (const m of sel.modifiers) {
          if (m === null || m === undefined) continue
          if (typeof m === 'object' && (m.voided || m.deleted)) continue
          const mName = String(typeof m === 'object' ? (m.displayName || m.name || '') : m).trim()
          if (mName && !isNonFoodMarkerItem(mName)) {
            mods.push(mName)
          }
        }
      }

      const sortedMods = [...mods].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      const key = `${name}:::${sortedMods.join('|')}`

      if (map.has(key)) {
        map.get(key)!.quantity += q
      } else {
        map.set(key, { quantity: q, name, modifiers: sortedMods })
      }
    }
  }

  const items = Array.from(map.values()).sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    const modA = a.modifiers.join('|')
    const modB = b.modifiers.join('|')
    if (modA !== modB) return modA < modB ? -1 : 1
    return a.quantity - b.quantity
  })
  return items.length > 0 ? JSON.stringify(items) : null
}

/**
 * Compara dos resúmenes de platillos (`items_summary`) de forma canónica (independiente del orden del arreglo)
 * para evitar disparos innecesarios de `UPDATE` y eventos de Supabase Realtime.
 */
export function areOrderItemsSummariesEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) {
    return false
  }
  const normA = String(a).trim()
  const normB = String(b).trim()
  if (normA === normB) return true
  if (!normA || !normB) return false
  try {
    const parsedA = JSON.parse(normA)
    const parsedB = JSON.parse(normB)
    if (!Array.isArray(parsedA) || !Array.isArray(parsedB)) return false
    if (parsedA.length !== parsedB.length) return false
    const canonicalize = (arr: any[]) =>
      arr
        .map((item) => {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            return {
              __raw: JSON.stringify(item),
              quantity: -1,
              name: '',
              modifiers: [] as string[]
            }
          }
          return {
            quantity: parseCanonicalItemQuantity(item),
            name: String(item?.name ?? ''),
            modifiers: Array.isArray(item?.modifiers)
              ? [...item.modifiers].map((m: any) => String(m ?? '')).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
              : []
          }
        })
        .sort((x, y) => {
          if (x.name !== y.name) return x.name < y.name ? -1 : 1
          const modX = x.modifiers.join('|')
          const modY = y.modifiers.join('|')
          if (modX !== modY) return modX < modY ? -1 : 1
          return x.quantity - y.quantity
        })
    return JSON.stringify(canonicalize(parsedA)) === JSON.stringify(canonicalize(parsedB))
  } catch {
    return false
  }
}

import { isDrinkOrDessertItem, isNonFoodMarkerItem } from '@/lib/order-ready-filter'
export * from '@/lib/order-ready-filter'

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

/**
 * Clasifica una orden de Toast leyendo el fulfillmentStatus de cada platillo (selection).
 *
 * REGLA CRÍTICA DE COCINA (FIX Slauson #429):
 * - Cuando una orden incluye platillos de cocina (ej. Torta Cubana + 2 Tacos Cabeza) junto con un postre o bebida
 *   (ej. Cheesecake, Flan, Horchata), el postre/bebida suele marcarse `READY` en caja pocos segundos después de cobrarse,
 *   mientras los platillos de cocina siguen en `SENT` preparándose en la plancha durante varios minutos.
 * - Asimismo, si una orden tiene varios platillos de cocina y solo uno se marca `READY` mientras otros siguen `SENT`,
 *   la orden aún NO está terminada en cocina.
 * - Por lo tanto:
 *   1) Si la orden tiene platillos de cocina (`kitchenSent + kitchenReady > 0`), EXCLUSIVAMENTE los platillos de cocina
 *      gobiernan el estado `IN_PROGRESS` vs `READY`.
 *   2) Mientras exista al menos 1 platillo de cocina en `SENT` (`kitchenSent > 0`), la orden permanece en `IN_PROGRESS`
 *      para que siga visible en la tableta del preparador (`/inventory/preparador`).
 *   3) Solo cuando TODOS los platillos de cocina enviados pasan a `READY`/`FULFILLED` (`kitchenReady > 0 && kitchenSent === 0`),
 *      la orden pasa a `READY` (ignorando bebidas como Horchata/Champurrado que permanecen en `SENT` por no ir al KDS).
 */
export function evaluateToastOrder(order: any): ToastOrderEvaluation {
  if (!order || order.voided || order.deleted) {
    return { status: 'COMPLETED', readyAt: null, sentAt: null, activeItems: 0, sentItems: 0, readyItems: 0 }
  }

  let activeItems = 0
  let sentItems = 0
  let readyItems = 0
  let kitchenActive = 0
  let kitchenSent = 0
  let kitchenReady = 0
  let latestKitchenReadyMs = 0
  let latestAnyReadyMs = 0
  let earliestSentMs = Infinity

  for (const check of order.checks || []) {
    if (check?.voided || check?.deleted) continue
    for (const sel of check.selections || []) {
      if (!sel || sel.voided || sel.deleted) continue
      const name = String(sel.displayName || sel.name || '').trim()
      const isGiftCardSel = String(sel.selectionType || '').toUpperCase() === 'GIFT_CARD'
      // Separadores de tacos del POS ("--- Taco Separator ---", "********"), Gift Cards y marcadores no son platillos reales
      if (!name || isNonFoodMarkerItem(name) || isGiftCardSel) continue
      activeItems++

      const isDrinkDessert = isDrinkOrDessertItem(name)
      if (!isDrinkDessert) {
        kitchenActive++
      }

      const itemDateStr = sel.sentDate || sel.createdDate || sel.modifiedDate
      const itemDateMs = Date.parse(itemDateStr || '')
      if (Number.isFinite(itemDateMs) && itemDateMs < earliestSentMs) {
        earliestSentMs = itemDateMs
      }

      const st = String(sel.fulfillmentStatus || '').toUpperCase()
      if (st === 'READY' || st === 'FULFILLED') {
        readyItems++
        const ms = Date.parse(sel.modifiedDate || '')
        if (Number.isFinite(ms) && ms > latestAnyReadyMs) latestAnyReadyMs = ms
        if (!isDrinkDessert) {
          kitchenReady++
          if (Number.isFinite(ms) && ms > latestKitchenReadyMs) latestKitchenReadyMs = ms
        }
      } else if (st === 'SENT') {
        sentItems++
        if (!isDrinkDessert) {
          kitchenSent++
        }
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

  // 2. Si la orden contiene platillos de cocina, los platillos de cocina gobiernan el estado:
  //    - Mientras haya al menos 1 platillo de cocina en SENT (kitchenSent > 0), sigue IN_PROGRESS en la tableta del preparador.
  //    - Cuando todos los platillos de cocina enviados están READY (kitchenReady > 0 && kitchenSent === 0), pasa a READY.
  if (kitchenActive > 0) {
    if (kitchenSent > 0) {
      return {
        status: 'IN_PROGRESS',
        readyAt: null,
        sentAt,
        activeItems,
        sentItems,
        readyItems
      }
    }
    if (kitchenReady > 0) {
      return {
        status: 'READY',
        readyAt: new Date(latestKitchenReadyMs || latestAnyReadyMs || Date.now()).toISOString(),
        sentAt,
        activeItems,
        sentItems,
        readyItems
      }
    }
    return { status: 'COMPLETED', readyAt: null, sentAt, activeItems, sentItems, readyItems }
  }

  // 3. Si la orden solo tiene bebidas/postres (sin platillos de cocina):
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

  if (readyItems > 0) {
    return {
      status: 'READY',
      readyAt: new Date(latestAnyReadyMs || Date.now()).toISOString(),
      sentAt,
      activeItems,
      sentItems,
      readyItems
    }
  }

  // 4. Si no tiene platillos SENT ni READY, la orden está abierta en la caja sin enviar al expediter
  return { status: 'COMPLETED', readyAt: null, sentAt, activeItems, sentItems, readyItems }
}

/**
 * Traduce el nombre de la dining option y metadatos de Toast al canal del tablero.
 * FAIL-CLOSED: si el nombre viene vacío o no coincide con un canal presencial válido, devuelve 'UNKNOWN'
 * y si detecta indicios de plataforma (Uber, DoorDash, Grubhub, Postmates, Online, API, tabName) devuelve 'DELIVERY'.
 */
export function classifyDiningName(raw: string, orderObj?: any): 'TOGO' | 'FOR_HERE' | 'DELIVERY' | 'DRIVE_THRU' | 'UNKNOWN' {
  const up = (raw || '').toUpperCase().trim()
  const deliveryService = String(orderObj?.deliveryService?.name || orderObj?.deliveryService || '').toUpperCase().trim()
  const source = String(typeof orderObj?.source === 'string' ? orderObj.source : (orderObj?.source?.name || '')).toUpperCase().trim()
  const tabName = String(orderObj?.checks?.[0]?.tabName || orderObj?.tabName || '').toUpperCase().trim()
  const combinedMeta = `${up} ${deliveryService} ${source} ${tabName}`

  if (
    combinedMeta.includes('UBER') ||
    combinedMeta.includes('EATS') ||
    combinedMeta.includes('DOORDASH') ||
    combinedMeta.includes('GRUBHUB') ||
    combinedMeta.includes('POSTMATES') ||
    combinedMeta.includes('DELIVERY') ||
    combinedMeta.includes('TOAST ONLINE') ||
    combinedMeta.includes('ONLINE ORDERING') ||
    combinedMeta.includes('CURBSIDE') ||
    /^DD\s+[0-9A-F]{4,}/i.test(tabName) ||
    /^UBER[0-9A-F]{4,}/i.test(tabName) ||
    source === 'API'
  ) {
    return 'DELIVERY'
  }

  if (!up) return 'UNKNOWN'
  if (up.includes('DRIVE') || up.includes('THRU') || up.includes('DT') || up.includes('AUTO')) return 'DRIVE_THRU'
  if (up.includes('HERE') || up.includes('DINE') || up.includes('COMEDOR')) return 'FOR_HERE'
  if (
    up.includes('TO GO') ||
    up.includes('TOGO') ||
    up.includes('TAKEOUT') ||
    up.includes('TAKE OUT') ||
    up.includes('LLEVAR') ||
    up.includes('PICKUP') ||
    up.includes('PHONE') ||
    up.includes('KIOSK')
  ) {
    return 'TOGO'
  }
  return 'UNKNOWN'
}

// ── Mapa GUID -> nombre de dining option por tienda (cache 30 min). NUNCA hardcodear GUIDs de dining options. ──
const diningCache = new Map<string, { at: number; map: Record<string, string> }>()

export async function getDiningMap(token: string, restaurantGuid: string): Promise<Record<string, string>> {
  const cached = diningCache.get(restaurantGuid)
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.map
  const map: Record<string, string> = {}
  try {
    const res = await fetch(`${getToastApiHost()}/config/v2/diningOptions?pageSize=100`, {
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

// ── Throttle por tienda: varias tablets abiertas o instancias serverless no multiplican las llamadas a Toast ──
const lastRun = new Map<string, number>()
const inflight = new Map<string, Promise<void>>()
const THROTTLE_MS = 5000
const WINDOW_MINUTES = 25
const SILENT_AFTER_MS = 2 * 60 * 1000
const INSTANCE_HOLDER_ID = `node-${process.pid}-${Math.random().toString(36).slice(2, 10)}`

export function resetOrderReadySyncLocalCache(): void {
  lastRun.clear()
  inflight.clear()
  diningCache.clear()
}

function toastDate(d: Date): string {
  return d.toISOString().replace('Z', '+0000')
}

/**
 * Sincroniza las órdenes recientes (modificadas en los últimos 25 min) de una tienda desde Toast.
 * - Orden nueva  -> INSERT (IN_PROGRESS, o READY si el bump fue reciente)
 * - IN_PROGRESS que Toast ya marcó READY -> UPDATE a READY con ready_at real
 */
export async function syncStoreFromToast(storeCode: string, force = false): Promise<void> {
  const isIsolatedTestStore =
    process.env.ALLOW_ORDER_READY_TEST_DB === 'true' && storeCode.startsWith('CODEX_ORDER_READY_TEST')
  const restaurantGuid =
    STORE_GUID_BY_CODE[storeCode] || (isIsolatedTestStore ? `codex-test-guid-${storeCode}` : undefined)
  if (!restaurantGuid) return

  const running = inflight.get(storeCode)
  if (running) return running
  if (!force && Date.now() - (lastRun.get(storeCode) || 0) < THROTTLE_MS) return

  const job = (async () => {
    let leaseAcquired = false
    try {
      // 1. Intentar adquirir lease distribuido atómico en PostgreSQL (Phase 9)
      try {
        const { data: leaseOk, error: leaseErr } = await supabaseAdmin.rpc(
          'try_acquire_order_ready_sync_lease',
          {
            p_store_code: storeCode,
            p_holder_id: INSTANCE_HOLDER_ID,
            p_lease_ms: THROTTLE_MS,
            p_force: force
          }
        )
        if (!leaseErr) {
          if (leaseOk === false) {
            return
          }
          leaseAcquired = true
        }
      } catch {
        // Fallback silencioso a throttle en memoria si el RPC aún no está desplegado
      }

      const token = await getAuthToken()
      if (!token) {
        if (leaseAcquired) {
          try {
            await supabaseAdmin.rpc('release_order_ready_sync_lease', {
              p_store_code: storeCode,
              p_holder_id: INSTANCE_HOLDER_ID,
              p_cooldown_ms: 0
            })
          } catch {
            /* ignore */
          }
        }
        return
      }
      lastRun.set(storeCode, Date.now())

      const end = new Date()
      const bDayStartMs = getBusinessDayStartMs(end)
      // La ventana no debe traspasar hacia atrás la frontera de las 6:00 AM de hoy
      const windowStartMs = Math.max(end.getTime() - WINDOW_MINUTES * 60 * 1000, bDayStartMs)
      const start = new Date(windowStartMs)

      const orders: any[] = []
      const apiHost = getToastApiHost()
      for (let page = 1; page <= 4; page++) {
        const url = new URL(`${apiHost}/orders/v2/ordersBulk`)
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
        .select('id, status, order_guid, order_number, dining_option, items_summary, ready_at')
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

        const diningGuid = ord.diningOption?.guid || ord.checks?.[0]?.diningOption?.guid
        const diningName = diningMap[diningGuid] || ord.diningOption?.name || ''
        const diningOption = classifyDiningName(diningName, ord)
        const itemsSummary = extractOrderItemsSummary(ord)

        const row = byGuid.get(ord.guid)

        // FAIL-CLOSED: sin canal resuelto no se inserta nada (se reintenta en el siguiente ciclo)
        if (diningOption === 'UNKNOWN') continue

        // REGLA CRÍTICA: El Order Ready Board es EXCLUSIVO para COMEDOR (FOR_HERE) y PARA LLEVAR (TOGO).
        // Las órdenes de Drive-Thru y Delivery de plataformas se descartan por completo de este tablero.
        if (diningOption === 'DRIVE_THRU' || diningOption === 'DELIVERY') {
          if (row) {
            // Si la orden estaba en BD por error previo, retirarla de inmediato
            await supabaseAdmin.from('order_ready_announcements').delete().eq('id', row.id)
          }
          continue
        }

        const readyMs = ev.readyAt ? Date.parse(ev.readyAt) : null
        const isStale = readyMs !== null && nowMs - readyMs > SILENT_AFTER_MS

        if (row) {
          const updatePayload: any = {}
          if (row.dining_option !== diningOption) {
            updatePayload.dining_option = diningOption
          }
          if (itemsSummary && (!row.items_summary || !areOrderItemsSummariesEqual(row.items_summary, itemsSummary))) {
            updatePayload.items_summary = itemsSummary
          }
          if (ev.status === 'READY' && row.status === 'IN_PROGRESS') {
            // Bump en Toast KDS: pasa de IN_PROGRESS a READY.
            // Regla de Negocio Tacos Gavilan: El bump en KDS NO emite voz automática por altavoz.
            // Se marca announced = true para silenciar y se actualiza ready_at.
            // Al cambiar a READY, se retira automáticamente de la tableta del preparador.
            updatePayload.status = 'READY'
            updatePayload.ready_at = ev.readyAt
            updatePayload.announced = true
          } else if (ev.status === 'READY' && row.status === 'READY' && ev.readyAt) {
            const oldReadyMs = Date.parse(row.ready_at || '')
            const newReadyMs = Date.parse(ev.readyAt)
            if (Number.isFinite(newReadyMs) && (!Number.isFinite(oldReadyMs) || Math.abs(newReadyMs - oldReadyMs) > 1000)) {
              updatePayload.ready_at = ev.readyAt
            }
          } else if (ev.status === 'IN_PROGRESS' && row.status === 'READY') {
            // RECALL en Toast KDS (o corrección si un postre marcó READY antes que la cocina):
            // Vuelve a preparación (IN_PROGRESS), se limpia ready_at y vuelve a aparecer en la tableta del preparador.
            updatePayload.status = 'IN_PROGRESS'
            updatePayload.ready_at = null
            updatePayload.announced = false
          } else if (ev.status === 'COMPLETED' && row.status === 'IN_PROGRESS') {
            updatePayload.status = 'COMPLETED'
          }

          if (Object.keys(updatePayload).length > 0) {
            await supabaseAdmin
              .from('order_ready_announcements')
              .update(updatePayload)
              .eq('id', row.id)
          }
          continue
        }

        if (ev.status === 'COMPLETED') continue

        // Orden desconocida (el webhook no llegó): solo la insertamos si sigue activa o se cerró hace poco
        if (ev.status === 'READY' && readyMs !== null && nowMs - readyMs > 10 * 60 * 1000) continue

        const orderDate = ev.sentAt || ord.createdDate || ord.openedDate || ord.paidDate || new Date().toISOString()
        const bDate = getCaliforniaBusinessDate(orderDate)

        await supabaseAdmin.from('order_ready_announcements').upsert({
          store_code: storeCode,
          store_id: restaurantGuid,
          store_name: storeInfo?.name || storeCode,
          order_number: String(number),
          order_guid: ord.guid,
          dining_option: diningOption,
          customer_name: ord.customer?.firstName || null,
          status: ev.status,
          business_date: bDate,
          announced: ev.status === 'READY' ? true : false,
          ready_at: ev.status === 'READY' ? ev.readyAt : null,
          items_summary: itemsSummary,
          created_at: orderDate
        }, { onConflict: 'order_guid' })
      }
    } catch (err) {
      if (leaseAcquired) {
        try {
          await supabaseAdmin.rpc('release_order_ready_sync_lease', {
            p_store_code: storeCode,
            p_holder_id: INSTANCE_HOLDER_ID,
            p_cooldown_ms: 0
          })
        } catch {
          /* ignore */
        }
      }
      console.warn('[order-ready-sync] error:', err)
    } finally {
      inflight.delete(storeCode)
    }
  })()

  inflight.set(storeCode, job)
  return job
}
