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
 * - Client / TV / Tablet -> GET /api/order-ready/orders?storeCode=LYNWOOD -> Supabase (order_ready_announcements) + Toast Sync opcional -> Client Display
 * - Client / POS / Webhook -> POST /api/order-ready/orders -> Inserta o actualiza orden -> Supabase Realtime -> Audio Announcer
 * 
 * @notes
 * - Soporta sincronización en caliente con Toast API (/orders/v2/ordersBulk) si se solicita `syncToast=true`.
 * - FIX (2026-10-06): el doble tap del expediter NO genera webhook en Toast. Cada GET dispara `syncStoreFromToast()`
 *   (lib/order-ready-sync.ts, throttle 5 s por tienda) que lee `selections[].fulfillmentStatus` y marca READY con la hora real del bump.
 *   Se eliminó el sync anterior que usaba businessDate UTC y un único mapeo por número de orden.
 * - ACCESO POR TIENDA (2026-10-06): GET/POST/PATCH exigen sesión y validan la tienda con lib/order-ready-access.ts
 *   (admin = todas, supervisor = su alcance, manager/asistente = solo su tienda). 401 sin sesión, 403 fuera de alcance.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncStoreFromToast, STORE_GUID_BY_CODE } from '@/lib/order-ready-sync'
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
    const access = await getOrderReadyAccess(request)
    if (!access) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const storeCode = (searchParams.get('storeCode') || searchParams.get('store') || 'LYNWOOD').toUpperCase()
    if (!canAccessStore(access, storeCode)) {
      return NextResponse.json({ error: 'Sin acceso a esta tienda' }, { status: 403 })
    }
    const syncToast = searchParams.get('syncToast') === 'true'
    const minutes = parseInt(searchParams.get('minutes') || '45', 10)

    // Toast NO manda webhook en el doble tap del KDS: consultamos Toast activamente (throttle 5 s por tienda;
    // el botón manual "Sincronizar Toast" fuerza la consulta inmediata).
    await syncStoreFromToast(storeCode, syncToast)

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

    let { data: orders, error } = await fetchRows()

    // VERIFICACIÓN ANTI-DRIVE-THRU: un webhook (o versión vieja) puede haber insertado una orden DT como TOGO.
    // Si hay filas recién creadas o por anunciar, se fuerza un sync sin throttle ANTES de entregarlas al cliente,
    // para que el sync borre/corrija las que no son FOR_HERE/TOGO y nunca lleguen a sonar.
    if (!error && orders) {
      const needsVerify = orders.some(
        (o: any) => o.status === 'READY' && !o.announced
      )
      if (needsVerify) {
        await syncStoreFromToast(storeCode, false)
        const again = await fetchRows()
        orders = again.data
        error = again.error
      }
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Regla de Negocio Tacos Gavilan: El Order Ready Board es exclusivo para comedor (FOR_HERE) y para llevar (TOGO).
    // Se descartan por completo órdenes de Drive-Thru y Delivery de plataformas.
    const isAllowedDining = (o: any) => o.dining_option === 'FOR_HERE' || o.dining_option === 'TOGO'
    const filteredOrders = (orders || []).filter(isAllowedDining)

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
      o => !readyNums.has(`${o.store_code}_${o.business_date}_${o.order_number}`)
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
      allOrders: filteredOrders
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
    if (!canAccessStore(access, storeCode)) {
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

    // Buscar si ya existe una orden activa en ESTA jornada laboral con este número y tienda
    const { data: existing } = await supabaseAdmin
      .from('order_ready_announcements')
      .select('id, status, announced')
      .eq('store_code', storeCode)
      .eq('business_date', currentBusinessDate)
      .eq('order_number', String(body.orderNumber))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const now = new Date().toISOString()

    if (existing) {
      // Actualizar estado
      const updateData: any = {
        status,
        dining_option: diningOption,
        customer_name: body.customerName || null,
        items_summary: body.itemsSummary || null
      }

      if (status === 'READY' && existing.status !== 'READY') {
        updateData.ready_at = now
        updateData.announced = false // Requiere nuevo anuncio por voz
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('order_ready_announcements')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single()

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
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
      ? supabaseAdmin.from('order_ready_announcements').upsert(newRecord, { onConflict: 'order_guid' }).select().single()
      : supabaseAdmin.from('order_ready_announcements').insert(newRecord).select().single()

    const { data: inserted, error: insertErr } = await query

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, order: inserted, action: 'created' })
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

    // La orden debe pertenecer a una tienda permitida para el usuario
    const { data: target } = await supabaseAdmin
      .from('order_ready_announcements')
      .select('store_code')
      .eq('id', id)
      .maybeSingle()
    if (!target || !canAccessStore(access, target.store_code)) {
      return NextResponse.json({ error: 'Sin acceso a esta tienda' }, { status: 403 })
    }

    const updatePayload: any = {}
    if (typeof announced === 'boolean') {
      updatePayload.announced = announced
      if (announced) {
        updatePayload.announced_at = new Date().toISOString()
      }
    }
    if (status) {
      updatePayload.status = status
    }

    const { data, error } = await supabaseAdmin
      .from('order_ready_announcements')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, order: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
