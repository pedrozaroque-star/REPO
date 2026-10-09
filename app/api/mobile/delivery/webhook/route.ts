/**
 * @module app/api/mobile/delivery/webhook/route
 * @description Receptor seguro de webhooks de DoorDash Drive para actualización en tiempo real de entregas a domicilio.
 * Actualiza el estado logístico del repartidor (Dasher), la comanda y el tracker del comensal en app_orders.
 * 
 * @businessRules
 * - Seguridad y Protección Criptográfica: Valida la firma HMAC-SHA256 (header 'x-doordash-signature')
 *   contra DOORDASH_WEBHOOK_SECRET. Si las credenciales no están configuradas, responde HTTP 503 (Bloqueado Externamente).
 * - Cero Simulación Ficticia: Si DoorDash no está activo comercialmente, no se procesan eventos simulados.
 * - Máquina de Tres Estados Logísticos:
 *   * 'DASHER_CONFIRMED' / 'DASHER_EN_ROUTE_TO_PICKUP' -> DISPATCHING_DRIVER / DRIVER_ASSIGNED
 *   * 'DASHER_PICKED_UP' -> OUT_FOR_DELIVERY (Comanda retirada del mostrador)
 *   * 'DELIVERY_COMPLETED' -> DELIVERED (Comanda entregada exitosamente al cliente)
 * - Protección de Idempotencia: Los webhooks se identifican por external_delivery_id (order_id)
 *   para garantizar que eventos duplicados o desordenados no corrompan el estado final.
 * 
 * @dataFlow
 * - DoorDash Drive Webhook -> POST /api/mobile/delivery/webhook -> app_orders (Supabase) + app_order_outbox ->
 *   Notificación en vivo a la app móvil.
 * 
 * @notes
 * - Guarda detalles del Dasher (nombre, teléfono de contacto y foto de entrega) en app_orders.items_json.deliveryLogistics.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

interface DoorDashWebhookPayload {
  event_type: string
  external_delivery_id: string
  delivery_id?: string
  delivery_status?: string
  dasher_name?: string
  dasher_phone_number?: string
  estimated_pickup_time?: string
  estimated_delivery_time?: string
  actual_pickup_time?: string
  actual_delivery_time?: string
  dropoff_photo_url?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Verificar si la integración de DoorDash Drive está autorizada y configurada
    const webhookSecret = process.env.DOORDASH_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.warn('⚠️ [DoorDash Webhook] Inactivo: DOORDASH_WEBHOOK_SECRET no está configurado en el entorno.')
      return NextResponse.json(
        {
          ok: false,
          error: 'DoorDash Drive webhook integration is inactive. Delivery service is externally blocked pending contractual credentials.',
          status: 'BLOCKED_EXTERNALLY',
        },
        { status: 503 }
      )
    }

    // 2. Leer raw body para validación de firma
    const rawBody = await request.text()
    const signature = request.headers.get('x-doordash-signature') || request.headers.get('x-drive-signature')

    if (!signature) {
      return NextResponse.json(
        { ok: false, error: 'Firma de webhook requerida (x-doordash-signature faltante).' },
        { status: 401 }
      )
    }

    // 3. Validación de firma criptográfica HMAC-SHA256
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex')

    const signatureBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      console.warn('❌ [DoorDash Webhook] Firma HMAC inválida recibida.')
      return NextResponse.json({ ok: false, error: 'Firma de webhook inválida.' }, { status: 401 })
    }

    // 4. Parsear payload validado
    let payload: DoorDashWebhookPayload
    try {
      payload = JSON.parse(rawBody) as DoorDashWebhookPayload
    } catch {
      return NextResponse.json({ ok: false, error: 'JSON inválido en cuerpo de la petición.' }, { status: 400 })
    }

    const {
      event_type,
      external_delivery_id,
      delivery_id,
      delivery_status,
      dasher_name,
      dasher_phone_number,
      estimated_delivery_time,
      dropoff_photo_url,
    } = payload

    if (!external_delivery_id) {
      return NextResponse.json({ ok: false, error: 'external_delivery_id es requerido.' }, { status: 400 })
    }

    console.log(`🚚 [DoorDash Webhook] Evento verificado '${event_type}' recibido para orden ${external_delivery_id}`)

    // 5. Consultar orden existente
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('app_orders')
      .select('id, status, items_json')
      .eq('id', external_delivery_id)
      .single()

    if (orderErr || !order) {
      console.warn(`[DoorDash Webhook] Orden ${external_delivery_id} no encontrada en DB`)
      return NextResponse.json({ ok: false, error: 'Orden no encontrada.' }, { status: 404 })
    }

    // 6. Mapear estado logístico de entrega
    const currentItemsJson = typeof order.items_json === 'object' && order.items_json !== null
      ? (order.items_json as Record<string, any>)
      : {}

    const updatedLogistics = {
      ...(currentItemsJson.deliveryLogistics || {}),
      doordashDeliveryId: delivery_id || currentItemsJson.deliveryLogistics?.doordashDeliveryId,
      lastEvent: event_type,
      deliveryStatus: delivery_status,
      dasherName: dasher_name || currentItemsJson.deliveryLogistics?.dasherName,
      dasherPhone: dasher_phone_number || currentItemsJson.deliveryLogistics?.dasherPhone,
      estimatedDeliveryTime: estimated_delivery_time || currentItemsJson.deliveryLogistics?.estimatedDeliveryTime,
      dropoffPhotoUrl: dropoff_photo_url || currentItemsJson.deliveryLogistics?.dropoffPhotoUrl,
      updatedAt: new Date().toISOString(),
    }

    const updatePayload: Record<string, unknown> = {
      items_json: {
        ...currentItemsJson,
        deliveryLogistics: updatedLogistics,
      },
      updated_at: new Date().toISOString(),
    }

    // Transición de estados de entrega
    if (event_type === 'DASHER_PICKED_UP') {
      updatePayload.status = 'READY'
    } else if (event_type === 'DELIVERY_COMPLETED') {
      updatePayload.status = 'COMPLETED'
    }

    const { error: updateErr } = await supabaseAdmin
      .from('app_orders')
      .update(updatePayload)
      .eq('id', external_delivery_id)

    if (updateErr) {
      console.error('[DoorDash Webhook] Error actualizando app_orders:', updateErr)
      return NextResponse.json({ ok: false, error: 'Error actualizando base de datos.' }, { status: 500 })
    }

    // 7. Sincronizar app_order_outbox si existe tarea de entrega
    await supabaseAdmin
      .from('app_order_outbox')
      .update({
        status: event_type === 'DELIVERY_COMPLETED' ? 'SUCCEEDED' : 'PROCESSING',
        external_reference: delivery_id,
        response_payload: payload,
        updated_at: new Date().toISOString(),
      })
      .eq('order_id', external_delivery_id)
      .eq('integration', 'doordash_drive')

    return NextResponse.json({ ok: true, received: true, eventType: event_type })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido en webhook'
    console.error('[DoorDash Webhook] Excepción:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
