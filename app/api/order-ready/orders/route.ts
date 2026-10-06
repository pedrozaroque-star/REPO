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
import { syncStoreFromToast } from '@/lib/order-ready-sync'
import { getOrderReadyAccess, canAccessStore } from '@/lib/order-ready-access'

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

    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()

    // Traer órdenes recientes no completadas o listas en los últimos N minutos
    const { data: orders, error } = await supabaseAdmin
      .from('order_ready_announcements')
      .select('*')
      .eq('store_code', storeCode)
      .gte('created_at', cutoff)
      .in('status', ['IN_PROGRESS', 'READY'])
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Listas: más reciente primero en pantalla (el cliente las anuncia en orden de cierre: ready_at ascendente)
    const readyOrders = (orders?.filter(o => o.status === 'READY') || []).sort(
      (a, b) => Date.parse(b.ready_at || b.created_at) - Date.parse(a.ready_at || a.created_at)
    )
    const inProgressOrders = orders?.filter(o => o.status === 'IN_PROGRESS') || []

    return NextResponse.json({
      success: true,
      storeCode,
      counts: {
        total: orders?.length || 0,
        ready: readyOrders.length,
        inProgress: inProgressOrders.length
      },
      readyOrders,
      inProgressOrders,
      allOrders: orders || []
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

    // Buscar si ya existe una orden activa con este número y tienda
    const { data: existing } = await supabaseAdmin
      .from('order_ready_announcements')
      .select('id, status, announced')
      .eq('store_code', storeCode)
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
      store_id: body.storeId || storeCode,
      store_name: body.storeName || storeCode,
      order_number: String(body.orderNumber),
      order_guid: body.orderGuid || null,
      dining_option: diningOption,
      customer_name: body.customerName || null,
      status,
      items_summary: body.itemsSummary || null,
      announced: false
    }

    if (status === 'READY') {
      newRecord.ready_at = now
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('order_ready_announcements')
      .insert(newRecord)
      .select()
      .single()

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
