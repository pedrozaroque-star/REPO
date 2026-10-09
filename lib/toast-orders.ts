/**
 * @module lib/toast-orders
 * @description Motor autoritativo de inyección, sincronización y bandeja de salida (Outbox) hacia Toast POS Orders API v2.
 * Despacha tickets de cocina al Kitchen Display System (KDS) de las sucursales de Tacos Gavilan de forma transaccional e idempotente.
 * 
 * @businessRules
 * - Cero éxito ficticio: Si Toast API rechaza la creación de la comanda (por ejemplo, error 403 por falta de
 *   permisos de escritura en las credenciales API, o desconexión), se propaga el error explícito y NUNCA se inventa
 *   un GUID simulado ('simulated_xxx') ni se declara la orden exitosa.
 * - Mapeo dinámico de Dining Options: NUNCA hardcodear GUIDs de servicio; se obtienen en tiempo real por sucursal
 *   vía getDiningOptionsMap para traducir 'Curbside', 'Takeout' o 'Delivery'.
 * - Fidelidad de items y modificadores: Cada línea de producto debe contener el toast_item_guid verificado
 *   en app_menu_cache.
 * - Bandeja de Salida (Transactional Outbox): Cada intento de inyección actualiza el registro correspondiente en
 *   public.app_order_outbox con reintentos exponenciales y estado de entrega verificado. Si la inyección falla, la orden
 *   permanece en 'HOLDING' y nunca transiciona a 'FIRED'.
 * 
 * @dataFlow
 * - app_orders (Supabase) + app_order_outbox -> injectOrderToToast(orderId) -> Toast API (/orders/v2/orders) ->
 *   Actualiza app_orders.toast_order_guid + app_orders.status ('FIRED') y app_order_outbox.status ('SUCCEEDED').
 * 
 * @notes
 * - Soporta ejecución reactiva (disparo JIT por geofence / curbside) y periódica vía processOutboxOrders().
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

/**
 * Consulta el mapa dinámico de opciones de servicio (Dining Options) de una sucursal en Toast.
 * Asocia GUID -> Nombre (ej. "Curbside", "Takeout", "Dine-In", "Delivery").
 */
export async function getDiningOptionsMap(
  token: string,
  restaurantGuid: string
): Promise<Record<string, string>> {
  try {
    const url = `${TOAST_API_HOST}/config/v2/diningOptions`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': restaurantGuid,
      },
    })

    if (!res.ok) {
      console.warn(`[Toast Dining Options] HTTP ${res.status} para tienda ${restaurantGuid}`)
      return {}
    }

    const data = await res.json()
    const map: Record<string, string> = {}
    if (Array.isArray(data)) {
      for (const opt of data) {
        if (opt.guid && opt.name) {
          map[opt.guid] = opt.name
        }
      }
    }
    return map
  } catch (err) {
    console.warn(`[Toast Dining Options] Error consultando opciones para ${restaurantGuid}:`, err)
    return {}
  }
}

export interface ToastInjectionResult {
  ok: boolean
  toastOrderGuid?: string
  error?: string
  details?: Record<string, unknown>
}

/**
 * Actualiza la bandeja de salida (app_order_outbox) tras un intento de inyección a Toast KDS.
 */
async function syncOutboxAfterAttempt(orderId: string, result: ToastInjectionResult): Promise<void> {
  const now = new Date().toISOString()
  try {
    const { data: rows } = await supabaseAdmin
      .from('app_order_outbox')
      .select('id, attempts, max_attempts')
      .eq('order_id', orderId)
      .eq('integration', 'toast_kds')

    if (!rows || rows.length === 0) return

    const row = rows[0]
    if (result.ok && result.toastOrderGuid) {
      await supabaseAdmin
        .from('app_order_outbox')
        .update({
          status: 'SUCCEEDED',
          external_reference: result.toastOrderGuid,
          response_payload: result.details || { toastOrderGuid: result.toastOrderGuid },
          last_attempt_at: now,
          locked_at: null,
          locked_by: null,
          updated_at: now,
        })
        .eq('id', row.id)
    } else {
      const nextAttemptNumber = (row.attempts || 0) + 1
      const maxAttempts = row.max_attempts || 3
      const isDead = nextAttemptNumber >= maxAttempts
      // Backoff exponencial: 30s, 60s, 120s... máx 600s
      const backoffSec = Math.min(30 * Math.pow(2, nextAttemptNumber - 1), 600)
      const nextAttemptAt = new Date(Date.now() + backoffSec * 1000).toISOString()

      await supabaseAdmin
        .from('app_order_outbox')
        .update({
          status: isDead ? 'DEAD_LETTER' : 'FAILED',
          attempts: nextAttemptNumber,
          last_attempt_at: now,
          next_attempt_at: nextAttemptAt,
          error_log: result.error || 'Fallo desconocido de comunicación con Toast POS',
          locked_at: null,
          locked_by: null,
          updated_at: now,
        })
        .eq('id', row.id)
    }
  } catch (syncErr) {
    console.warn(`[Toast Outbox] Advertencia al sincronizar estado de outbox para orden ${orderId}:`, syncErr)
  }
}

