/**
 * @module api/order-ready/webhook
 * @description Toast POS Webhook receiver for real-time order fulfillment events (e.g. KDS expediter double-tap).
 * 
 * @businessRules
 * - **Trigger del KDS**: Cuando el expediter hace doble tap en una orden, Toast emite el webhook con `guestOrderStatus: READY_FOR_PICKUP`.
 * - **Filtro de Dining Options**: Identifica órdenes de mostrador / comer aquí ('FOR_HERE') y para llevar ('TOGO'). Descarta o etiqueta delivery ('DELIVERY') para control de audio.
 * - **Mapeo de Tiendas**: Traduce el `restaurantExternalId` de Toast al código de sucursal de Tacos Gavilan (ej. Lynwood, Bell, etc.).
 * 
 * @dataFlow
 * - Toast Webhook POST -> /api/order-ready/webhook -> Valida y procesa -> Upsert en Supabase (order_ready_announcements) -> Supabase Realtime -> Order Ready Board (Audio Announcer)
 * 
 * @notes
 * - Idempotente: procesa duplicados sin duplicar registros en base de datos.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Mapeo canónico de Toast GUID a nombre y código de tienda
const TOAST_STORE_MAP: Record<string, { code: string; name: string }> = {
  "80a1ec95-bc73-402e-8884-e5abbe9343e6": { code: "LYNWOOD", name: "Lynwood" },
  "acf15327-54c8-4da4-8d0d-3ac0544dc422": { code: "RIALTO", name: "Rialto" },
  "e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8": { code: "AZUSA", name: "Azusa" },
  "42ed15a6-106b-466a-9076-1e8f72451f6b": { code: "NORWALK", name: "Norwalk" },
  "b7f63b01-f089-4ad7-a346-afdb1803dc1a": { code: "DOWNEY", name: "Downey" },
  "475bc112-187d-4b9c-884d-1f6a041698ce": { code: "LABROADWY", name: "LA Broadway" },
  "a83901db-2431-4283-834e-9502a2ba4b3b": { code: "BELL", name: "Bell" },
  "5fbb58f5-283c-4ea4-9415-04100ee6978b": { code: "HOLLYWOOD", name: "Hollywood" },
  "47256ade-2cd4-4073-9632-84567ad9e2c8": { code: "HPARK", name: "Huntington Park" },
  "8685e942-3f07-403a-afb6-faec697cd2cb": { code: "LACENTRAL", name: "LA Central" },
  "3a803939-eb13-4def-a1a4-462df8e90623": { code: "LAPUENTE", name: "La Puente" },
  "3c2d8251-c43c-43b8-8306-387e0a4ed7c2": { code: "SANTAANA", name: "Santa Ana" },
  "9625621e-1b5e-48d7-87ae-7094fab5a4fd": { code: "SLAUSON", name: "Slauson" },
  "95866cfc-eeb8-4af9-9586-f78931e1ea04": { code: "SOUTHGATE", name: "South Gate" },
  "5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02": { code: "WCOVINA", name: "West Covina" }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()

    // Soporte para estructura Toast { details: { order, restaurantGuid } } o directo { order }
    const orderObj = payload.details?.order || payload.order || payload
    const restaurantId = payload.restaurantGuid || payload.details?.restaurantGuid || payload.restaurantId || payload.restaurantExternalId || payload.storeId
    const storeInfo = TOAST_STORE_MAP[restaurantId] || { code: 'LYNWOOD', name: 'Lynwood' }

    // El número de orden puede venir en varios formatos
    const orderNumber = orderObj.displayNumber || orderObj.orderNumber || payload.orderNumber || payload.displayNumber || payload.ticketNumber
    const orderGuid = orderObj.guid || payload.orderGuid || payload.guid
    const guestStatus = payload.guestOrderStatus || orderObj.fulfillmentStatus || payload.status || orderObj.approvalStatus

    if (!orderNumber && !orderGuid) {
      return NextResponse.json({ message: 'Payload recibido sin orderNumber ni orderGuid, ignorado' }, { status: 200 })
    }

    // Traducir estado de Toast a nuestro sistema
    let status: 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'IN_PROGRESS'
    if (guestStatus === 'READY_FOR_PICKUP' || guestStatus === 'READY' || guestStatus === 'FULFILLED') {
      status = 'READY'
    } else if (guestStatus === 'CLOSED' || guestStatus === 'COMPLETED') {
      status = 'COMPLETED'
    }

    // Traducir Dining Option
    const rawDining = (
      orderObj.diningOption?.name ||
      orderObj.diningOption ||
      payload.diningOption ||
      ''
    ).toString().toUpperCase()

    let diningOption = 'TOGO'
    if (rawDining.includes('HERE') || rawDining.includes('DINE')) {
      diningOption = 'FOR_HERE'
    } else if (rawDining.includes('UBER') || rawDining.includes('DOORDASH') || rawDining.includes('GRUBHUB') || rawDining.includes('DELIVERY')) {
      diningOption = 'DELIVERY'
    } else if (rawDining.includes('DRIVE')) {
      diningOption = 'DRIVE_THRU'
    }

    const customerName = orderObj.customer?.firstName || payload.customerName || null
    const finalOrderNumber = String(orderNumber || orderGuid?.slice(-4) || '---')

    const now = new Date().toISOString()

    // Buscar si ya existe la orden en Supabase
    const { data: existing } = await supabaseAdmin
      .from('order_ready_announcements')
      .select('id, status, announced')
      .eq('store_code', storeInfo.code)
      .eq('order_number', finalOrderNumber)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      const updateData: any = {
        status,
        dining_option: diningOption
      }
      if (status === 'READY' && existing.status !== 'READY') {
        updateData.ready_at = now
        updateData.announced = false // Activar anuncio de audio
      }
      if (customerName) {
        updateData.customer_name = customerName
      }

      await supabaseAdmin
        .from('order_ready_announcements')
        .update(updateData)
        .eq('id', existing.id)

      return NextResponse.json({ success: true, action: 'updated', orderNumber: finalOrderNumber })
    }

    // Insertar nuevo registro
    await supabaseAdmin.from('order_ready_announcements').insert({
      store_code: storeInfo.code,
      store_id: restaurantId || storeInfo.code,
      store_name: storeInfo.name,
      order_number: finalOrderNumber,
      order_guid: orderGuid,
      dining_option: diningOption,
      customer_name: customerName,
      status,
      announced: false,
      ready_at: status === 'READY' ? now : null
    })

    return NextResponse.json({ success: true, action: 'created', orderNumber: finalOrderNumber })
  } catch (err: any) {
    console.error('Error procesando webhook de Toast:', err)
    return NextResponse.json({ error: err.message || 'Webhook processing failed' }, { status: 500 })
  }
}
