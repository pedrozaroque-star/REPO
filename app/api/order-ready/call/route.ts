/**
 * @module api/order-ready/call
 * @description API endpoint to receive call impulses from the Preparador kitchen tablet (manual tap) or the Smart Adaptive Auto-Timer,
 * and broadcast them in real time to the Manager PC Order Ready Board.
 * 
 * @businessRules
 * - **Impulso Manual desde Tableta de Preparador**:
 *   - El entregador (expediter) en la línea de preparación puede tocar una orden en la pestaña "ÓRDENES" para pedirle al sistema que la anuncie o re-anuncie por los altavoces del restaurante.
 *   - El endpoint actualiza la marca de tiempo `announced_at` en `order_ready_announcements` en Supabase y emite un evento broadcast por el canal aislado de la sucursal `order-ready-realtime:${storeCode}`.
 * - **Impulso Automático Manos Libres (`autoTimerOnlyIfUnannounced: true`)**:
 *   - Valida en servidor que la sucursal tenga activo el modo `'smart'` en `order_ready_settings` (`auto_call_timer_config`).
 *   - Sincroniza preventivamente contra Toast KDS (`syncStoreFromToast`, timeout 2.5s) para detectar cierres (bumps) de último segundo.
 *   - Ejecuta un `UPDATE` atómico condicional (`WHERE id = ... AND store_code = ... AND status = 'IN_PROGRESS' AND announced_at IS NULL`):
 *     si la orden ya fue entregada/cerrada en KDS o ya fue llamada manual/automáticamente, omite el broadcast (`skippedAutoTimer: true`), garantizando cero anuncios de órdenes entregadas y cero duplicados entre pestañas.
 * - **Aislamiento por Tienda**:
 *   - Cada impulso incluye `storeCode` (ej. 'SLAUSON'), filtra las mutaciones por `store_code` y transmite exclusivamente al topic `realtime:order-ready-realtime:${storeCode}` para evitar eventos cruzados entre sucursales.
 * 
 * @dataFlow
 * - Tableta Preparador (/inventory/preparador) o Smart Timer (/order-ready-board) -> POST /api/order-ready/call -> Supabase DB + Supabase Realtime (channel 'order-ready-realtime:${storeCode}', event 'call_order') -> PC Manager (/order-ready-board)
 * 
 * @notes
 * - La tableta también envía un broadcast directo por WebSocket desde el navegador al canal de su tienda; este endpoint actúa como puente redundante y persistencia en base de datos.
 * - FIX (2026-10-22):
 *   1. Topic de broadcast aislado por tienda (`realtime:order-ready-realtime:${normalizedStoreCode}`).
 *   2. Aislamiento estricto por `store_code` al actualizar por `id`.
 *   3. Marca de tiempo `announced_at` monotónica (`getMonotonicIsoTimestamp`) para garantizar que dos llamadas rápidas en el mismo milisegundo persistan ambas actualizaciones sin ser suprimidas como no-op.
 * - SMART AUTO-TIMER GUARD (2026-11-10):
 *   Candado atómico PostgreSQL (`status = 'IN_PROGRESS' AND announced_at IS NULL`) + verificación de modo `'smart'` por tienda en servidor.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { STORE_GUID_BY_CODE, syncStoreFromToast } from '@/lib/order-ready-sync'
import {
  DEFAULT_AUTO_CALL_TIMER_CONFIG,
  isStoreSmartAutoCallEnabled,
  sanitizeAutoCallTimerConfig
} from '@/lib/order-ready-auto-timer'

export const dynamic = 'force-dynamic'

let lastCallTimestampMs = 0

function getMonotonicIsoTimestamp(preferredIso?: string): string {
  const serverNow = Date.now()
  const parsed = preferredIso ? Date.parse(preferredIso) : NaN
  // Si el reloj local de la tableta está desfasado por más de 15 segundos respecto al servidor NTP,
  // usar el reloj autoritativo del servidor para que las Capas 3 y 4 (<45s) de la PC del Manager jamás descarten el llamado.
  const isClockAligned = Number.isFinite(parsed) && Math.abs(serverNow - parsed) <= 15000
  const baseMs = isClockAligned ? parsed : serverNow
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
  autoTimerOnlyIfUnannounced?: boolean
}

export async function POST(request: Request) {
  try {
    const body: CallOrderPayload = await request.json()
    const {
      orderId,
      orderNumber,
      storeCode,
      diningOption,
      storeName,
      calledAt,
      autoTimerOnlyIfUnannounced
    } = body

    if (!orderNumber || !storeCode) {
      return NextResponse.json(
        { error: 'orderNumber y storeCode son obligatorios' },
        { status: 400 }
      )
    }

    const normalizedStoreCode = storeCode.toUpperCase()
    const nowIso = getMonotonicIsoTimestamp(calledAt)
    const channelTopic = `order-ready-realtime:${normalizedStoreCode}`
    const storeTopic = `realtime:order-ready-realtime:${normalizedStoreCode}`

    // MODO AUTOMÁTICO MANOS LIBRES: Candado estricto de servidor + verificación de KDS + UPDATE atómico condicional
    if (autoTimerOnlyIfUnannounced) {
      // A. Verificar que la tienda tenga habilitado 'smart' en order_ready_settings (protege las 14 tiendas manuales)
      let autoConfig = DEFAULT_AUTO_CALL_TIMER_CONFIG
      try {
        const { data: cfgRow } = await supabaseAdmin
          .from('order_ready_settings')
          .select('updated_by')
          .eq('id', 'auto_call_timer_config')
          .maybeSingle()
        if (cfgRow?.updated_by) {
          autoConfig = sanitizeAutoCallTimerConfig(JSON.parse(cfgRow.updated_by))
        }
      } catch {
        autoConfig = DEFAULT_AUTO_CALL_TIMER_CONFIG
      }

      if (!isStoreSmartAutoCallEnabled(autoConfig, normalizedStoreCode)) {
        return NextResponse.json({
          success: true,
          skippedAutoTimer: true,
          reason: 'store_manual_mode',
          orderNumber,
          storeCode: normalizedStoreCode
        })
      }

      // B. Refresco rápido contra Toast KDS (máx 2.5s) para capturar cualquier bump ocurrido en los últimos segundos
      try {
        await Promise.race([
          syncStoreFromToast(normalizedStoreCode, false),
          new Promise((resolve) => setTimeout(resolve, 2500))
        ])
      } catch {
        // Ignorar errores transitorios de red Toast; el candado DB sigue protegiendo
      }

      // C. UPDATE atómico condicional: SOLO procede si sigue IN_PROGRESS y NUNCA ha sido anunciada (announced_at IS NULL)
      const isUuid =
        typeof orderId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)

      let targetId: string | null = isUuid ? orderId! : null
      if (!targetId) {
        const { data: candidate } = await supabaseAdmin
          .from('order_ready_announcements')
          .select('id')
          .eq('store_code', normalizedStoreCode)
          .eq('order_number', String(orderNumber))
          .eq('status', 'IN_PROGRESS')
          .is('announced_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        targetId = candidate?.id || null
      }

      if (!targetId) {
        return NextResponse.json({
          success: true,
          skippedAutoTimer: true,
          reason: 'not_in_progress_or_already_announced',
          orderNumber,
          storeCode: normalizedStoreCode
        })
      }

      const { data: atomicRow, error: atomicErr } = await supabaseAdmin
        .from('order_ready_announcements')
        .update({ announced_at: nowIso })
        .eq('id', targetId)
        .eq('store_code', normalizedStoreCode)
        .eq('status', 'IN_PROGRESS')
        .is('announced_at', null)
        .select('id, dining_option, store_name')
        .maybeSingle()

      if (atomicErr || !atomicRow?.id) {
        return NextResponse.json({
          success: true,
          skippedAutoTimer: true,
          reason: 'already_claimed_or_bumped',
          orderNumber,
          storeCode: normalizedStoreCode
        })
      }

      // D. Ganó la condición atómica: emitir broadcast único al canal aislado de la sucursal
      const resolvedDining = diningOption || atomicRow.dining_option || 'TOGO'
      const resolvedStoreName = storeName || atomicRow.store_name || normalizedStoreCode
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        if (supabaseUrl && serviceKey) {
          const broadcastPayload = {
            order_id: atomicRow.id,
            order_number: String(orderNumber),
            store_code: normalizedStoreCode,
            dining_option: resolvedDining,
            store_name: resolvedStoreName,
            called_at: nowIso,
            auto_timer: true
          }
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
                  topic: channelTopic,
                  event: 'call_order',
                  payload: broadcastPayload
                },
                {
                  topic: storeTopic,
                  event: 'call_order',
                  payload: broadcastPayload
                }
              ]
            })
          })
        }
      } catch (realtimeErr) {
        console.warn('Advertencia emitiendo broadcast REST de auto-timer:', realtimeErr)
      }

      return NextResponse.json({
        success: true,
        autoTriggered: true,
        skippedAutoTimer: false,
        message: 'Impulso automático inteligente transmitido con éxito',
        orderNumber,
        storeCode: normalizedStoreCode,
        topic: storeTopic,
        announcedAt: nowIso,
        persistedRowId: atomicRow.id
      })
    }

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
        } else if (orderNumber === 'CAFE' || orderNumber === 'CHAMPURRADO' || orderNumber === 'ORDEN_PENDIENTE') {
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
          if (insErr) console.warn('Advertencia insertando registro centinela de bebida/orden pendiente:', insErr.message)
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
        const broadcastPayload = {
          order_id: orderId || persistedRowId,
          order_number: String(orderNumber),
          store_code: normalizedStoreCode,
          dining_option: diningOption || 'TOGO',
          store_name: storeName || normalizedStoreCode,
          called_at: nowIso
        }
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
                topic: channelTopic,
                event: 'call_order',
                payload: broadcastPayload
              },
              {
                topic: storeTopic,
                event: 'call_order',
                payload: broadcastPayload
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
