/**
 * @module api/order-ready/orders
 * @description API endpoint for querying, creating, updating, and syncing active orders for the Order Ready Board and Voice Announcer.
 * 
 * @businessRules
 * - **Dining Options Filtering**: Clasifica las órdenes en 'FOR_HERE', 'TOGO', 'DELIVERY', y 'DRIVE_THRU'. Solo For Here y To Go activan anuncios por altavoz de forma predeterminada para evitar saturar el comedor con órdenes de delivery.
 * - **Persistencia y Estado**: Las órdenes en preparación se registran como 'IN_PROGRESS'. Al completarse en KDS o recibir evento de 'READY_FOR_PICKUP', pasan a 'READY' con `ready_at = now()` y `announced = false`.
 * - **Control de Anuncios**: El campo `announced` evita repetición de voz en las bocinas del restaurante.
 * - **Asignación de Tienda**: Soporta filtro por código de tienda (ej. 'LYNWOOD') o UUID externo de Toast.
 * 
 * @dataFlow
 * - Client / TV / Tablet (Realtime / Visual Poll) -> GET /api/order-ready/orders?storeCode=LYNWOOD&syncToast=false -> Solo lectura en Supabase (order_ready_announcements) -> Client Display
 * - Client / TV / Tablet (Sync Explícito KDS) -> GET /api/order-ready/orders?storeCode=LYNWOOD&syncToast=true -> syncStoreFromToast() + lectura en Supabase -> Client Display
 * - Client / POS / Webhook -> POST /api/order-ready/orders -> Inserta o actualiza orden -> Supabase Realtime -> Audio Announcer
 * 
 * @notes
 * - Soporta sincronización explícita con Toast API (/orders/v2/ordersBulk) únicamente cuando se solicita `syncToast=true` (o `forceToast=true`).
 * - FIX (2026-10-22):
 *   1. Separación estricta entre lectura de BD (`syncToast=false`) y sincronización Toast (`syncToast=true`) para romper el ciclo infinito Realtime -> fetch -> syncToast -> UPDATE -> Realtime.
 *   2. Manejo idempotente de actualizaciones no-op suprimidas por el trigger `trg_suppress_noop_order_ready_update` en `POST` y `PATCH` usando `.maybeSingle()` y recuperando la fila completa existente de BD sin devolver jamás errores 500/PGRST116 ni objetos sintéticos incompletos.
 * - FIX (2026-10-06): el doble tap del expediter NO genera webhook en Toast. El flujo explícito `syncToast=true` dispara `syncStoreFromToast()`
 *   (lib/order-ready-sync.ts, con lease distribuido y throttle 5 s por tienda) que lee `selections[].fulfillmentStatus` y marca READY con la hora real del bump.
 * - ACCESO POR TIENDA (2026-10-06): GET/POST/PATCH exigen sesión y validan la tienda con lib/order-ready-access.ts
 *   (admin = todas, supervisor = su alcance, manager/asistente = solo su tienda). 401 sin sesión, 403 fuera de alcance.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncStoreFromToast, STORE_GUID_BY_CODE, isDrinkOrDessertOnlyOrder, areOrderItemsSummariesEqual } from '@/lib/order-ready-sync'
import { getOrderReadyAccess, canAccessStore } from '@/lib/order-ready-access'
import { getCaliforniaBusinessDate, getBusinessDayStartMs, getCaliforniaShift } from '@/lib/business-date'

export const dynamic = 'force-dynamic'

interface OrderPayload {
  storeCode?: string
  storeId?: string
  storeName?: string
  orderNumber: string
  orderGuid?: string
  diningOption?: 'FOR_HERE' | 'TOGO' | 'DELIVERY' | 'DRIVE_THRU' | string
  customerName?: string
  status?: 'IN_PROGRESS' | 'READY' | 'COMPLETED'
  itemsSummary?: string
}

// GET: Consultar órdenes activas (en preparación y listas)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const storeCode = (searchParams.get('storeCode') || searchParams.get('store') || 'LYNWOOD').toUpperCase()
    const isIsolatedTestStore =
      process.env.ALLOW_ORDER_READY_TEST_DB === 'true' && storeCode.startsWith('CODEX_ORDER_READY_TEST')

    const access = await getOrderReadyAccess(request)
    if (access) {
      if (!canAccessStore(access, storeCode) && !isIsolatedTestStore) {
        return NextResponse.json({ error: 'Sin acceso a esta tienda' }, { status: 403 })
      }
    } else if (!STORE_GUID_BY_CODE[storeCode] && !isIsolatedTestStore) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const syncToast = searchParams.get('syncToast') === 'true'
    const forceToast = searchParams.get('forceToast') === 'true'
    const minutes = parseInt(searchParams.get('minutes') || '45', 10)

    // FASE 8: Separar lectura pura de BD (syncToast=false) del flujo explícito de sincronización Toast (syncToast=true).
    // Los callbacks de Realtime y reconexiones usan syncToast=false y NUNCA disparan llamadas a Toast.
    if (syncToast || forceToast) {
      await syncStoreFromToast(storeCode, forceToast)
    }

    const currentBusinessDate = getCaliforniaBusinessDate()
    const currentShift = getCaliforniaShift()
    const bDayStartMs = getBusinessDayStartMs()

    // El cutoff no debe retroceder antes del inicio de la jornada laboral de hoy (6:00 AM)
    const effectiveCutoff = new Date(Math.max(Date.now() - minutes * 60 * 1000, bDayStartMs)).toISOString()

    const fetchRows = () =>
      supabaseAdmin
        .from('order_ready_announcements')
        .select('*')
        .eq('store_code', storeCode)
        .eq('business_date', currentBusinessDate)
        .gte('created_at', effectiveCutoff)
        .in('status', ['IN_PROGRESS', 'READY'])
        .order('created_at', { ascending: false })

    const { data: orders, error } = await fetchRows()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Regla de Negocio Tacos Gavilan: El Order Ready Board es exclusivo para comedor (FOR_HERE) y para llevar (TOGO).
    // Se descartan por completo órdenes de Drive-Thru y Delivery de plataformas, así como registros centinela de bebidas (CAFE/CHAMPURRADO).
    const isAllowedDining = (o: any) =>
      (o.dining_option === 'FOR_HERE' || o.dining_option === 'TOGO') &&
      o.order_number !== 'CAFE' &&
      o.order_number !== 'CHAMPURRADO'
    const filteredOrders = (orders || []).filter(isAllowedDining)

    // Consultar TODOS los impulsos recientes (órdenes o Café/Champurrado de los últimos 45s) para Capa 4 de Redundancia (Polling Fallback),
    // garantizando que incluso si una orden tiene >45 min de creada o si syncStoreFromToast tardó >10s en la noche, el llamado nunca se pierda.
    const recentBeverageCutoff = new Date(Date.now() - 45000).toISOString()
    const { data: beverageCalls } = await supabaseAdmin
      .from('order_ready_announcements')
      .select('id, store_code, store_name, order_number, dining_option, announced_at')
      .eq('store_code', storeCode)
      .gte('announced_at', recentBeverageCutoff)

    // Regla de Negocio Tacos Gavilan: Las órdenes listas se retiran tras 20 minutos para mantener limpia la pantalla
    const nowMs = Date.now()
    const MAX_READY_AGE_MS = 20 * 60 * 1000 // 20 minutos
    const rawReady = (filteredOrders.filter(o => {
      if (o.status !== 'READY') return false
      const readyTime = o.ready_at ? Date.parse(o.ready_at) : Date.parse(o.created_at)
      return (nowMs - readyTime) <= MAX_READY_AGE_MS
    }) || []).sort(
      (a, b) => Date.parse(b.ready_at || b.created_at) - Date.parse(a.ready_at || a.created_at)
    )
    const rawInProgress = filteredOrders.filter(o => o.status === 'IN_PROGRESS') || []

    // Función de desduplicación por GUID y número de orden
    const dedupe = (list: any[]) => {
      const seenGuids = new Set<string>()
      const seenNums = new Set<string>()
      const res: any[] = []
      for (const item of list) {
        const guidKey = item.order_guid ? String(item.order_guid).trim() : null
        const numKey = `${item.store_code}_${item.business_date}_${item.order_number}`
        if (guidKey && seenGuids.has(guidKey)) continue
        if (seenNums.has(numKey)) continue
        if (guidKey) seenGuids.add(guidKey)
        seenNums.add(numKey)
        res.push(item)
      }
      return res
    }

    const readyOrders = dedupe(rawReady)
    const readyNums = new Set(readyOrders.map(o => `${o.store_code}_${o.business_date}_${o.order_number}`))
    const inProgressOrders = dedupe(rawInProgress).filter(
      o => !readyNums.has(`${o.store_code}_${o.business_date}_${o.order_number}`) && !isDrinkOrDessertOnlyOrder(o.items_summary)
    )

    return NextResponse.json({
      success: true,
      storeCode,
      businessDate: currentBusinessDate,
      shift: currentShift,
      counts: {
        total: filteredOrders.length,
        ready: readyOrders.length,
        inProgress: inProgressOrders.length
      },
      readyOrders,
      inProgressOrders,
      allOrders: filteredOrders,
      beverageCalls: beverageCalls || []
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

// POST: Crear o actualizar una orden (ej. desde el KDS bridge, simulación o webhook)
export async function POST(request: Request) {
  try {
    const access = await getOrderReadyAccess(request)
    if (!access) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body: OrderPayload = await request.json()

    if (!body.orderNumber) {
      return NextResponse.json({ error: 'orderNumber es obligatorio' }, { status: 400 })
    }

    const storeCode = (body.storeCode || 'LYNWOOD').toUpperCase()
    const isIsolatedTestStore =
      process.env.ALLOW_ORDER_READY_TEST_DB === 'true' && storeCode.startsWith('CODEX_ORDER_READY_TEST')
    if (!canAccessStore(access, storeCode) && !isIsolatedTestStore) {
      return NextResponse.json({ error: 'Sin acceso a esta tienda' }, { status: 403 })
    }
    const status = body.status || 'READY'
    const diningOption = (body.diningOption || 'TOGO').toUpperCase()
    // Regla de Negocio Tacos Gavilan: El Order Ready Board es exclusivo para FOR_HERE y TOGO
    if (diningOption !== 'FOR_HERE' && diningOption !== 'TOGO') {
      return NextResponse.json({
        success: true,
        action: 'ignored',
        reason: `Canal excluido del Order Ready Board (${diningOption})`
      })
    }
    const currentBusinessDate = getCaliforniaBusinessDate()

    // 1. Buscar si ya existe por order_guid (si viene) o por (store_code, business_date, order_number)
    let existing: any = null
    if (body.orderGuid) {
      const { data: byGuid } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('*')
        .eq('order_guid', body.orderGuid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      existing = byGuid
    }

    if (!existing) {
      const { data: byNum } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('*')
        .eq('store_code', storeCode)
        .eq('business_date', currentBusinessDate)
        .eq('order_number', String(body.orderNumber))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      existing = byNum
    }

    const now = new Date().toISOString()

    if (existing) {
      const updateData: any = {}
      if (existing.status !== status) {
        updateData.status = status
      }
      if (existing.dining_option !== diningOption) {
        updateData.dining_option = diningOption
      }
      const nextCustomerName = body.customerName !== undefined ? (body.customerName || null) : existing.customer_name
      if (existing.customer_name !== nextCustomerName) {
        updateData.customer_name = nextCustomerName
      }
      if (body.itemsSummary !== undefined) {
        const nextItems = body.itemsSummary || null
        if (!areOrderItemsSummariesEqual(existing.items_summary, nextItems)) {
          updateData.items_summary = nextItems
        }
      }
      if (body.orderGuid && !existing.order_guid) {
        updateData.order_guid = body.orderGuid
      }

      if (status === 'READY' && existing.status !== 'READY') {
        updateData.ready_at = now
        updateData.announced = false // Requiere nuevo anuncio por voz
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ success: true, order: existing, action: 'noop' })
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('order_ready_announcements')
        .update(updateData)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle()

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }

      if (!updated) {
        const { data: currentRow } = await supabaseAdmin
          .from('order_ready_announcements')
          .select('*')
          .eq('id', existing.id)
          .limit(1)
          .maybeSingle()
        return NextResponse.json({ success: true, order: currentRow || existing, action: 'noop' })
      }

      return NextResponse.json({ success: true, order: updated, action: 'updated' })
    }

    // Insertar nueva orden
    const newRecord: any = {
      store_code: storeCode,
      store_id: body.storeId || STORE_GUID_BY_CODE[storeCode] || storeCode,
      store_name: body.storeName || storeCode,
      order_number: String(body.orderNumber),
      order_guid: body.orderGuid || null,
      dining_option: diningOption,
      customer_name: body.customerName || null,
      status,
      business_date: currentBusinessDate,
      items_summary: body.itemsSummary || null,
      announced: false
    }

    if (status === 'READY') {
      newRecord.ready_at = now
    }

    const query = newRecord.order_guid
      ? supabaseAdmin.from('order_ready_announcements').upsert(newRecord, { onConflict: 'order_guid' }).select('*').maybeSingle()
      : supabaseAdmin.from('order_ready_announcements').insert(newRecord).select('*').maybeSingle()

    const { data: inserted, error: insertErr } = await query

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    let finalOrder = inserted
    if (!finalOrder && newRecord.order_guid) {
      const { data: byGuidRow } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('*')
        .eq('order_guid', newRecord.order_guid)
        .limit(1)
        .maybeSingle()
      finalOrder = byGuidRow
    }

    return NextResponse.json({
      success: true,
      order: finalOrder,
      action: inserted ? 'created' : 'noop'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

// PATCH: Marcar orden como anunciada o completada
export async function PATCH(request: Request) {
  try {
    const access = await getOrderReadyAccess(request)
    if (!access) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { id, announced, status } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 })
    }

    // Recuperar fila completa y validar que pertenezca a una tienda permitida
    const { data: target } = await supabaseAdmin
      .from('order_ready_announcements')
      .select('*')
      .eq('id', id)
      .limit(1)
      .maybeSingle()

    const isIsolatedTestStore =
      process.env.ALLOW_ORDER_READY_TEST_DB === 'true' &&
      String(target?.store_code || '').startsWith('CODEX_ORDER_READY_TEST')

    if (!target || (!canAccessStore(access, target.store_code) && !isIsolatedTestStore)) {
      return NextResponse.json({ error: 'Sin acceso a esta tienda' }, { status: 403 })
    }

    const updatePayload: any = {}
    if (typeof announced === 'boolean') {
      if (target.announced !== announced) {
        updatePayload.announced = announced
      }
      if (announced) {
        updatePayload.announced_at = new Date().toISOString()
      }
    }
    if (status && target.status !== status) {
      updatePayload.status = status
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ success: true, order: target, action: 'noop' })
    }

    const { data, error } = await supabaseAdmin
      .from('order_ready_announcements')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      const { data: refreshed } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('*')
        .eq('id', id)
        .limit(1)
        .maybeSingle()
      return NextResponse.json({ success: true, order: refreshed || target, action: 'noop' })
    }

    return NextResponse.json({ success: true, order: data, action: 'updated' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
