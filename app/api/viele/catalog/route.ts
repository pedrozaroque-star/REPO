/**
 * @module api/viele/catalog
 * @description Endpoint para consultar el catálogo maestro de 89 productos de Viele & Sons,
 *              con soporte para orden predeterminado oficial y orden personalizado por sucursal.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan
 * - Solo devuelve artículos activos (is_active = true).
 * - Orden predeterminado: sort_order oficial de Viele & Sons (/api/v3/order_guide).
 * - Si se especifica `storeId`, se aplica el ordenamiento personalizado que el gerente
 *   haya configurado para esa sucursal en `viele_store_sort_orders`.
 *
 * @dataFlow
 * - Supabase: viele_items cruzado con viele_store_sort_orders por store_id.
 *
 * @notes
 * - [2026-09-21] Si se especifica `storeId`, se filtra exclusivamente a los productos que pertenecen al Order Guide de esa sucursal en `viele_store_sort_orders`, garantizando que tiendas con catálogos extendidos (ej. Bell con 88 items) o estándar (87 items) vean exactamente sus productos.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyVieleAuth } from '@/lib/viele-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, serviceKey);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const query = searchParams.get('query');
    const storeId = searchParams.get('storeId');

    // 1. Verificación de autenticación y autorización por sucursal
    const auth = verifyVieleAuth(req, {
      requiredStoreId: storeId ? parseInt(storeId) : undefined
    });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    let dbQuery = supabase
      .from('viele_items')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (category && category !== 'all') {
      dbQuery = dbQuery.eq('category', category);
    }

    if (query) {
      dbQuery = dbQuery.or(`item_code.ilike.%${query}%,description.ilike.%${query}%`);
    }

    const { data: rawItems, error } = await dbQuery;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    let items = rawItems || [];

    // Si se pasa storeId, verificar si la tienda tiene un orden personalizado y membresía estricta
    if (storeId && items.length > 0) {
      const numericStoreId = parseInt(storeId);
      const { data: storeOrders, error: sortError } = await supabase
        .from('viele_store_sort_orders')
        .select('item_code, sort_order')
        .eq('store_id', numericStoreId);

      if (sortError) {
        return NextResponse.json({
          success: false,
          error: `Error al consultar membresía de la sucursal #${numericStoreId}: ${sortError.message}`
        }, { status: 500 });
      }

      if (storeOrders && storeOrders.length > 0) {
        const orderMap = new Map<string, number>();
        storeOrders.forEach(so => {
          orderMap.set(so.item_code.trim().toUpperCase(), so.sort_order);
        });

        // Filtrar exclusivamente a los productos que pertenecen al Order Guide de esta tienda y ordenar
        items = items
          .filter(item => orderMap.has(item.item_code.trim().toUpperCase()))
          .sort((a, b) => {
            const orderA = orderMap.get(a.item_code.trim().toUpperCase()) ?? 999;
            const orderB = orderMap.get(b.item_code.trim().toUpperCase()) ?? 999;
            return orderA - orderB;
          });
      } else {
        // Si no hay registros de membresía para la sucursal, no filtrar catálogo global por error
        items = [];
      }
    }

    // Calcular estadísticas de radar de precios
    let lastScannedAt: string | null = null;
    let priceIncreases = 0;
    let priceDecreases = 0;
    let newItems = 0;

    items.forEach(item => {
      if (item.last_scanned_at && (!lastScannedAt || item.last_scanned_at > lastScannedAt)) {
        lastScannedAt = item.last_scanned_at;
      }
      if (item.price_status === 'increased') priceIncreases++;
      else if (item.price_status === 'decreased') priceDecreases++;
      else if (item.price_status === 'new') newItems++;
    });

    // Asegurar numeración secuencial limpia 1..N
    const formattedData = items.map((item, index) => ({
      ...item,
      sort_order: index + 1
    }));

    return NextResponse.json({
      success: true,
      count: formattedData.length,
      radarStats: {
        lastScannedAt,
        priceIncreases,
        priceDecreases,
        newItems,
        hasPriceChanges: priceIncreases > 0 || priceDecreases > 0
      },
      data: formattedData
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
