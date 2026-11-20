/**
 * @module api/drive-thru/kore/driver-lookup
 * @description Endpoint en tiempo real para cruzar recolecciones de repartidores (`register_driver_pickup`) en el
 * simulador y asistente de voz "Kore Drive-Thru" contra la cola viva de Blindaje Delivery (`fetchOffPremiseOrders`
 * de `lib/delivery-armor.ts`: Toast POS + `delivery_packing_audits`).
 *
 * @businessRules
 * - **RBAC y Tiendas con Drive-Thru**: `authorizePhoneModuleRequest` + `KORE_SIM_ALLOWED_ROLES`, alcance por tienda y
 *   `stores.has_drive_thru = true` (#3, #6, #10, #12, #14, #15).
 * - **Estatus reales de Blindaje Delivery**:
 *   * `ready`: `audit.status === 'PACKED_AND_SEALED' | 'UNCLAIMED_2H'` o `kdsStatus === 'READY'` (sin void ni delivered).
 *   * `preparing`: `kdsStatus === 'IN_KITCHEN'` (en preparación/empaque).
 *   * `already_handed`: `audit.status === 'DELIVERED'`.
 *   * `ambiguous` / `not_found`: múltiples coincidencias cercanas sin código o aún no visible en cola.
 * - **Siempre Ventana 2 (`windowNumber: 2`)**: toda instrucción de recolección en Drive-Thru dirige al repartidor a la
 *   **ventana 2 (`Window 2`)**.
 * - **Degradación elegante**: si Toast tarda más de 4 s o falla temporalmente, responde `200` con `lookupDegraded: true`
 *   y guía limpia hacia Ventana 2 sin romper la conversación de voz.
 *
 * @dataFlow
 * - `KoreDriveThruSimulator` (`register_driver_pickup`) -> `POST /api/drive-thru/kore/driver-lookup`
 *   -> `lookupKoreDriverOrdersLive` (`fetchOffPremiseOrders(storeId)`) -> `{ ok: true, driverPickup, allReady, anyFound, windowNumber: 2, toolResult }`.
 *
 * @notes
 * - `Cache-Control: no-store` para reflejar el estatus de cocina/empaque al segundo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { KORE_MAX_DRIVER_ORDERS, normalizeKoreDriverPlatform, type KoreDriverPickup } from '@/lib/drive-thru-kore-order'
import { KORE_SIM_ALLOWED_ROLES, loadKoreStore, lookupKoreDriverOrdersLive } from '@/lib/drive-thru-kore'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return auth.response || jsonError(auth.error || 'No autenticado.', auth.status || 401)
    }
    const user = auth.user
    if (!KORE_SIM_ALLOWED_ROLES.has(user.role)) {
      return jsonError(`Acceso denegado: el rol '${user.role}' no tiene acceso a Kore Drive-Thru.`, 403)
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError('Cuerpo JSON inválido.', 400)
    }
    const b = body as Record<string, any>

    const rawStoreId = b.storeId ?? b.store_id
    const storeId =
      typeof rawStoreId === 'number'
        ? rawStoreId
        : /^\d+$/.test(String(rawStoreId ?? '').trim())
          ? Number(rawStoreId)
          : NaN
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return jsonError('storeId inválido (usa stores.id numérico).', 400)
    }

    if (!user.isGlobalAdmin && !user.allowedStoreIds.includes(storeId)) {
      return jsonError(`Acceso denegado: tu cuenta solo tiene autorización sobre la sucursal #${user.assignedStoreId}.`, 403)
    }

    const store = await loadKoreStore(storeId)
    if (!store || !store.isActive) return jsonError('Sucursal no encontrada o inactiva.', 404)
    if (!store.hasDriveThru) return jsonError('Esta sucursal no cuenta con Drive-Thru.', 422)

    const rawOrders = b.orders
    if (!Array.isArray(rawOrders) || rawOrders.length === 0 || rawOrders.length > KORE_MAX_DRIVER_ORDERS) {
      return jsonError(`orders debe contener entre 1 y ${KORE_MAX_DRIVER_ORDERS} órdenes.`, 400)
    }

    for (let i = 0; i < rawOrders.length; i++) {
      const entry = rawOrders[i]
      if (!entry || typeof entry !== 'object') {
        return jsonError(`Orden #${i + 1} inválida.`, 400)
      }
      const cName = String(entry.customer_name ?? entry.customerName ?? '').trim()
      const oCode = String(entry.order_code ?? entry.orderCode ?? '').trim()
      if (cName.length < 2 && oCode.length < 2) {
        return jsonError(`Orden #${i + 1}: proporciona customer_name u order_code (mínimo 2 caracteres).`, 400)
      }
    }

    const rawPlatform = b.platform !== undefined && b.platform !== null ? String(b.platform).trim() : ''
    const normalizedPlatform = rawPlatform ? normalizeKoreDriverPlatform(rawPlatform) || 'Other' : undefined

    const existingPickup: KoreDriverPickup | null =
      b.existingPickup && typeof b.existingPickup === 'object' && Array.isArray(b.existingPickup.orders)
        ? (b.existingPickup as KoreDriverPickup)
        : null

    const lang = b.lang === 'en' ? 'en' : b.lang === 'es' ? 'es' : undefined

    const lookup = await lookupKoreDriverOrdersLive({
      storeId: store.id,
      platform: normalizedPlatform,
      orders: rawOrders,
      existingPickup,
      notes: b.notes !== undefined ? String(b.notes ?? '') : undefined,
      confirmPickup: Boolean(b.confirm_pickup ?? b.confirmPickup),
      replace: Boolean(b.replace),
      lang
    })

    return NextResponse.json(lookup, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[Kore DT driver-lookup] POST error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error verificando estatus de órdenes de repartidor.', 500)
  }
}
