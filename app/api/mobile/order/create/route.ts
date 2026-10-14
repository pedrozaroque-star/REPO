/**
 * @module api/mobile/order/create
 * @description Endpoint transaccional para creación de órdenes nativas en Tacos Gavilan App.
 * Exige una cotización vigente en `public.app_quotes` con `price_source = 'toast_prices'`,
 * verifica integridad criptográfica (`cart_hash`) y exige autorización de pago verificada
 * mediante el adaptador `PaymentProvider` antes de invocar el RPC atómico `app_order_create_transaction`.
 *
 * @businessRules
 * - Prohibido crear órdenes sin `quoteId` autoritativo de Toast `/orders/v2/prices` (`price_source = 'toast_prices'`).
 * - Prohibido confiar en precios o modificadores enviados por el teléfono: el snapshot de artículos
 *   y montos se toma exclusivamente de la fila verificada en `public.app_quotes`.
 * - Prohibido crear órdenes o consumir quotes con `PENDING_PAYMENT` sin autorización real del proveedor de pago.
 * - Puntos de lealtad deshabilitados por feature flag (`ENABLE_MOBILE_LOYALTY === 'true'`).
 * - Delivery deshabilitado por feature flag (`ENABLE_MOBILE_DELIVERY === 'true'`).
 *
 * @dataFlow
 * - POST /api/mobile/order/create -> `app_quotes` (`OPEN`, `toast_prices`) -> `getActivePaymentProvider()`
 *   -> RPC `app_order_create_transaction` -> `app_orders` + `app_order_outbox`.
 *
 * @notes
 * - Eliminados el import muerto `getStoreTaxRate`, la creación de perfiles ficticios y la confianza
 *   en `body.items[i].price`.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getAuthUser,
  isAuthSuccess,
  corsResponse,
  jsonOk,
  jsonError,
} from '../../_helpers'
import { computeCartHash } from '../quote/route'
import {
  getActivePaymentProvider,
  type NativePaymentFinancialStatus,
} from '@/lib/mobile/payment-provider'

const VALID_PICKUP_METHODS = ['curbside', 'in_store', 'drive_thru'] as const
type PickupMethod = (typeof VALID_PICKUP_METHODS)[number]

const VALID_CHANNELS = ['PICKUP', 'DELIVERY'] as const
type OrderChannel = (typeof VALID_CHANNELS)[number]

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DELIVERY_ENABLED = process.env.ENABLE_MOBILE_DELIVERY === 'true'
const LOYALTY_ENABLED = process.env.ENABLE_MOBILE_LOYALTY === 'true'
const POINTS_PER_DOLLAR = 1

interface OrderItemInput {
  guid: string
  name?: string
  qty: number
  price?: number
  modifiers?: Array<{
    guid: string
    optionGroupGuid?: string
    name?: string
    price?: number
  }>
  recipientName?: string
  specialInstructions?: string
}

interface DeliveryAddressInput {
  street: string
  aptSuite?: string
  city: string
  state: string
  zipCode: string
  latitude: number
  longitude: number
  deliveryInstructions?: string
}

interface CreateOrderBody {
  storeId: number
  quoteId: string
  channel?: OrderChannel
  pickupMethod: PickupMethod
  curbsideStall?: string
  deliveryAddress?: DeliveryAddressInput
  items: OrderItemInput[]
  tipAmount?: number
  paymentIntentId?: string
  idempotencyKey?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await getAuthUser(request)
    if (!isAuthSuccess(authUser)) {
      return jsonError(authUser.error || 'No autorizado — inicia sesión para continuar', 401)
    }

    // Verificar que el perfil exista en app_users sin inventar teléfonos falsos
    const { data: existingProfile } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('id', authUser.userId)
      .maybeSingle()

    if (!existingProfile) {
      return jsonError(
        'Perfil de usuario no encontrado. Por favor inicia sesión nuevamente.',
        403
      )
    }

    const body = (await request.json()) as CreateOrderBody
    const {
      storeId,
      quoteId,
      channel = 'PICKUP',
      pickupMethod,
      curbsideStall,
      deliveryAddress,
      items,
      tipAmount = 0,
      paymentIntentId,
      idempotencyKey,
    } = body

    if (!storeId || typeof storeId !== 'number') {
      return jsonError('storeId numérico es requerido', 400)
    }

    if (!quoteId || !UUID_REGEX.test(quoteId)) {
      return jsonError(
        'quoteId válido es obligatorio para crear una orden',
        400
      )
    }

    if (!VALID_CHANNELS.includes(channel)) {
      return jsonError(
        `channel inválido. Opciones válidas: ${VALID_CHANNELS.join(', ')}`,
        400
      )
    }

    if (channel === 'DELIVERY' && !DELIVERY_ENABLED) {
      return jsonError(
        'El servicio de Delivery nativo se encuentra temporalmente deshabilitado hasta confirmar la configuración contractual oficial con Toast / DoorDash.',
        409
      )
    }

    if (!pickupMethod || !VALID_PICKUP_METHODS.includes(pickupMethod)) {
      return jsonError(
        `pickupMethod inválido. Opciones válidas: ${VALID_PICKUP_METHODS.join(', ')}`,
        400
      )
    }

    if (
      channel === 'PICKUP' &&
      pickupMethod === 'curbside' &&
      (!curbsideStall || curbsideStall.trim() === '')
    ) {
      return jsonError(
        'curbsideStall es requerido cuando pickupMethod es "curbside"',
        400
      )
    }

    if (!Array.isArray(items) || items.length === 0) {
      return jsonError('La orden debe contener al menos un artículo', 400)
    }

    // 1. Verificar proveedor de pago activo
    const paymentProvider = getActivePaymentProvider()
    if (!paymentProvider.isEnabled) {
      return NextResponse.json(
        {
          ok: false,
          code: 'PAYMENT_PROVIDER_DISABLED',
          error:
            'El procesamiento de pagos nativo aún no está habilitado hasta completar la certificación del mecanismo oficial de cobro con Toast POS.',
          retryable: false,
        },
        { status: 503 }
      )
    }

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return jsonError(
        'paymentIntentId autorizado es obligatorio para crear una orden',
        402
      )
    }

    // 2. Cargar y validar la cotización autoritativa (app_quotes)
    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('app_quotes')
      .select('*')
      .eq('id', quoteId)
      .eq('store_id', storeId)
      .single()

    if (quoteErr || !quote) {
      return jsonError('La cotización indicada no existe o no es válida', 404)
    }

    if (quote.status !== 'OPEN') {
      return jsonError(
        `La cotización ya fue utilizada o expiró (status: ${quote.status})`,
        409
      )
    }

    if (quote.price_source !== 'toast_prices') {
      return jsonError(
        'La cotización no proviene de una fuente autoritativa de Toast POS (/prices). No se permite crear órdenes con cálculos locales.',
        409
      )
    }

    if (quote.user_id && quote.user_id !== authUser.userId) {
      return jsonError('Esta cotización pertenece a otro usuario', 403)
    }

    if (quote.channel !== channel) {
      return jsonError(
        'El canal solicitado no coincide con la cotización autoritativa.',
        409
      )
    }

    if (new Date(quote.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from('app_quotes')
        .update({ status: 'EXPIRED' })
        .eq('id', quoteId)
      return jsonError(
        'La cotización ha expirado. Por favor actualiza tu carrito.',
        409
      )
    }

    // 3. Verificar integridad criptográfica (cart_hash)
    const sanitizedTip = Math.max(0, Math.round(Number(tipAmount || 0) * 100) / 100)
    const calculatedCartHash = computeCartHash({
      storeId,
      channel,
      items: items.map((i) => ({
        guid: i.guid,
        qty: i.qty,
        modifiers: (i.modifiers || []).map((m) => ({
          guid: m.guid,
          optionGroupGuid: m.optionGroupGuid,
        })),
      })),
      tipAmount: sanitizedTip,
      zipCode:
        channel === 'DELIVERY'
          ? deliveryAddress?.zipCode || quote.delivery_address?.zipCode
          : null,
    })

    if (calculatedCartHash !== quote.cart_hash) {
      return jsonError(
        'El carrito o propina cambió desde que se emitió la cotización. Solicita una nueva cotización.',
        409
      )
    }

    // 4. Confirmar autorización del pago con el proveedor activo
    const paymentVerification = await paymentProvider.authorize({
      quoteId,
      expectedAmountCents: Math.round(Number(quote.total_amount) * 100),
      currency: 'USD',
      orderExternalId: `order-quote-${quoteId}`,
      userId: authUser.userId,
      paymentToken: paymentIntentId,
    })

    if (
      !paymentVerification.success ||
      (paymentVerification.status !== 'PAID' &&
        paymentVerification.status !== 'AUTHORIZED')
    ) {
      return jsonError(
        paymentVerification.errorMessage ||
          'El pago no se encuentra autorizado ni confirmado.',
        402
      )
    }

    const paymentStatus: NativePaymentFinancialStatus =
      paymentVerification.status

    // 5. Construir snapshot de artículos EXCLUSIVAMENTE desde quote.items_json (nunca de body.items)
    const quotedItems = Array.isArray(quote.items_json) ? quote.items_json : []
    const itemsJson = quotedItems.map(
      (qItem: {
        guid: string
        name: string
        qty: number
        basePrice?: number
        unitPrice: number
        lineTotal: number
        modifiers?: Array<{
          guid: string
          optionGroupGuid?: string
          name: string
          price: number
        }>
        specialInstructions?: string
      }) => ({
        guid: qItem.guid,
        name: qItem.name,
        qty: Number(qItem.qty),
        unitPrice: Number(qItem.unitPrice),
        totalPrice: Number(qItem.lineTotal),
        modifiers: Array.isArray(qItem.modifiers) ? qItem.modifiers : [],
        specialInstructions: qItem.specialInstructions,
      })
    )

    const netAmount = Number(quote.subtotal)
    const taxAmount = Number(quote.tax_amount)
    const deliveryFee = Number(quote.delivery_fee || 0)
    const finalTipAmount = Number(quote.tip_amount)
    const discountAmount = Number(quote.discount_amount || 0)
    const totalAmount = Number(quote.total_amount)

    const orderExternalId = idempotencyKey || `order:${quoteId}`
    const snapshotPayload = {
      items: itemsJson,
      channel,
      quoteId,
      deliveryFee,
      deliveryAddress:
        channel === 'DELIVERY'
          ? deliveryAddress || quote.delivery_address
          : null,
      toastExternalIds: {
        orderExternalId,
        checkExternalId: `${orderExternalId}:check:0`,
      },
    }

    // 6. Ejecutar RPC atómico en PostgreSQL (17 parámetros canónicos de app_order_create_transaction)
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      'app_order_create_transaction',
      {
        p_user_id: authUser.userId,
        p_store_id: storeId,
        p_quote_id: quoteId,
        p_cart_hash: calculatedCartHash,
        p_channel: channel,
        p_pickup_method: pickupMethod,
        p_curbside_stall:
          pickupMethod === 'curbside'
            ? (curbsideStall?.trim() || '').slice(0, 20) || null
            : null,
        p_items_json: snapshotPayload,
        p_total_amount: totalAmount,
        p_net_amount: netAmount,
        p_tax_amount: taxAmount,
        p_discount_amount: discountAmount,
        p_payment_status: paymentStatus,
        p_payment_intent_id: paymentIntentId,
        p_user_latitude: deliveryAddress?.latitude ?? null,
        p_user_longitude: deliveryAddress?.longitude ?? null,
        p_eta_minutes: 15,
      }
    )

    if (rpcError || !rpcResult) {
      console.error('❌ [mobile/order/create] Error en RPC atómico:', rpcError?.message)
      return jsonError(
        rpcError?.message || 'Error transaccional al procesar la orden',
        409
      )
    }

    const createdOrderId = (rpcResult.order_id || rpcResult.orderId) as string
    const finalStatus = rpcResult.status as string

    // 7. Puntos de lealtad (solo si el feature flag ENABLE_MOBILE_LOYALTY === 'true' está activo)
    let pointsEarned = 0
    if (LOYALTY_ENABLED && paymentStatus === 'PAID') {
      pointsEarned = Math.floor(netAmount * POINTS_PER_DOLLAR)
    }

    return jsonOk(
      {
        orderId: createdOrderId,
        quoteId,
        channel,
        status: finalStatus,
        paymentStatus,
        idempotentReplay: Boolean(rpcResult.idempotentReplay),
        financials: {
          subtotal: netAmount,
          taxAmount,
          deliveryFee,
          tipAmount: finalTipAmount,
          discountAmount,
          totalAmount,
        },
        pointsEarned,
      },
      rpcResult.idempotentReplay ? 200 : 201
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/order/create] Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
