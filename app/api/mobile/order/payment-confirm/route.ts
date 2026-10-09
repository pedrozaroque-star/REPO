/**
 * @module api/mobile/order/payment-confirm
 * @description Confirmación autoritativa de cobros bancarios (Stripe PaymentIntents) para Tacos Gavilan Mobile.
 * Ejecuta la captura y confirmación de la tarjeta con Stripe y reconcilia el resultado en el servidor.
 * 
 * @businessRules
 * - Validación estricta de propiedad: Solo el usuario propietario o una sesión válida puede confirmar su cotización.
 * - Validación contra cotización autoritativa: La cotización debe estar en estado 'OPEN' y vigente.
 * - Cero confirmaciones simuladas: Si STRIPE_SECRET_KEY no está configurada, responde HTTP 503 sin fingir cobro.
 * - Si Stripe aprueba el cobro, registra el evento en public.app_payment_events con status 'succeeded'.
 * 
 * @dataFlow
 * - App Móvil POST /api/mobile/order/payment-confirm -> Confirma PaymentIntent en Stripe -> Registra evento -> Retorna estado confirmado.
 * 
 * @notes
 * - Compatible con Stripe Test Cards (4242...) y tarjetas de producción sin requerir SDKs nativos pesados en Expo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError, getAuthUser, isAuthSuccess } from '../../_helpers'

export const dynamic = 'force-dynamic'

interface PaymentConfirmBody {
  paymentIntentId: string
  quoteId: string
  card?: {
    number: string
    expMonth: string | number
    expYear: string | number
    cvc: string
    postalCode?: string
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Validar autenticación
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    // 2. Parsear cuerpo de la petición
    let body: PaymentConfirmBody
    try {
      body = (await request.json()) as PaymentConfirmBody
    } catch {
      return jsonError('JSON inválido en el cuerpo de la petición.', 400)
    }

    const { paymentIntentId, quoteId, card } = body

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return jsonError('paymentIntentId es requerido.', 400)
    }

    if (!quoteId || typeof quoteId !== 'string') {
      return jsonError('quoteId es requerido.', 400)
    }

    // 3. Validar cotización en public.app_quotes
    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('app_quotes')
      .select('*')
      .eq('id', quoteId)
      .single()

    if (quoteErr || !quote) {
      return jsonError('Cotización autoritativa no encontrada.', 404)
    }

    if (quote.status !== 'OPEN') {
      return jsonError(`La cotización ya no está disponible (estado: ${quote.status}).`, 400)
    }

    if (new Date(quote.expires_at) < new Date()) {
      return jsonError('La cotización ha expirado. Por favor actualice su carrito.', 400)
    }

    // 4. Verificar configuración de Stripe
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    if (!stripeSecretKey) {
      return jsonError(
        'La pasarela de pago bancaria aún no está configurada con las credenciales de producción de Tacos Gavilan. Contacte al administrador para activar los cobros.',
        503
      )
    }

    // 5. Confirmar PaymentIntent en Stripe API
    const confirmParams = new URLSearchParams()

    if (card && card.number) {
      const cleanNumber = card.number.replace(/\s+/g, '')
      confirmParams.append('payment_method_data[type]', 'card')
      confirmParams.append('payment_method_data[card][number]', cleanNumber)
      confirmParams.append('payment_method_data[card][exp_month]', String(card.expMonth))
      confirmParams.append('payment_method_data[card][exp_year]', String(card.expYear))
      confirmParams.append('payment_method_data[card][cvc]', String(card.cvc))
      if (card.postalCode) {
        confirmParams.append('payment_method_data[billing_details][address][postal_code]', card.postalCode)
      }
    }

    const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: confirmParams.toString(),
    })

    const stripeData = await stripeRes.json()

    if (!stripeRes.ok) {
      console.warn('❌ [STRIPE CONFIRM DECLINED]', stripeData)
      const declineMessage =
        stripeData.error?.message ||
        stripeData.error?.decline_code ||
        'La tarjeta fue rechazada por el banco emisor.'
      return jsonError(`Pago no aprobado: ${declineMessage}`, 402)
    }

    if (stripeData.status !== 'succeeded') {
      return jsonError(`El pago requiere acción adicional del cliente (estado: ${stripeData.status}).`, 400)
    }

    // 6. Registrar evento exitoso en public.app_payment_events
    await supabaseAdmin.from('app_payment_events').upsert({
      stripe_event_id: `confirm_${paymentIntentId}_${Date.now()}`,
      event_type: 'payment_intent.succeeded',
      payment_intent_id: paymentIntentId,
      quote_id: quote.id,
      user_id: authResult.userId,
      amount_cents: stripeData.amount,
      currency: stripeData.currency,
      status: 'succeeded',
      processed: true,
      raw_payload: stripeData,
      created_at: new Date().toISOString(),
    })

    return jsonOk({
      confirmed: true,
      paymentIntentId,
      status: stripeData.status,
      amount: stripeData.amount / 100,
      currency: stripeData.currency,
      brand: stripeData.charges?.data?.[0]?.payment_method_details?.card?.brand || 'card',
      last4: stripeData.charges?.data?.[0]?.payment_method_details?.card?.last4 || '****',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    console.error('❌ [PAYMENT CONFIRM] Excepción:', msg)
    return jsonError('Error interno del servidor al confirmar el pago.', 500)
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
