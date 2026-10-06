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
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

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
    const syncToast = searchParams.get('syncToast') === 'true'
    const minutes = parseInt(searchParams.get('minutes') || '45', 10)

    // Si se pide sync con Toast, consultamos la API de Toast para obtener órdenes recientes
    if (syncToast) {
      await syncRecentOrdersFromToast(storeCode)
    }

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

    const readyOrders = orders?.filter(o => o.status === 'READY') || []
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
    const body: OrderPayload = await request.json()

    if (!body.orderNumber) {
      return NextResponse.json({ error: 'orderNumber es obligatorio' }, { status: 400 })
    }

    const storeCode = (body.storeCode || 'LYNWOOD').toUpperCase()
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
    const { id, announced, status } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 })
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

// Helper para sincronizar órdenes recientes directamente desde Toast si se requiere
async function syncRecentOrdersFromToast(storeCode: string) {
  try {
    // Buscar el external_id de Toast para esta tienda
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('external_id, name')
      .ilike('name', `%${storeCode}%`)
      .limit(1)
      .maybeSingle()

    if (!store?.external_id) return

    const token = await getAuthToken()
    if (!token) return

    // Consultar órdenes de hoy en Toast
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
    url.searchParams.append('businessDate', today)
    url.searchParams.append('pageSize', '50')

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Toast-Restaurant-External-ID': store.external_id
      }
    })

    if (!res.ok) return
    const ordersData = await res.json()
    if (!Array.isArray(ordersData)) return

    // Mapeo básico de las últimas órdenes
    for (const ord of ordersData.slice(-15)) {
      const orderNum = ord.displayNumber || ord.orderNumber || (ord.checks && ord.checks[0]?.displayNumber)
      if (!orderNum) continue

      // Determinar si está cumplida/lista o en preparación
      const isFulfilled = ord.fulfillmentStatus === 'READY' || ord.paidStatus === 'PAID'
      const status = isFulfilled ? 'READY' : 'IN_PROGRESS'

      // Upsert orden
      const { data: existing } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('id')
        .eq('store_code', storeCode)
        .eq('order_number', String(orderNum))
        .maybeSingle()

      if (!existing) {
        await supabaseAdmin.from('order_ready_announcements').insert({
          store_code: storeCode,
          store_id: store.external_id,
          store_name: store.name,
          order_number: String(orderNum),
          order_guid: ord.guid,
          dining_option: ord.diningOption?.name?.toUpperCase()?.includes('HERE') ? 'FOR_HERE' : 'TOGO',
          customer_name: ord.customer?.firstName || null,
          status,
          announced: false,
          ready_at: status === 'READY' ? new Date().toISOString() : null
        })
      }
    }
  } catch (e) {
    console.error('Error syncing with Toast API:', e)
  }
}
