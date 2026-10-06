/**
 * @module api/order-ready/webhook
 * @description Toast POS Webhook receiver for real-time order fulfillment events (e.g. KDS expediter double-tap).
 * 
 * @businessRules
 * - **Trigger del KDS**: Toast NO emite webhook al hacer doble tap (verificado con datos reales); el cierre se detecta por polling en
 *   `lib/order-ready-sync.ts` desde GET /api/order-ready/orders. Este webhook `order_updated` registra la orden al instante (IN_PROGRESS)
 *   y, si el payload ya trae platillos READY, la clasifica con la misma lógica (`evaluateToastOrder`).
 * - **Filtro de Dining Options**: Identifica órdenes de mostrador / comer aquí ('FOR_HERE') y para llevar ('TOGO'). Descarta o etiqueta delivery ('DELIVERY') para control de audio.
 * - **Mapeo de Tiendas**: Traduce el `restaurantExternalId` de Toast al código de sucursal de Tacos Gavilan (ej. Lynwood, Bell, etc.).
 * 
 * @dataFlow
 * - Toast Webhook POST -> /api/order-ready/webhook -> Valida y procesa -> Upsert en Supabase (order_ready_announcements) -> Supabase Realtime -> Order Ready Board (Audio Announcer)
 * 
 * @notes
 * - Idempotente: procesa duplicados sin duplicar registros en base de datos.
 * - Nunca baja una orden de READY a IN_PROGRESS (carrera entre webhooks tardíos y el sync activo).
 * - `ready_at` usa la hora real del bump (modifiedDate de los platillos) para que el tablero anuncie en orden de cierre.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'
import { TOAST_STORE_MAP, evaluateToastOrder, classifyDiningName } from '@/lib/order-ready-sync'
import { getCaliforniaBusinessDate } from '@/lib/business-date'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const payload = await request.json()

    // Soporte para estructura Toast { details: { order, restaurantGuid } } o directo { order }
    const orderObj = payload.details?.order || payload.order || payload
    const restaurantId = payload.restaurantGuid || payload.details?.restaurantGuid || payload.restaurantId || payload.restaurantExternalId || payload.storeId
    const storeInfo = TOAST_STORE_MAP[restaurantId] || { code: 'LYNWOOD', name: 'Lynwood' }

    // El número de orden puede venir en varios formatos
    const orderNumber = orderObj.displayNumber || orderObj.orderNumber || payload.orderNumber || payload.displayNumber || payload.ticketNumber
    const orderGuid = payload.details?.orderGuid || payload.orderGuid || orderObj.guid || payload.guid
    const rawStatus = (payload.details?.guestOrderStatus || payload.guestOrderStatus || orderObj.fulfillmentStatus || payload.status || orderObj.approvalStatus || '').toString().toUpperCase()

    if (!orderNumber && !orderGuid) {
      return NextResponse.json({ message: 'Payload recibido sin orderNumber ni orderGuid, ignorado' }, { status: 200 })
    }

    // Estado: misma lógica que el sync activo (platillos con fulfillmentStatus READY = doble tap del KDS)
    const evaluation = evaluateToastOrder(orderObj)
    let status: 'IN_PROGRESS' | 'READY' | 'COMPLETED' = evaluation.status
    if (
      status === 'IN_PROGRESS' &&
      (rawStatus === 'READY_FOR_PICKUP' || rawStatus === 'READY' || rawStatus === 'FULFILLED')
    ) {
      status = 'READY'
    } else if (rawStatus === 'VOIDED') {
      status = 'COMPLETED'
    }

    // Traducir Dining Option
    const rawDining = (
      orderObj.diningOption?.name ||
      orderObj.diningOption ||
      payload.diningOption ||
      ''
    ).toString().toUpperCase()

    const diningOption = classifyDiningName(rawDining)

    let customerName = orderObj.customer?.firstName || payload.customerName || null
    const now = new Date().toISOString()

    // 1. Buscar si ya existe la orden en Supabase por order_guid (clave canónica de Toast)
    let existing: any = null
    if (orderGuid) {
      const { data: byGuid } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('id, status, announced, order_number, dining_option, customer_name, order_guid')
        .eq('order_guid', orderGuid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      existing = byGuid
    }

    const currentBusinessDate = getCaliforniaBusinessDate()

    // 2. Si no se encontró por GUID pero tenemos orderNumber, buscar por store_code + order_number + business_date
    if (!existing && orderNumber) {
      const { data: byNum } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('id, status, announced, order_number, dining_option, customer_name, order_guid')
        .eq('store_code', storeInfo.code)
        .eq('business_date', currentBusinessDate)
        .eq('order_number', String(orderNumber))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      existing = byNum
    }

    // Si ya existe la orden, actualizarla
    if (existing) {
      const updateData: any = {
        status: existing.status === 'READY' && status === 'IN_PROGRESS' ? 'READY' : status,
        ...(diningOption ? { dining_option: diningOption } : {})
      }
      if (status === 'READY' && existing.status !== 'READY') {
        updateData.ready_at = evaluation.readyAt || now
        updateData.announced = false // Activar campanilla y voz bilingüe
      }
      if (customerName) {
        updateData.customer_name = customerName
      }
      if (orderGuid && !existing.order_guid) {
        updateData.order_guid = orderGuid
      }

      await supabaseAdmin
        .from('order_ready_announcements')
        .update(updateData)
        .eq('id', existing.id)

      return NextResponse.json({ success: true, action: 'updated', orderNumber: existing.order_number, status })
    }

    // Si es orden nueva y no tenemos número de orden pero sí GUID, consultar a Toast API
    let finalOrderNumber = orderNumber ? String(orderNumber) : null
    let finalDiningOption = diningOption

    if (!finalOrderNumber && orderGuid && restaurantId) {
      try {
        const token = await getAuthToken()
        const res = await fetch(`${TOAST_API_HOST}/orders/v2/orders/${orderGuid}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Toast-Restaurant-External-ID': restaurantId
          }
        })
        if (res.ok) {
          const toastOrder = await res.json()
          if (toastOrder.displayNumber) {
            finalOrderNumber = String(toastOrder.displayNumber)
          }
          if (toastOrder.diningOption?.name) {
            finalDiningOption = classifyDiningName(toastOrder.diningOption.name)
          }
          if (toastOrder.customer?.firstName && !customerName) {
            customerName = toastOrder.customer.firstName
          }
        }
      } catch (err) {
        console.warn('Toast order fetch fallback error:', err)
      }
    }

    if (!finalOrderNumber) {
      finalOrderNumber = String(orderGuid?.slice(-4) || '---')
    }

    // Insertar nuevo registro en Supabase
    await supabaseAdmin.from('order_ready_announcements').insert({
      store_code: storeInfo.code,
      store_id: restaurantId || storeInfo.code,
      store_name: storeInfo.name,
      order_number: finalOrderNumber,
      order_guid: orderGuid || null,
      dining_option: finalDiningOption,
      customer_name: customerName,
      status,
      business_date: currentBusinessDate,
      announced: false,
      ready_at: status === 'READY' ? (evaluation.readyAt || now) : null
    })

    return NextResponse.json({ success: true, action: 'created', orderNumber: finalOrderNumber, status })
  } catch (err: any) {
    console.error('Error procesando webhook de Toast:', err)
    return NextResponse.json({ error: err.message || 'Webhook processing failed' }, { status: 500 })
  }
}
