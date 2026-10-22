/**
 * @module api/order-ready/call
 * @description API endpoint to receive call impulses from the Preparador kitchen tablet and broadcast them in real time to the Manager PC Order Ready Board.
 * 
 * @businessRules
 * - **Impulso de Llamada desde Tableta de Preparador**:
 *   - El entregador (expediter) en la línea de preparación puede tocar una orden en la pestaña "ÓRDENES" para pedirle al sistema que la anuncie o re-anuncie por los altavoces del restaurante.
 *   - El endpoint actualiza la marca de tiempo `announced_at` en `order_ready_announcements` en Supabase y emite un evento broadcast por el canal aislado de la sucursal `order-ready-realtime:${storeCode}`.
 *   - La PC del Manager (`/order-ready-board`) escucha el canal de su tienda y reproduce de inmediato la campanilla Ding-Dong y la voz natural del locutor bilingüe.
 * - **Aislamiento por Tienda**:
 *   - Cada impulso incluye `storeCode` (ej. 'LYNWOOD'), filtra las mutaciones por `store_code` y transmite exclusivamente al topic `realtime:order-ready-realtime:${storeCode}` para evitar eventos cruzados entre sucursales.
 * 
 * @dataFlow
 * - Tableta Preparador (/inventory/preparador) -> POST /api/order-ready/call -> Supabase DB + Supabase Realtime (channel 'order-ready-realtime:${storeCode}', event 'call_order') -> PC Manager (/order-ready-board)
 * 
 * @notes
 * - La tableta también envía un broadcast directo por WebSocket desde el navegador al canal de su tienda; este endpoint actúa como puente redundante y persistencia en base de datos.
 * - FIX (2026-10-22):
 *   1. Topic de broadcast aislado por tienda (`realtime:order-ready-realtime:${normalizedStoreCode}`).
 *   2. Aislamiento estricto por `store_code` al actualizar por `id`.
 *   3. Marca de tiempo `announced_at` monotónica (`getMonotonicIsoTimestamp`) para garantizar que dos llamadas rápidas en el mismo milisegundo persistan ambas actualizaciones sin ser suprimidas como no-op.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { STORE_GUID_BY_CODE } from '@/lib/order-ready-sync'

export const dynamic = 'force-dynamic'

let lastCallTimestampMs = 0

function getMonotonicIsoTimestamp(preferredIso?: string): string {
  const parsed = preferredIso ? Date.parse(preferredIso) : NaN
  const baseMs = Number.isFinite(parsed) ? parsed : Date.now()
  const nextMs = baseMs <= lastCallTimestampMs ? lastCallTimestampMs + 1 : baseMs
  lastCallTimestampMs = nextMs
  return new Date(nextMs).toISOString()
}

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
    const nowIso = getMonotonicIsoTimestamp(calledAt)
    const storeTopic = `realtime:order-ready-realtime:${normalizedStoreCode}`

    // 1. Actualizar el registro en Supabase para auditoría, trazabilidad y réplica DB (con aislamiento por store_code)
    let persistedRowId: string | null = null
    try {
      const isUuid = typeof orderId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
      if (isUuid) {
        const { data: updRow, error: updErr } = await supabaseAdmin
          .from('order_ready_announcements')
          .update({ announced_at: nowIso })
          .eq('id', orderId)
          .eq('store_code', normalizedStoreCode)
          .select('id')
          .maybeSingle()
        if (updErr) console.warn('Advertencia actualizando announced_at por UUID:', updErr.message)
        if (updRow?.id) persistedRowId = updRow.id
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
          const { data: updRow, error: updErr } = await supabaseAdmin
            .from('order_ready_announcements')
            .update({ announced_at: nowIso })
            .eq('id', latestRow.id)
            .eq('store_code', normalizedStoreCode)
            .select('id')
            .maybeSingle()
          if (updErr) console.warn('Advertencia actualizando announced_at por order_number:', updErr.message)
          if (updRow?.id) persistedRowId = updRow.id
        } else if (orderNumber === 'CAFE' || orderNumber === 'CHAMPURRADO') {
          const { data: insRow, error: insErr } = await supabaseAdmin
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
            .select('id')
            .maybeSingle()
          if (insErr) console.warn('Advertencia insertando registro centinela de bebida:', insErr.message)
          if (insRow?.id) persistedRowId = insRow.id
        }
      }
    } catch (dbErr) {
      console.warn('Advertencia actualizando announced_at en DB:', dbErr)
    }

    // 2. Redundancia de Servidor: Emitir SIEMPRE el broadcast por el canal aislado de la tienda vía HTTP REST API de Supabase Realtime.
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
                topic: storeTopic,
                event: 'call_order',
                payload: {
                  order_id: orderId || persistedRowId,
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
      storeCode: normalizedStoreCode,
      topic: storeTopic,
      announcedAt: nowIso,
      persistedRowId
    })
  } catch (err: any) {
    console.error('Error procesando llamada de orden desde preparador:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno al procesar el llamado' },
      { status: 500 }
    )
  }
}
