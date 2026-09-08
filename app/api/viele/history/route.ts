/**
 * @module app/api/viele/history/route
 * @description Next.js API route que actúa como proxy seguro hacia los endpoints de historial
 *              del portal ClearNine de Viele & Sons (shop.vieleandsons.com).
 *              Soporta consulta de UNA tienda o TODAS las 15 tiendas en paralelo.
 *              Filtra por año(s) y devuelve JSON normalizado con campo `storeId` y `storeName`.
 *
 * @businessRules
 * - storeId=all → Login + fetch en paralelo de las 15 tiendas (~5-8 segundos total).
 * - storeId=14 → Login + fetch de solo esa tienda (~1-2 segundos).
 * - year soporta múltiples años separados por coma: year=2025,2026
 * - orderNo → Detalle de líneas de producto de una orden específica (requiere storeId numérico).
 * - Credenciales NUNCA se exponen al frontend — el backend hace login server-side.
 * - Admin-only route. No se requiere autenticación adicional en este nivel.
 *
 * @dataFlow
 * - ClearNine salesOrderList_dt → JSON con aaData[] (filas DataTables)
 * - ClearNine salesOrderDetail_dt → JSON con aaData[] (líneas de producto)
 * - Cada fila se limpia de HTML tags y se normaliza a un objeto tipado.
 *
 * @notes
 * - [2026-09-08] Soporte multi-tienda paralelo (storeId=all) y multi-año (year=2025,2026).
 * - [2026-09-08] Creación inicial del endpoint proxy.
 */

import { NextResponse } from 'next/server';
import { loginViele, VIELE_STORE_ACCOUNTS } from '@/lib/viele-api';

const BASE_URL = 'https://shop.vieleandsons.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** Limpia HTML tags de los campos de DataTables */
function clean(val: any): string {
  return val ? String(val).replace(/<[^>]+>/g, '').trim() : '';
}

/** Parsea un string tipo "$2,689.26" a número */
function parseDollar(s: string): number {
  return parseFloat(s.replace(/[$,]/g, '')) || 0;
}

