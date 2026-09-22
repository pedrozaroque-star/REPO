/**
 * @module api/viele/orders
 * @description Endpoint para creación, consulta y checkout de pedidos a Viele & Sons.
 *              Soporta modos 'live' (checkout oficial contra Sage 100), 'simulation' (dry-run)
 *              y 'draft' (borrador local sin llamada a la API de Viele).
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Valida cantidades estrictamente enteras y mayores a cero.
 * - Modos de ejecución claros e inequívocos: 'live', 'simulation', 'draft'.
 * - Persiste orden de compra oficial de Sage 100 (Wxxxxxx) en viele_orders con estatus 'confirmed'.
 * - Manejo de éxito parcial: si la orden de Sodas se confirma en Viele pero la de Insumos falla,
 *   se persiste inmediatamente la orden de Sodas para evitar reenvíos duplicados.
 * - Idempotencia durable en DB por request; serializa checkout por tienda, sin expiración automática.
 * - Control RBAC por sucursal para lectura y emisión de pedidos.
 *
 * @dataFlow
 * - Frontend → POST /api/viele/orders
 * - Backend → placeVieleOrder (lib/viele-api.ts)
 * - Supabase → RPC transaccional de encabezados y partidas; fallos requieren conciliación sin reenviar.
 *
 * @notes
 * - [2026-09-22] Migración 202609220001 requerida; fail-closed si falta. Tax desconocido queda pendiente.
 * - [2026-09-21] Implementación de control de acceso verifyVieleAuth, persistencia de éxito parcial,
 *   idempotencia contra doble clic, fecha en zona horaria America/Los_Angeles y validación de enteros.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleVieleOrder } from '@/lib/viele-order-handler';
import { verifyVieleAuth } from '@/lib/viele-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, serviceKey);


export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');
    const orderId = searchParams.get('orderId');

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    if (orderId) {
      // Detalle de una orden específica
      const { data: order, error: orderError } = await supabase
        .from('viele_orders')
        .select(`
          *,
          stores (id, name, code)
        `)
        .eq('id', orderId)
        .single();

      if (orderError) {
        return NextResponse.json({ success: false, error: orderError.message }, { status: 500 });
      }

      // Validar que el usuario tenga acceso a la tienda de la orden
      if (auth.role !== 'admin' && auth.allowedStoreIds && !auth.allowedStoreIds.includes(order.store_id)) {
        return NextResponse.json({ success: false, error: 'Acceso denegado: No tienes permiso para ver esta orden' }, { status: 403 });
      }

      const { data: items, error: itemsError } = await supabase
        .from('viele_order_items')
        .select('*')
        .eq('order_id', orderId)
        .order('id', { ascending: true });

      if (itemsError) {
        return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, order, items });
    }

    // Listado de órdenes
    let dbQuery = supabase
      .from('viele_orders')
      .select(`
        id,
        store_id,
        order_number,
        order_category,
        linked_order_number,
        order_date,
        ship_date,
        status,
        total_cases,
        subtotal_amount,
        tax_amount,
        total_amount,
        buyer_name,
        customer_po_no,
        created_at,
        stores (id, name, code),
        viele_order_items (id)
      `)
      .order('created_at', { ascending: false });

    if (storeId && storeId !== 'all') {
      const sid = parseInt(storeId);
      if (auth.role !== 'admin' && auth.allowedStoreIds && !auth.allowedStoreIds.includes(sid)) {
        return NextResponse.json({ success: false, error: 'Acceso denegado a esta sucursal' }, { status: 403 });
      }
      dbQuery = dbQuery.eq('store_id', sid);
    } else {
      // Restricción por alcance de rol cuando no se filtra por una tienda específica
      if (auth.role !== 'admin') {
        if (!auth.allowedStoreIds || auth.allowedStoreIds.length === 0) {
          return NextResponse.json({ success: false, error: 'Acceso denegado: no tienes sucursales asignadas.' }, { status: 403 });
        }
        dbQuery = dbQuery.in('store_id', auth.allowedStoreIds);
      }
    }

    const categoryFilter = searchParams.get('category');
    if (categoryFilter && categoryFilter !== 'all') {
      dbQuery = dbQuery.eq('order_category', categoryFilter);
    }

    const yearFilter = searchParams.get('year');
    if (yearFilter && /^\d{4}$/.test(yearFilter)) {
      dbQuery = dbQuery
        .gte('order_date', `${yearFilter}-01-01`)
        .lte('order_date', `${yearFilter}-12-31`);
    }

    const { data, error } = await dbQuery.limit(200);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const mappedOrders = (data || []).map((o: any) => {
      const itemsCount = Array.isArray(o.viele_order_items) ? o.viele_order_items.length : 0;
      const { viele_order_items, ...rest } = o;
      return {
        ...rest,
        items_count: itemsCount,
        total_catalog_items: o.store_id === 13 ? 88 : 87
      };
    });

    return NextResponse.json({ success: true, count: mappedOrders.length, orders: mappedOrders });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handleVieleOrder(req, supabase);
}
