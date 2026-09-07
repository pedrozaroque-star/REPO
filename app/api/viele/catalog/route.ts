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
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, serviceKey);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const query = searchParams.get('query');
    const storeId = searchParams.get('storeId');

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

    // Si se pasa storeId, verificar si la tienda tiene un orden personalizado
    if (storeId && items.length > 0) {
      const numericStoreId = parseInt(storeId);
      const { data: storeOrders, error: sortError } = await supabase
        .from('viele_store_sort_orders')
        .select('item_code, sort_order')
        .eq('store_id', numericStoreId);

      if (!sortError && storeOrders && storeOrders.length > 0) {
        const orderMap = new Map<string, number>();
        storeOrders.forEach(so => {
          orderMap.set(so.item_code.trim(), so.sort_order);
        });

        // Ordenar según el orden de la tienda
        items = [...items].sort((a, b) => {
          const orderA = orderMap.has(a.item_code) ? orderMap.get(a.item_code)! : a.sort_order + 1000;
          const orderB = orderMap.has(b.item_code) ? orderMap.get(b.item_code)! : b.sort_order + 1000;
          return orderA - orderB;
        });
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