/** Fetch orders for a single store, filtered by year(s) */
async function fetchStoreOrders(
  storeId: number,
  storeName: string,
  email: string,
  password: string,
  years: string[],
  limit: number
): Promise<{ orders: any[]; totalAllTime: number; error?: string }> {
  try {
    const loginRes = await loginViele(email, password);
    if (!loginRes.success) {
      return { orders: [], totalAllTime: 0, error: `Login failed for ${storeName}: ${loginRes.error}` };
    }

    const url = `${BASE_URL}/api/salesOrderList_dt?sEcho=1&iDisplayStart=0&iDisplayLength=${limit}&iSortCol_0=1&sSortDir_0=desc`;
    const res = await fetch(url, {
      headers: {
        'Cookie': loginRes.cookieHeader,
        'User-Agent': UA,
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/myaccount/salesorders/`
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const aaData = json.aaData || [];
    const totalAllTime = json.iTotalRecords || 0;

    const orders: any[] = [];
    for (const row of aaData) {
      const rawDate = clean(row[6]);
      const rowYear = rawDate.substring(0, 4);

      if (years.length > 0 && !years.includes(rowYear)) continue;

      orders.push({
        orderNo: clean(row[0]),
        orderDate: clean(row[1]),
        rawDate,
        status: clean(row[2]),
        shipToName: clean(row[3]),
        customerPo: clean(row[4]),
        orderTotal: clean(row[5]),
        orderTotalNumeric: parseDollar(clean(row[5])),
        storeId,
        storeName
      });
    }

    // Sort by rawDate descending (newest first, e.g. 20260907 before 20250110)
    orders.sort((a, b) => (b.rawDate || '').localeCompare(a.rawDate || '') || b.orderNo.localeCompare(a.orderNo));

    return { orders, totalAllTime };
  } catch (err: any) {
    return { orders: [], totalAllTime: 0, error: `${storeName}: ${err.message}` };
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeIdParam = searchParams.get('storeId');
    const yearParam = searchParams.get('year') || '2025,2026';
    const orderNo = searchParams.get('orderNo');
    const limitParam = searchParams.get('limit') || '500';
    const limit = parseInt(limitParam, 10);

    // Parse years (soporta "2026" o "2025,2026")
    const years = yearParam.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y));

    if (!storeIdParam) {
      return NextResponse.json({ success: false, error: 'storeId is required' }, { status: 400 });
    }

    // ═══ Mode 2: Order Detail (orderNo provided) ═══
    if (orderNo) {
      const sid = parseInt(storeIdParam, 10);
      const account = VIELE_STORE_ACCOUNTS[sid];
      if (!account) {
        return NextResponse.json({ success: false, error: 'Invalid storeId for detail' }, { status: 400 });
      }

      const loginRes = await loginViele(account.email, account.password);
      if (!loginRes.success) {
        return NextResponse.json({ success: false, error: `Login failed: ${loginRes.error}` }, { status: 500 });
      }

      const detailUrl = `${BASE_URL}/api/salesOrderDetail_dt?orderNo=${encodeURIComponent(orderNo)}&sEcho=1&iDisplayStart=0&iDisplayLength=200`;
      const res = await fetch(detailUrl, {
        headers: {
          'Cookie': loginRes.cookieHeader,
          'User-Agent': UA,
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${BASE_URL}/myaccount/salesorders/`
        }
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const items = (json.aaData || []).map((row: any[]) => ({
        itemCode: clean(row[0]),
        description: clean(row[1]),
        qtyOrdered: parseInt(clean(row[2]), 10) || 0,
        qtyShipped: parseInt(clean(row[3]), 10) || 0,
        uom: clean(row[5]),
        unitPrice: clean(row[6]),
        unitPriceNumeric: parseDollar(clean(row[6])),
        extendedAmount: clean(row[7]),
        extendedAmountNumeric: parseDollar(clean(row[7]))
      }));

      return NextResponse.json({ success: true, orderNo, totalLines: items.length, items });
    }

    // ═══ Mode 1: Order List ═══

    // storeId=all → Fetch ALL 15 stores in parallel
    if (storeIdParam === 'all') {
      const allAccounts = Object.values(VIELE_STORE_ACCOUNTS);

      const results = await Promise.allSettled(
        allAccounts.map(acc =>
          fetchStoreOrders(acc.storeId, acc.storeName, acc.email, acc.password, years, limit)
        )
      );

      let allOrders: any[] = [];
      let totalAllTime = 0;
      const errors: string[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allOrders = allOrders.concat(result.value.orders);
          totalAllTime += result.value.totalAllTime;
          if (result.value.error) errors.push(result.value.error);
        } else {
          errors.push(result.reason?.message || 'Unknown error');
        }
      }

      // Sort by rawDate descending (newest first) with orderNo fallback
      allOrders.sort((a, b) => (b.rawDate || '').localeCompare(a.rawDate || '') || b.orderNo.localeCompare(a.orderNo));

      return NextResponse.json({
        success: true,
        source: 'viele_sage100',
        mode: 'all_stores',
        storesQueried: allAccounts.length,
        totalAllTime,
        totalFiltered: allOrders.length,
        years,
        errors: errors.length > 0 ? errors : undefined,
        orders: allOrders
      });
    }

    // storeId=N → Fetch single store
    const sid = parseInt(storeIdParam, 10);
    const account = VIELE_STORE_ACCOUNTS[sid];
    if (!account) {
      return NextResponse.json({ success: false, error: 'Invalid storeId' }, { status: 400 });
    }

    const result = await fetchStoreOrders(account.storeId, account.storeName, account.email, account.password, years, limit);

    return NextResponse.json({
      success: true,
      source: 'viele_sage100',
      mode: 'single_store',
      totalAllTime: result.totalAllTime,
      totalFiltered: result.orders.length,
      years,
      orders: result.orders
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error occurred'
    }, { status: 500 });
  }
}
