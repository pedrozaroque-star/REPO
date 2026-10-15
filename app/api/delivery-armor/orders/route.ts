/**
 * @module app/api/delivery-armor/orders/route
 * @description Endpoint para consultar órdenes de entrega y para llevar (Off-Premise) de Toast en tiempo real.
 *   - Integra Toast API v2 con mapeo dinámico de Dining Options (DoorDash, Uber Eats, Grubhub, Toast Online, Curbside, Takeout).
 *   - Devuelve el desglose completo de productos, modificadores y bebidas de alto riesgo.
 *   - Cruza el estado actual de cada pedido con la tabla delivery_packing_audits en Supabase.
 *
 * @businessRules
 *   - Solo procesa órdenes off-premise (excluye comedor Dine-In tradicional).
 *   - Respeta el día laboral de 6:00 AM a 5:59 AM del día siguiente.
 *   - Por defecto admite las sucursales del plan piloto: Slauson (#7) y LA Central (#6).
 *
 * @dataFlow
 *   Client Tablet/Admin -> GET /api/delivery-armor/orders?storeId=6 -> fetchOffPremiseOrders() -> Toast API + Supabase -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchOffPremiseOrders, getActiveStorePinSession } from '@/lib/delivery-armor'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('storeId') || '6' // Default LA Central (#6)
    const storeId = parseInt(storeIdParam, 10)
    const businessDate = searchParams.get('businessDate') || undefined

    if (isNaN(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'Parámetro storeId inválido.' }, { status: 400 })
    }

    const [result, activeSession] = await Promise.all([
      fetchOffPremiseOrders(storeId, businessDate),
      getActiveStorePinSession(storeId)
    ])

    return NextResponse.json({
      ok: true,
      storeId,
      storeName: result.storeName,
      businessDate: result.businessDate,
      orders: result.orders,
      totalOrders: result.orders.length,
      activeSession
    })
  } catch (err: any) {
    console.error('Error en /api/delivery-armor/orders:', err)
    return NextResponse.json({
      ok: false,
      error: err?.message || 'Error al obtener órdenes de Toast'
    }, { status: 500 })
  }
}
