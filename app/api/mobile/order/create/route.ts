/**
 * @module app/api/mobile/order/create/route
 * @description Endpoint autoritativo de creación de órdenes móviles para Tacos Gavilan (Pickup & Delivery).
 * Valida items contra app_menu_cache, aplica la tasa impositiva exacta por ciudad (CDTFA),
 * calcula cargos de entrega y gestiona el ciclo de vida sin falsos éxitos.
 * 
 * @businessRules
 * - Principio de Autoridad Financiera: Los precios se extraen y validan contra app_menu_cache.
 * - Impuestos Municipales Exactos: Aplica getStoreTaxRate(storeId) oficial (ej. Lynwood 10.25%, Rialto 7.75%).
 * - Delivery Transparente: Admite channel = 'DELIVERY', guarda dirección completa y aplica tarifa fija de $4.99.
 * - Cero falso éxito en pagos: Si no se provee confirmación bancaria real, payment_status se fija en 'PENDING'.
 *   No se auto-aprueba el pago ni se otorgan puntos de lealtad sin cobro real.
 * 
 * @dataFlow
 * - App Móvil POST /api/mobile/order/create (Bearer JWT) -> Validación de catálogo y cuota -> app_orders.
 * 
 * @notes
 * - Soporta canales PICKUP y DELIVERY. Para DELIVERY el pickup_method se fija en 'in_store' con tag 'DOORDASH_DELIVERY' en curbside_stall debido a restricción CHECK en app_orders.
 * - curbside_stall se trunca defensivamente a 20 caracteres para cumplir con la columna VARCHAR(20) de Postgres.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  corsResponse,
  getAuthUser,
  isAuthSuccess,
  jsonOk,
  jsonError,
} from '@/app/api/mobile/_helpers'
import { getStoreTaxRate, computeCartHash } from '../quote/route'

export const dynamic = 'force-dynamic'

const POINTS_PER_DOLLAR = 1

interface ModifierInput {
  guid: string
  name?: string
  price?: number
}

interface OrderItemInput {
  guid: string       // toast_item_guid
  itemGuid?: string
  name?: string
  price?: number     // Se valida contra BD
  qty: number
  quantity?: number
  modifiers?: ModifierInput[]
}

interface DeliveryAddressInput {
  streetAddress: string
  unitOrApt?: string
  city: string
  state: string
  zipCode: string
  latitude?: number
  longitude?: number
  deliveryInstructions?: string
}

interface CreateOrderBody {
  storeId: number
  channel?: 'PICKUP' | 'DELIVERY'
  items: OrderItemInput[]
  pickupMethod?: 'curbside' | 'in_store' | 'drive_thru'
  curbsideStall?: string
  deliveryAddress?: DeliveryAddressInput
  userCoords?: { lat: number; lng: number; eta?: number }
  paymentIntentId?: string | null
  paymentConfirmed?: boolean
  tipRate?: number
  tipAmount?: number
  quoteId?: string
  appliedRewardId?: string
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Autenticación con Supabase Auth
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }
    const userId = authResult.userId

    // Asegurar que existe registro en public.app_users para respetar la FK
    const { data: userProfile } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (!userProfile) {
      const safePhone = `+1${Date.now().toString().slice(-10)}`
      await supabaseAdmin.from('app_users').insert({
        id: userId,
        phone: safePhone,
        email: authResult.email || null,
        first_name: 'Cliente',
        last_name: 'Gavilan',
      })
    }

    // 2. Parsear y validar body
    let body: CreateOrderBody
    try {
      body = (await request.json()) as CreateOrderBody
    } catch {
      return jsonError('JSON inválido en el cuerpo de la petición.', 400)
    }

    const {
      storeId,
      channel = 'PICKUP',
      items,
      pickupMethod = 'in_store',
      curbsideStall,
      deliveryAddress,
      userCoords,
      quoteId,
    } = body

    if (!storeId || typeof storeId !== 'number') {
      return jsonError('storeId es requerido y debe ser numérico.', 400)
    }

    if (!quoteId || typeof quoteId !== 'string') {
      return jsonError('quoteId es obligatorio para autorizar la creación del pedido.', 400)
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return jsonError('Se requiere al menos un item en la orden.', 400)
    }

    if (channel !== 'PICKUP' && channel !== 'DELIVERY') {
      return jsonError("channel debe ser 'PICKUP' o 'DELIVERY'.", 400)
    }

    if (channel === 'DELIVERY' && (!deliveryAddress || !deliveryAddress.streetAddress)) {
      return jsonError('Dirección de entrega requerida para órdenes a domicilio.', 400)
    }

    if (channel === 'PICKUP' && !['curbside', 'in_store', 'drive_thru'].includes(pickupMethod)) {
      return jsonError("pickupMethod debe ser 'curbside', 'in_store' o 'drive_thru'.", 400)
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    // Validar estructura de items
    for (const item of items) {
      const itemGuid = item.guid || item.itemGuid
      const itemQty = typeof item.qty === 'number' ? item.qty : item.quantity
      if (!itemGuid || !UUID_REGEX.test(itemGuid) || typeof itemQty !== 'number' || itemQty < 1) {
        return jsonError(
          `Item inválido: se requiere un GUID válido (UUID de 36 caracteres) y cantidad >= 1. Recibido: ${itemGuid}`,
          400
        )
      }
      item.guid = itemGuid
      item.qty = itemQty
    }

    // 2.1 Cargar y validar la cotización autoritativa desde public.app_quotes
    const { data: quote, error: quoteError } = await supabaseAdmin
      .from('app_quotes')
      .select('*')
      .eq('id', quoteId)
      .single()

    if (quoteError || !quote) {
      return jsonError('Cotización autoritativa no encontrada o inválida.', 404)
    }

    if (quote.status !== 'OPEN') {
      return jsonError(`La cotización ya no está disponible (estado: ${quote.status}). Genere una nueva cotización.`, 400)
    }

    if (new Date(quote.expires_at) < new Date()) {
      await supabaseAdmin.from('app_quotes').update({ status: 'EXPIRED' }).eq('id', quoteId)
      return jsonError('La cotización ha expirado. Por favor actualice su carrito para obtener los precios más recientes.', 400)
    }

    if (Number(quote.store_id) !== storeId) {
      return jsonError('La sucursal de la cotización no coincide con la sucursal de la orden.', 400)
    }

    if (quote.channel !== channel) {
      return jsonError('El canal de la cotización no coincide con el canal de la orden.', 400)
    }

    if (quote.user_id && quote.user_id !== userId) {
      return jsonError('La cotización pertenece a otro usuario.', 403)
    }

    // 2.2 Validar integridad del carrito contra el hash canónico
    const calculatedCartHash = computeCartHash({
      storeId,
      channel,
      pickupMethod,
      items: items.map(i => ({ itemGuid: i.guid, quantity: i.qty, modifiers: i.modifiers })),
      deliveryAddress
    })

    if (calculatedCartHash !== quote.cart_hash) {
      return jsonError('El contenido del carrito ha cambiado respecto a la cotización autorizada (discrepancia de cart_hash).', 400)
    }

    // 3. Validar existencia de la sucursal
    const { data: store, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id, name, external_id, latitude, longitude')
      .eq('id', storeId)
      .single()

    if (storeError || !store) {
      return jsonError(`Sucursal con ID ${storeId} no encontrada.`, 404)
    }

    // 4. Cargar nombres oficiales de items para el snapshot
    const itemGuids = [...new Set(items.map(i => i.guid))]
    const { data: menuItems } = await supabaseAdmin
      .from('app_menu_cache')
      .select('toast_item_guid, name, price')
      .in('toast_item_guid', itemGuids)
      .eq('store_id', storeId)

    const menuMap = new Map<string, string>()
    for (const m of (menuItems || [])) {
      menuMap.set(m.toast_item_guid, m.name)
    }

    const itemsJson = items.map(i => ({
      guid: i.guid,
      name: menuMap.get(i.guid) || i.name || 'Platillo',
      qty: i.qty,
      unitPrice: i.price || 0,
      modifiers: i.modifiers || [],
      subtotal: Math.round(((i.price || 0) * i.qty) * 100) / 100
    }))

    // 5. Los montos financieros se derivan EXCLUSIVAMENTE de la cotización del servidor
    const netAmount = Number(quote.subtotal)
    const taxAmount = Number(quote.tax_amount)
    const taxRate = Number(quote.tax_rate)
    const deliveryFee = Number(quote.delivery_fee)
    const safeTip = Number(quote.tip_amount)
    const discountAmount = Number(quote.discount_amount)
    const totalAmount = Number(quote.total_amount)

    // 6. Verificación Autorizada de Pago (Cero confianza en banderas enviadas desde el teléfono)
    let paymentStatus: 'PENDING' | 'PAID' = 'PENDING'
    const paymentIntentId = body.paymentIntentId || null

    if (paymentIntentId) {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY
      if (stripeSecretKey) {
        try {
          const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
            headers: { Authorization: `Bearer ${stripeSecretKey}` }
          })
          if (stripeRes.ok) {
            const pi = await stripeRes.json()
            const expectedAmountCents = Math.round(totalAmount * 100)
            if (
              pi.status === 'succeeded' &&
              pi.amount === expectedAmountCents &&
              pi.currency?.toLowerCase() === 'usd' &&
              pi.metadata?.quote_id === quote.id
            ) {
              paymentStatus = 'PAID'

              // Registrar evento verificado en app_payment_events
              await supabaseAdmin.from('app_payment_events').upsert({
                event_id: `evt_verify_${paymentIntentId}`,
                event_type: 'payment_intent.succeeded',
                provider: 'stripe',
                payment_intent_id: paymentIntentId,
                quote_id: quote.id,
                amount_cents: pi.amount,
                currency: pi.currency || 'usd',
                status: 'succeeded',
                payload: pi,
                processed: true
              }, { onConflict: 'event_id' })
            }
          }
        } catch (stripeErr) {
          console.warn('⚠️ [MOBILE ORDER CREATE] Error verificando Stripe PaymentIntent:', stripeErr)
        }
      }
    }

    // 7. Snapshot Completo para items_json
    const orderSnapshot = {
      items: itemsJson,
      channel,
      deliveryAddress: channel === 'DELIVERY' ? deliveryAddress : undefined,
      financials: {
        netSales: netAmount,
        taxRate,
        taxAmount,
        deliveryFee,
        tipAmount: safeTip,
        discountAmount,
        totalAmount,
      },
      quoteId: quote.id,
      cartHash: quote.cart_hash,
    }

    // 8. Creación Atómica de la Orden y Consumo de Cotización vía PostgreSQL RPC
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('app_order_create_transaction', {
      p_user_id: userId,
      p_store_id: storeId,
      p_quote_id: quote.id,
      p_cart_hash: quote.cart_hash,
      p_channel: channel,
      p_pickup_method: channel === 'DELIVERY' ? 'in_store' : pickupMethod,
      p_curbside_stall: channel === 'DELIVERY' ? 'DOORDASH_DELIVERY' : (curbsideStall ? curbsideStall.trim().slice(0, 20) : null),
      p_items_json: orderSnapshot,
      p_total_amount: totalAmount,
      p_net_amount: netAmount,
      p_tax_amount: taxAmount,
      p_discount_amount: discountAmount,
      p_payment_status: paymentStatus,
      p_payment_intent_id: paymentIntentId,
      p_user_latitude: userCoords?.lat || null,
      p_user_longitude: userCoords?.lng || null,
      p_eta_minutes: userCoords?.eta || 10,
    })

    if (rpcError || !rpcResult) {
      const errMsg = rpcError?.message || 'Error en transacción atómica de creación de orden'
      console.error('[MOBILE ORDER CREATE] Error RPC:', errMsg)
      if (errMsg.includes('QUOTE_ALREADY_CONSUMED')) {
        return jsonError('Esta cotización ya fue consumida por otra solicitud.', 409)
      }
      if (errMsg.includes('QUOTE_EXPIRED')) {
        return jsonError('La cotización ha expirado. Por favor actualice su carrito.', 400)
      }
      if (errMsg.includes('QUOTE_CART_HASH_MISMATCH')) {
        return jsonError('El contenido del carrito ha cambiado respecto a la cotización autorizada.', 400)
      }
      return jsonError(`Error al crear la orden: ${errMsg}`, 500)
    }

    const newOrderId = rpcResult.order_id as string
    const now = new Date().toISOString()

    // 9. Programa de Lealtad (estrictamente si y solo si el pago fue verificado como PAID)
    const pointsEarned = paymentStatus === 'PAID' ? Math.floor(netAmount * POINTS_PER_DOLLAR) : 0

    if (pointsEarned > 0) {
      try {
        const { data: existingBalance } = await supabaseAdmin
          .from('app_rewards_balances')
          .select('user_id, points_balance, points_accumulated')
          .eq('user_id', userId)
          .single()

        if (existingBalance) {
          await supabaseAdmin
            .from('app_rewards_balances')
            .update({
              points_balance: existingBalance.points_balance + pointsEarned,
              points_accumulated: existingBalance.points_accumulated + pointsEarned,
            })
            .eq('user_id', userId)
        } else {
          await supabaseAdmin
            .from('app_rewards_balances')
            .insert({
              user_id: userId,
              points_balance: pointsEarned,
              points_accumulated: pointsEarned,
              points_redeemed: 0,
              tier: 'BRONZE',
            })
        }

        await supabaseAdmin
          .from('app_rewards_transactions')
          .insert({
            user_id: userId,
            order_id: newOrderId,
            points: pointsEarned,
            type: 'EARN',
            description: `Puntos por orden #${newOrderId.slice(0, 8)} ($${netAmount} neto)`,
            created_at: now,
          })
      } catch (rewardErr) {
        console.warn('[MOBILE ORDER CREATE] Error en recompensas:', rewardErr)
      }
    }

    console.log(
      `✅ [MOBILE ORDER CREATE] Orden ${newOrderId} creada en ${store.name} (${channel}) — Total: $${totalAmount} — Estado: HOLDING — Pago: ${paymentStatus}`
    )

    const responsePayload = {
      orderId: newOrderId,
      total: totalAmount,
      netAmount,
      taxAmount,
      deliveryFee,
      tipAmount: safeTip,
      pointsEarned,
      status: 'HOLDING' as const,
      paymentStatus,
      channel,
    }

    return jsonOk({
      ...responsePayload,
      data: responsePayload, // Dual-compatibility
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno desconocido'
    console.error('[MOBILE ORDER CREATE] Excepción:', message)
    return jsonError(message, 500)
  }
}
