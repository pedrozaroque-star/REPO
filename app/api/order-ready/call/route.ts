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

export const dynamic = 'force-dynamic'

interface CallOrderPayload {
  orderId?: string
  orderNumber: string
  storeCode: string
  diningOption?: string
  storeName?: string
  fromClientBroadcast?: boolean
}

export async function POST(request: Request) {
  try {
    const body: CallOrderPayload = await request.json()
    const { orderId, orderNumber, storeCode, diningOption, storeName, fromClientBroadcast } = body

    if (!orderNumber || !storeCode) {
      return NextResponse.json(
        { error: 'orderNumber y storeCode son obligatorios' },
        { status: 400 }
      )
    }

    const normalizedStoreCode = storeCode.toUpperCase()
    const nowIso = new Date().toISOString()

    // 1. Si existe orderId, actualizar el registro en Supabase para auditoría y trazabilidad
    if (orderId && !orderId.startsWith('temp-') && !orderId.startsWith('sim-')) {
      try {
        await supabaseAdmin
          .from('order_ready_announcements')
          .update({
            announced_at: nowIso
          })
          .eq('id', orderId)
      } catch (dbErr) {
        console.warn('Advertencia actualizando announced_at en DB:', dbErr)
      }
    }

    // 2. Si el cliente no transmitió directamente por WebSocket, emitir el broadcast desde el servidor
    if (!fromClientBroadcast) {
      try {
        await new Promise<void>((resolve) => {
          const channel = supabaseAdmin.channel('order-ready-realtime-srv')
          const timer = setTimeout(() => {
            supabaseAdmin.removeChannel(channel).catch(() => {})
            resolve()
          }, 2000)

          channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              try {
                await channel.send({
                  type: 'broadcast',
                  event: 'call_order',
                  payload: {
                    order_id: orderId,
                    order_number: String(orderNumber),
                    store_code: normalizedStoreCode,
                    dining_option: diningOption || 'TOGO',
                    store_name: storeName || normalizedStoreCode,
                    called_at: nowIso
                  }
                })
              } catch (e) {
                console.warn('Error sending broadcast:', e)
              } finally {
                clearTimeout(timer)
                await supabaseAdmin.removeChannel(channel).catch(() => {})
                resolve()
              }
            }
          })
        })
      } catch (realtimeErr) {
        console.warn('Advertencia emitiendo broadcast desde servidor:', realtimeErr)
      }
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