/**
 * Inyecta una orden móvil registrada en Supabase directamente al POS / KDS de Toast.
 * Si tiene éxito, transiciona la orden a 'FIRED' y registra el toast_order_guid real.
 * Si falla, mantiene la orden en 'HOLDING', registra el error y programa el reintento en el outbox.
 */
export async function injectOrderToToast(orderId: string): Promise<ToastInjectionResult> {
  try {
    // 1. Obtener la orden de la base de datos
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('app_orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderErr || !order) {
      const res: ToastInjectionResult = { ok: false, error: `Orden ${orderId} no encontrada en base de datos.` }
      await syncOutboxAfterAttempt(orderId, res)
      return res
    }

    // 1.1 Validar que la orden esté pagada antes de enviar comanda al KDS
    if (order.payment_status !== 'PAID') {
      const res: ToastInjectionResult = {
        ok: false,
        error: `No se puede inyectar la comanda al KDS: la orden ${orderId} no ha sido pagada (estado actual: ${order.payment_status}). Se requiere pago confirmado.`,
      }
      await syncOutboxAfterAttempt(orderId, res)
      return res
    }

    // 2. Obtener la sucursal y su external_id de Toast
    const { data: store, error: storeErr } = await supabaseAdmin
      .from('stores')
      .select('id, name, external_id')
      .eq('id', order.store_id)
      .single()

    if (storeErr || !store || !store.external_id) {
      const res: ToastInjectionResult = {
        ok: false,
        error: `La sucursal ID ${order.store_id} no cuenta con external_id de Toast configurado.`,
      }
      await syncOutboxAfterAttempt(orderId, res)
      return res
    }

    const restaurantGuid = store.external_id

    // 3. Autenticación con Toast API
    let token: string
    try {
      const rawToken = await getAuthToken()
      if (!rawToken) {
        const res: ToastInjectionResult = { ok: false, error: 'Credenciales de Toast API no configuradas o no válidas.' }
        await syncOutboxAfterAttempt(orderId, res)
        return res
      }
      token = rawToken
    } catch (authErr) {
      const msg = authErr instanceof Error ? authErr.message : 'Fallo de autenticación Toast'
      console.error('[Toast Injection] Error de autenticación:', msg)
      const res: ToastInjectionResult = { ok: false, error: `No fue posible autenticarse con Toast API: ${msg}` }
      await syncOutboxAfterAttempt(orderId, res)
      return res
    }

    // 4. Mapeo dinámico de Dining Options
    const diningOptions = await getDiningOptionsMap(token, restaurantGuid)
    const pickupMethod = (order.pickup_method || 'in_store').toLowerCase()
    const targetOptionName =
      pickupMethod === 'curbside' ? 'Curbside' :
      pickupMethod === 'drive_thru' ? 'Drive-Thru' : 'Takeout'

    let matchedOptionGuid: string | undefined = undefined
    for (const [guid, name] of Object.entries(diningOptions)) {
      if (name.toLowerCase().includes(targetOptionName.toLowerCase())) {
        matchedOptionGuid = guid
        break
      }
    }

    // Fallback a takeout si no encuentra curbside
    if (!matchedOptionGuid) {
      for (const [guid, name] of Object.entries(diningOptions)) {
        if (name.toLowerCase().includes('takeout') || name.toLowerCase().includes('to go')) {
          matchedOptionGuid = guid
          break
        }
      }
    }

    // 5. Extraer partidas de la orden (items_json)
    const rawItems = Array.isArray(order.items_json)
      ? order.items_json
      : (order.items_json as any)?.items || []

    const selections = rawItems.map((item: any) => {
      const itemModifiers = Array.isArray(item.modifiers) ? item.modifiers : []
      const itemGuid = item.guid || item.itemGuid
      return {
        item: { guid: itemGuid },
        quantity: item.quantity || item.qty || 1,
        price: Number(item.unit_price || item.unitPrice || item.price || 0),
        modifiers: itemModifiers.map((mod: any) => ({
          optionGroup: mod.groupGuid ? { guid: mod.groupGuid } : undefined,
          item: { guid: mod.guid },
          price: Number(mod.price || 0),
        })),
      }
    })

    // 6. Construir Payload estricto de Toast Orders API v2
    const toastOrderPayload = {
      restaurantGuid,
      source: 'TACOS_GAVILAN_APP',
      diningOption: matchedOptionGuid ? { guid: matchedOptionGuid } : undefined,
      curbsidePickupInfo:
        order.pickup_method === 'curbside' && order.curbside_stall
          ? {
              vehicleDescription: order.curbside_stall,
            }
          : undefined,
      checks: [
        {
          amount: Number(order.total_amount),
          taxAmount: Number(order.tax_amount),
          netAmount: Number(order.net_amount),
          payments: [
            {
              type: 'OTHER',
              amount: Number(order.total_amount),
              otherType: {
                name: 'App Móvil Tacos Gavilan',
              },
              paymentStatus: order.payment_status === 'PAID' ? 'CAPTURED' : 'OPEN',
            },
          ],
          selections,
        },
      ],
    }

    // 7. Enviar petición HTTP a Toast API Orders endpoint
    const postOrderUrl = `${TOAST_API_HOST}/orders/v2/orders`
    const res = await fetch(postOrderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': restaurantGuid,
      },
      body: JSON.stringify(toastOrderPayload),
    })

    if (!res.ok) {
      const errorText = await res.text()
      let parsedError: any = errorText
      try {
        parsedError = JSON.parse(errorText)
      } catch {}

      console.warn(
        `❌ [Toast Injection] Toast POS rechazó el pedido (HTTP ${res.status}):`,
        errorText
      )

      const errMessage = `Toast POS rechazó el pedido (HTTP ${res.status}): ${typeof parsedError?.message === 'string' ? parsedError.message : errorText}`
      const failureResult: ToastInjectionResult = {
        ok: false,
        error: errMessage,
        details: typeof parsedError === 'object' ? parsedError : { raw: errorText },
      }

      // Actualizar error en app_orders sin alterar estado a FIRED
      const currentItemsJson = typeof order.items_json === 'object' && order.items_json !== null
        ? (order.items_json as Record<string, any>)
        : {}

      await supabaseAdmin
        .from('app_orders')
        .update({
          items_json: {
            ...currentItemsJson,
            toastInjectionError: errMessage,
            lastToastAttemptAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)

      await syncOutboxAfterAttempt(orderId, failureResult)
      return failureResult
    }

    const toastResponse = await res.json()
    const toastOrderGuid = toastResponse.guid || toastResponse.id

    if (!toastOrderGuid) {
      const failureResult: ToastInjectionResult = {
        ok: false,
        error: 'Toast POS respondió exitosamente pero no incluyó un identificador de orden (GUID).',
      }
      await syncOutboxAfterAttempt(orderId, failureResult)
      return failureResult
    }

    // 8. Actualizar orden en base de datos con su GUID real y estado FIRED
    const { error: updateErr } = await supabaseAdmin
      .from('app_orders')
      .update({
        status: 'FIRED',
        toast_order_guid: toastOrderGuid,
        fired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)

    if (updateErr) {
      console.error('[Toast Injection] Error actualizando app_orders con toast_order_guid:', updateErr)
    }

    console.log(
      `✅ [Toast Injection] Orden ${orderId} inyectada exitosamente en Toast POS de ${store.name} -> Toast GUID: ${toastOrderGuid}`
    )

    const successResult: ToastInjectionResult = {
      ok: true,
      toastOrderGuid,
      details: toastResponse,
    }

    await syncOutboxAfterAttempt(orderId, successResult)
    return successResult
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido al inyectar comanda'
    console.error('❌ [Toast Injection] Excepción fatal:', message)
    const errResult: ToastInjectionResult = {
      ok: false,
      error: `Error interno de comunicación con Toast POS: ${message}`,
    }
    await syncOutboxAfterAttempt(orderId, errResult)
    return errResult
  }
}

export interface ProcessOutboxSummary {
  processed: number
  succeeded: number
  failed: number
  deadLetter: number
  skipped: number
  results: Array<{
    outboxId: string
    orderId: string
    status: string
    toastGuid?: string
    error?: string
  }>
}

/**
 * Worker procesador de la bandeja de salida (Outbox Worker) para órdenes móviles pendientes de Toast KDS.
 * Reclama registros PENDING o FAILED cuya fecha next_attempt_at sea menor o igual a NOW().
 */
export async function processOutboxOrders(batchSize: number = 10): Promise<ProcessOutboxSummary> {
  const workerId = `outbox_worker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  // 1. Reclamar batch atómicamente con FOR UPDATE SKIP LOCKED
  const { data: pendingRows, error: fetchErr } = await supabaseAdmin.rpc('claim_outbox_batch', {
    p_worker_id: workerId,
    p_batch_size: batchSize,
  })

  if (fetchErr || !pendingRows || pendingRows.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, deadLetter: 0, skipped: 0, results: [] }
  }

  const summary: ProcessOutboxSummary = {
    processed: pendingRows.length,
    succeeded: 0,
    failed: 0,
    deadLetter: 0,
    skipped: 0,
    results: [],
  }

  for (const row of pendingRows) {
    if (row.integration !== 'toast_kds') {
      summary.skipped++
      continue
    }

    const res = await injectOrderToToast(row.order_id)
    if (res.ok) {
      summary.succeeded++
      summary.results.push({
        outboxId: row.id,
        orderId: row.order_id,
        status: 'SUCCEEDED',
        toastGuid: res.toastOrderGuid,
      })
    } else {
      const isDead = (row.attempts + 1) >= (row.max_attempts || 3)
      if (isDead) {
        summary.deadLetter++
      } else {
        summary.failed++
      }
      summary.results.push({
        outboxId: row.id,
        orderId: row.order_id,
        status: isDead ? 'DEAD_LETTER' : 'FAILED',
        error: res.error,
      })
    }
  }

  return summary
}
