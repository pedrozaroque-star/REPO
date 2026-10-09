/**
 * @module app/api/mobile/payment/stripe-webhook/route
 * @description Webhook autoritativo de recepción de eventos de cobro de Stripe para Tacos Gavilan Mobile.
 * Valida firmas criptográficas HMAC-SHA256 y reconcilia idempotentemente los pagos contra app_orders y app_payment_events.
 * 
 * @businessRules
 * - Integridad Financiera y Cero Falso Éxito: Solo se marca una orden como 'PAID' tras verificar la firma HMAC
 *   oficial emitida por Stripe con STRIPE_WEBHOOK_SECRET.
 * - Bloqueo Externo Honesto: Si STRIPE_WEBHOOK_SECRET no está configurado en producción, responde HTTP 503
 *   declarando explícitamente 'BLOCKED_EXTERNALLY'.
 * - Idempotencia Estricta: Cada event_id de Stripe se registra en public.app_payment_events. Eventos repetidos se
 *   identifican de inmediato y responden HTTP 200 sin duplicar cobros ni puntos de lealtad.
 * - Despacho Seguro a Cocina: Al confirmarse el pago bancario, habilita la inyección de la comanda al KDS de Toast.
 * 
 * @dataFlow
 * - Stripe Servers POST /api/mobile/payment/stripe-webhook -> HMAC Verification -> app_payment_events + app_orders (PAID) -> Toast KDS outbox.
 * 
 * @notes
 * - Utiliza criptografía nativa de Node.js (crypto.timingSafeEqual y createHmac) sin depender de librerías externas.
 * - Tolerancia de tiempo de 300 segundos para prevenir ataques de replay.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const TIMESTAMP_TOLERANCE_SECONDS = 300

interface StripeEvent {
  id: string
  type: string
  created: number
  data: {
    object: Record<string, any>
  }
}

/**
 * Valida la firma del webhook de Stripe (v1) usando HMAC-SHA256 con protección contra ataques de tiempo.
 */
