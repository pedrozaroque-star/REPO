/**
 * @module api/mobile/order/payment-intent
 * @description Servidor de inicialización de cobros bancarios (Stripe PaymentIntents) para Tacos Gavilan Mobile.
 * Vincula el monto del cobro al total exacto emitido por el motor de cotización financiera autoritativa.
 * 
 * @businessRules
 * - Principio de Integridad Financiera: El monto a cobrar NUNCA lo fija la app del cliente; se valida estrictamente
 *   contra la cotización autorizada del servidor.
 * - Cero intents simulados: Si la pasarela bancaria no cuenta con llaves de producción (STRIPE_SECRET_KEY),
 *   el endpoint rechaza la transacción con un mensaje honesto y no genera identificadores falsos ('pi_mobile_xxx').
 * 
 * @dataFlow
 * - App Móvil POST /api/mobile/order/payment-intent -> Valida cotización -> Crea PaymentIntent en Stripe -> Retorna clientSecret.
 * 
 * @notes
 * - Devuelve HTTP 503 Service Unavailable cuando STRIPE_SECRET_KEY no está configurado, garantizando cero cobros ficticios o simulaciones.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError, getAuthUser, isAuthSuccess } from '../../_helpers'

export const dynamic = 'force-dynamic'

interface PaymentIntentBody {
  quoteId: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Validar autenticación
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    // 2. Parsear cuerpo de la petición (solo quoteId)
    let body: PaymentIntentBody
    try {
      body = (await request.json()) as PaymentIntentBody
    } catch {
      return jsonError('JSON inválido en el cuerpo de la petición.', 400)
    }

    const { quoteId } = body

    if (!quoteId || typeof quoteId !== 'string') {
      return jsonError('quoteId es requerido para generar la intención de pago.', 400)
    }

    // 3. Cargar la cotización autoritativa desde public.app_quotes
    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('app_quotes')
      .select('*')
      .eq('id', quoteId)
      .single()

    if (quoteErr || !quote) {
      return jsonError('Cotización no encontrada o inválida.', 404)
    }

    if (quote.status !== 'OPEN') {
      return jsonError(`La cotización ya no está disponible (estado: ${quote.status}). Por favor genere una nueva cotización.`, 400)
    }

    if (new Date(quote.expires_at) < new Date()) {
      // Marcar como expirada
      await supabaseAdmin.from('app_quotes').update({ status: 'EXPIRED' }).eq('id', quoteId)
      return jsonError('La cotización ha expirado. Por favor actualice su carrito para obtener precios y disponibilidad vigentes.', 400)
    }

    // Validar propiedad de la cotización si fue creada con usuario
    if (quote.user_id && quote.user_id !== authResult.userId) {
      return jsonError('La cotización pertenece a otro usuario.', 403)
    }

    // 4. Monto financiero autoritativo derivado exclusivamente del servidor
    const authoritativeAmountCents = Math.round(Number(quote.total_amount) * 100)
    if (!authoritativeAmountCents || authoritativeAmountCents <= 0) {
      return jsonError('El total de la cotización es inválido.', 400)
    }

    // 5. Verificar proveedor de pagos activo (desacoplado)
    const { getActivePaymentProvider } = await import('@/lib/mobile/payment-provider')
    const provider = getActivePaymentProvider()

    if (!provider.isEnabled) {
      return jsonError(
        'La captura de pago permanece deshabilitada hasta recibir el mecanismo autorizado por Toast y completar la evaluación de cumplimiento correspondiente.',
        503
      )
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

    if (!stripeSecretKey) {
      return jsonError(
        'La pasarela de pago bancario no está configurada actualmente en el servidor.',
        503
      )
    }

    // 6. Crear PaymentIntent directamente en Stripe REST API v1
    const stripeParams = new URLSearchParams()
    stripeParams.append('amount', String(authoritativeAmountCents))
    stripeParams.append('currency', 'usd')
    stripeParams.append('payment_method_types[]', 'card')
    stripeParams.append('metadata[quote_id]', quote.id)
    stripeParams.append('metadata[store_id]', String(quote.store_id))
    stripeParams.append('metadata[brand]', 'Tacos Gavilan')
    stripeParams.append('metadata[customer_id]', authResult.userId)
    stripeParams.append('metadata[cart_hash]', quote.cart_hash)
    stripeParams.append('metadata[channel]', quote.channel)

    const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: stripeParams.toString(),
    })

    if (!stripeRes.ok) {
      const stripeErr = await stripeRes.json()
      console.error('❌ [STRIPE ERROR]', stripeErr)
      return jsonError(
        `Error del procesador de pagos: ${stripeErr.error?.message || 'Fallo al inicializar cargo'}`,
        400
      )
    }

    const paymentIntent = await stripeRes.json()

    return jsonOk({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      publishableKey: stripePublishableKey || '',
      amount: authoritativeAmountCents / 100,
      currency: 'usd',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    console.error('❌ [PAYMENT INTENT] Excepción:', msg)
    return jsonError('Error interno del servidor al procesar la intención de pago.', 500)
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
