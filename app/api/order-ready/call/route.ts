/**
 * @module api/order-ready/call
 * @description API endpoint to receive call impulses from the Preparador kitchen tablet and broadcast them in real time to the Manager PC Order Ready Board.
 * 
 * @businessRules
 * - **Impulso de Llamada desde Tableta de Preparador**:
 *   - El entregador (expediter) en la línea de preparación puede tocar una orden en la pestaña "ÓRDENES" para pedirle al sistema que la anuncie o re-anuncie por los altavoces del restaurante.
 *   - El endpoint actualiza la marca de tiempo `announced_at` en `order_ready_announcements` en Supabase y emite un evento broadcast por el canal `order-ready-realtime`.
 *   - La PC del Manager (`/order-ready-board`) escucha este canal permanentemente y reproduce de inmediato la campanilla Ding-Dong y la voz natural del locutor bilingüe.
 * - **Aislamiento por Tienda**:
 *   - Cada impulso incluye `storeCode` (ej. 'LYNWOOD'). La PC del Manager solo reproduce los impulsos que coincidan con la tienda seleccionada en pantalla.
 * 
 * @dataFlow
 * - Tableta Preparador (/inventory/preparador) -> POST /api/order-ready/call -> Supabase DB + Supabase Realtime (channel 'order-ready-realtime', event 'call_order') -> PC Manager (/order-ready-board)
 * 
 * @notes
 * - La tableta también envía un broadcast directo por WebSocket desde el navegador; este endpoint actúa como puente redundante y persistencia en base de datos.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { STORE_GUID_BY_CODE } from '@/lib/order-ready-sync'

export const dynamic = 'force-dynamic'

interface CallOrderPayload {
  orderId?: string
  orderNumber: string
  storeCode: string
  diningOption?: string
  storeName?: string
  fromClientBroadcast?: boolean
  calledAt?: string
}

export async function POST(request: Request) {
  try {
    const body: CallOrderPayload = await request.json()
    const { orderId, orderNumber, storeCode, diningOption, storeName, calledAt } = body

    if (!orderNumber || !storeCode) {
      return NextResponse.json(
        { error: 'orderNumber y storeCode son obligatorios' },
        { status: 400 }
      )
    }

    const normalizedStoreCode = storeCode.toUpperCase()
    const nowIso = calledAt && !isNaN(Date.parse(calledAt)) ? new Date(calledAt).toISOString() : new Date().toISOString()

    // 1. Actualizar el registro en Supabase para auditoría, trazabilidad y réplica DB
    try {
      const isUuid = typeof orderId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
      if (isUuid) {
        const { error: updErr } = await supabaseAdmin
          .from('order_ready_announcements')
          .update({ announced_at: nowIso })
          .eq('id', orderId)
        if (updErr) console.warn('Advertencia actualizando announced_at por UUID:', updErr.message)
      } else {
        const { data: latestRow } = await supabaseAdmin
          .from('order_ready_announcements')
          .select('id')
          .eq('store_code', normalizedStoreCode)
          .eq('order_number', String(orderNumber))
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (latestRow?.id) {
          const { error: updErr } = await supabaseAdmin
            .from('order_ready_announcements')
            .update({ announced_at: nowIso })
            .eq('id', latestRow.id)
          if (updErr) console.warn('Advertencia actualizando announced_at por order_number:', updErr.message)
        } else if (orderNumber === 'CAFE' || orderNumber === 'CHAMPURRADO') {
          const { error: insErr } = await supabaseAdmin
            .from('order_ready_announcements')
            .insert({
              store_code: normalizedStoreCode,
              store_id: STORE_GUID_BY_CODE[normalizedStoreCode] || normalizedStoreCode,
              store_name: storeName || normalizedStoreCode,
              order_number: String(orderNumber),
              dining_option: 'TOGO',
              status: 'COMPLETED',
              announced: true,
              announced_at: nowIso,
              business_date: getCaliforniaBusinessDate()
            })
          if (insErr) console.warn('Advertencia insertando registro centinela de bebida:', insErr.message)
        }
      }
    } catch (dbErr) {
      console.warn('Advertencia actualizando announced_at en DB:', dbErr)
    }

    // 2. Redundancia de Servidor: Emitir SIEMPRE el broadcast por el canal 'order-ready-realtime' vía HTTP REST API de Supabase Realtime.
    // Usar el endpoint REST /realtime/v1/api/broadcast evita colisiones de WebSocket en el singleton supabaseAdmin
    // cuando el preparador toca 2 o 3 órdenes seguidas en menos de 1 segundo (ej. #700 y #701 con 0.5s de diferencia).
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
      if (supabaseUrl && serviceKey) {
        await fetch(`${supabaseUrl.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(2500),
          body: JSON.stringify({
            messages: [
              {
                topic: 'realtime:order-ready-realtime',
                event: 'call_order',
                payload: {
                  order_id: orderId,
                  order_number: String(orderNumber),
                  store_code: normalizedStoreCode,
                  dining_option: diningOption || 'TOGO',
                  store_name: storeName || normalizedStoreCode,
                  called_at: nowIso
                }
              }
            ]
          })
        })
      }
    } catch (realtimeErr) {
      console.warn('Advertencia emitiendo broadcast REST desde servidor:', realtimeErr)
    }

    return NextResponse.json({
      success: true,
      message: 'Impulso de llamado transmitido con éxito',
      orderNumber,
      storeCode: normalizedStoreCode
    })
  } catch (err: any) {
    console.error('Error procesando llamada de orden desde preparador:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno al procesar el llamado' },
      { status: 500 }
    )
  }
}