export function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string
): { valid: boolean; error?: string } {
  try {
    const parts = sigHeader.split(',')
    let timestamp: string | undefined
    const signatures: string[] = []

    for (const part of parts) {
      const [key, val] = part.trim().split('=')
      if (key === 't') timestamp = val
      if (key === 'v1') signatures.push(val)
    }

    if (!timestamp || signatures.length === 0) {
      return { valid: false, error: 'Cabecera stripe-signature malformada' }
    }

    // Validar tolerancia de timestamp para prevenir replay attacks
    const eventTime = parseInt(timestamp, 10)
    const currentTime = Math.floor(Date.now() / 1000)
    if (Math.abs(currentTime - eventTime) > TIMESTAMP_TOLERANCE_SECONDS) {
      return { valid: false, error: `Timestamp fuera de tolerancia (${currentTime - eventTime}s)` }
    }

    const signedPayload = `${timestamp}.${rawBody}`
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex')

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8')

    // Validar contra cualquiera de las firmas v1 presentes en la cabecera
    const match = signatures.some((sig) => {
      const sigBuffer = Buffer.from(sig, 'utf8')
      return sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    })

    if (!match) {
      return { valid: false, error: 'Firma HMAC-SHA256 no coincide' }
    }

    return { valid: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado verificando firma'
    return { valid: false, error: msg }
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  // 1. Guardia de disponibilidad externa honesta
  if (!webhookSecret) {
    console.warn('⚠️ [STRIPE WEBHOOK] Inactivo: STRIPE_WEBHOOK_SECRET no está configurado.')
    return NextResponse.json(
      {
        ok: false,
        error: 'El webhook de Stripe está deshabilitado en este entorno (STRIPE_WEBHOOK_SECRET ausente).',
        code: 'BLOCKED_EXTERNALLY',
      },
      { status: 503 }
    )
  }

  // 2. Extraer firma y cuerpo crudo
  const sigHeader = request.headers.get('stripe-signature')
  if (!sigHeader) {
    return NextResponse.json(
      { ok: false, error: 'Cabecera stripe-signature faltante.' },
      { status: 400 }
    )
  }

  const rawBody = await request.text()
  const verification = verifyStripeSignature(rawBody, sigHeader, webhookSecret)

  if (!verification.valid) {
    console.warn('❌ [STRIPE WEBHOOK] Firma rechazada:', verification.error)
    return NextResponse.json(
      { ok: false, error: `Firma inválida: ${verification.error}` },
      { status: 401 }
    )
  }

  // 3. Parsear el evento verificado
  let event: StripeEvent
  try {
    event = JSON.parse(rawBody) as StripeEvent
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON malformado en webhook.' }, { status: 400 })
  }

  const eventId = event.id
  const eventType = event.type
  const eventObject = event.data.object

  // 4. Verificación de Idempotencia en public.app_payment_events
  const { data: existingEvent } = await supabaseAdmin
    .from('app_payment_events')
    .select('id, processed')
    .eq('event_id', eventId)
    .maybeSingle()

  if (existingEvent?.processed) {
    console.log(`ℹ️ [STRIPE WEBHOOK] Evento ${eventId} ya fue procesado previamente. Retornando 200 OK.`)
    return NextResponse.json({ ok: true, duplicate: true, received: true, eventId })
  }

  const now = new Date().toISOString()

  // 5. Procesamiento por tipo de evento
  try {
    if (eventType === 'payment_intent.succeeded') {
      const paymentIntentId = eventObject.id
      const amountCents = Number(eventObject.amount)
      const currency = String(eventObject.currency || 'usd').toLowerCase()
      const quoteId = eventObject.metadata?.quote_id || null
      const customerId = eventObject.metadata?.customer_id || null
      const metaCartHash = eventObject.metadata?.cart_hash || null

      console.log(`💰 [STRIPE WEBHOOK] Procesando cobro bancario PI ${paymentIntentId} ($${(amountCents / 100).toFixed(2)})`)

      // Reconciliación financiera estricta contra cotización autoritativa
      let validQuoteId: string | null = null
      let financialMismatch: string | null = null

      if (quoteId) {
        const { data: qCheck } = await supabaseAdmin
          .from('app_quotes')
          .select('id, total_amount, currency, user_id, cart_hash')
          .eq('id', quoteId)
          .maybeSingle()

        if (qCheck) {
          validQuoteId = qCheck.id
          const expectedCents = Math.round(Number(qCheck.total_amount) * 100)
          const expectedCurrency = (qCheck.currency || 'usd').toLowerCase()

          if (amountCents !== expectedCents) {
            financialMismatch = `Discrepancia de monto: recibido ${amountCents}¢, cotizado ${expectedCents}¢`
          } else if (currency !== expectedCurrency) {
            financialMismatch = `Discrepancia de divisa: recibida ${currency}, cotizada ${expectedCurrency}`
          } else if (qCheck.user_id && customerId && qCheck.user_id !== customerId) {
            financialMismatch = `Discrepancia de comensal: cotizado ${qCheck.user_id}, metadata ${customerId}`
          } else if (metaCartHash && qCheck.cart_hash !== metaCartHash) {
            financialMismatch = `Discrepancia de hash de carrito: cotizado ${qCheck.cart_hash}, metadata ${metaCartHash}`
          }
        } else {
          financialMismatch = `Cotización ${quoteId} no encontrada en app_quotes`
        }
      }

      if (financialMismatch) {
        console.error(`🚨 [STRIPE WEBHOOK] ALERTA DE SEGURIDAD EN PI ${paymentIntentId}: ${financialMismatch}`)
        // Registrar en libro de pagos con estatus de discrepancia para auditoría
        await supabaseAdmin.from('app_payment_events').upsert({
          event_id: eventId,
          event_type: eventType,
          provider: 'stripe',
          payment_intent_id: paymentIntentId,
          quote_id: validQuoteId,
          amount_cents: amountCents,
          currency,
          status: 'mismatch_flagged',
          error_message: financialMismatch,
          payload: eventObject,
          processed: true,
          created_at: now,
        }, { onConflict: 'event_id' })

        return NextResponse.json({ ok: false, error: financialMismatch, flagged: true }, { status: 422 })
      }

      // Buscar si ya existe la orden asociada por payment_intent_id o quote_id
      let orderId: string | null = null
      const { data: matchedOrder } = await supabaseAdmin
        .from('app_orders')
        .select('id, payment_status, status, store_id, items_json')
        .or(`payment_intent_id.eq.${paymentIntentId}${validQuoteId ? `,quote_id.eq.${validQuoteId}` : ''}`)
        .maybeSingle()

      if (matchedOrder) {
        orderId = matchedOrder.id
        // Actualizar payment_status a PAID si estaba en PENDING tras reconciliación exitosa
        if (matchedOrder.payment_status !== 'PAID') {
          await supabaseAdmin
            .from('app_orders')
            .update({
              payment_status: 'PAID',
              payment_intent_id: paymentIntentId,
              updated_at: now,
            })
            .eq('id', matchedOrder.id)

          // Insertar en app_order_outbox para Toast KDS exclusivamente cuando el pago es PAID
          await supabaseAdmin.from('app_order_outbox').insert({
            order_id: matchedOrder.id,
            integration: 'toast_kds',
            idempotency_key: `toast:${matchedOrder.id}`,
            status: 'PENDING',
            request_payload: {
              orderId: matchedOrder.id,
              storeId: matchedOrder.store_id,
              items: matchedOrder.items_json?.items || [],
            }
          })
        }
      }

      // Registrar evento en el libro de pagos inmutable verificado
      const { error: upsertErr } = await supabaseAdmin.from('app_payment_events').upsert({
        event_id: eventId,
        event_type: eventType,
        provider: 'stripe',
        payment_intent_id: paymentIntentId,
        quote_id: validQuoteId,
        order_id: orderId,
        amount_cents: amountCents,
        currency,
        status: 'succeeded',
        payload: eventObject,
        processed: true,
        created_at: now,
      }, { onConflict: 'event_id' })

      if (upsertErr) {
        console.error('❌ [STRIPE WEBHOOK] Error guardando app_payment_events:', upsertErr)
      }

    } else if (eventType === 'payment_intent.payment_failed') {
      const paymentIntentId = eventObject.id
      const amountCents = eventObject.amount || 0
      const quoteId = eventObject.metadata?.quote_id || null
      const failureMessage = eventObject.last_payment_error?.message || 'Fallo desconocido en el cargo'

      console.warn(`❌ [STRIPE WEBHOOK] Pago fallido para PI ${paymentIntentId}: ${failureMessage}`)

      let orderId: string | null = null
      const { data: matchedOrder } = await supabaseAdmin
        .from('app_orders')
        .select('id')
        .or(`payment_intent_id.eq.${paymentIntentId}${quoteId ? `,quote_id.eq.${quoteId}` : ''}`)
        .maybeSingle()

      if (matchedOrder) {
        orderId = matchedOrder.id
        await supabaseAdmin
          .from('app_orders')
          .update({
            payment_status: 'FAILED',
            updated_at: now,
          })
          .eq('id', matchedOrder.id)
      }

      let validQuoteId: string | null = null
      if (quoteId) {
        const { data: qCheck } = await supabaseAdmin.from('app_quotes').select('id').eq('id', quoteId).maybeSingle()
        if (qCheck) validQuoteId = qCheck.id
      }

      await supabaseAdmin.from('app_payment_events').upsert({
        event_id: eventId,
        event_type: eventType,
        provider: 'stripe',
        payment_intent_id: paymentIntentId,
        quote_id: validQuoteId,
        order_id: orderId,
        amount_cents: amountCents,
        currency: eventObject.currency || 'usd',
        status: 'failed',
        error_message: failureMessage,
        payload: eventObject,
        processed: true,
        created_at: now,
      }, { onConflict: 'event_id' })

    } else if (eventType === 'charge.refunded') {
      const paymentIntentId = eventObject.payment_intent
      const amountRefundedCents = eventObject.amount_refunded || 0

      console.log(`↩️ [STRIPE WEBHOOK] Reembolso procesado para PI ${paymentIntentId}: $${(amountRefundedCents / 100).toFixed(2)}`)

      let orderId: string | null = null
      const { data: matchedOrder } = await supabaseAdmin
        .from('app_orders')
        .select('id')
        .eq('payment_intent_id', paymentIntentId)
        .maybeSingle()

      if (matchedOrder) {
        orderId = matchedOrder.id
        await supabaseAdmin
          .from('app_orders')
          .update({
            payment_status: 'REFUNDED',
            updated_at: now,
          })
          .eq('id', matchedOrder.id)
      }

      await supabaseAdmin.from('app_payment_events').upsert({
        event_id: eventId,
        event_type: eventType,
        provider: 'stripe',
        payment_intent_id: paymentIntentId || `ref_${eventId}`,
        order_id: orderId,
        amount_cents: amountRefundedCents,
        currency: eventObject.currency || 'usd',
        status: 'refunded',
        payload: eventObject,
        processed: true,
        created_at: now,
      }, { onConflict: 'event_id' })
    }

    return NextResponse.json({
      ok: true,
      received: true,
      eventId,
      eventType,
    })
  } catch (procErr: unknown) {
    const msg = procErr instanceof Error ? procErr.message : 'Error procesando webhook'
    console.error('❌ [STRIPE WEBHOOK] Error interno:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
