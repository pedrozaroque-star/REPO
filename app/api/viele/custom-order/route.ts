/**
 * @module api/viele/custom-order
 * @description Endpoint para consultar, guardar y restablecer el orden personalizado
 *              de productos de Viele & Sons por sucursal (Drag and Drop por tienda).
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan
 * - Cada sucursal (Lynwood, Huntington Park, etc.) puede organizar los productos a su manera
 *   según el recorrido físico de su propia bodega y estantes.
 * - Si una sucursal no ha configurado un orden propio, se utiliza el orden oficial predeterminado de Viele & Sons.
 * - Restablecer el orden (DELETE) reinserta atómicamente el orden oficial del Order Guide de Viele & Sons
 *   sin vaciar la membresía de la sucursal ni dejar la tabla vacía en caso de error de red.
 *
 * @dataFlow
 * - GET: SELECT item_code, sort_order FROM viele_store_sort_orders WHERE store_id = X ORDER BY sort_order ASC
 * - PUT: UPSERT a viele_store_sort_orders con el nuevo arreglo secuencial de item_code
 * - DELETE: UPSERT atómico con posiciones oficiales de V&S sobre la membresía vigente.
 *
 * @notes
 * - Fallos remotos no modifican posiciones. Si cambió la membresía, sincronizar antes de restablecer.
 * - [2026-09-21] Corrección de auditoría: DELETE ahora es atómico vía UPSERT y nunca ejecuta DELETE sin reemplazo,
 *   evitando que fallos de red dejen a la tienda con membresía vacía o desprotegida.
 * - [2026-09-21] Control RBAC estricto vía verifyVieleAuth para GET, PUT y DELETE.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loginViele, fetchVieleOrderGuide } from '@/lib/viele-api';
import { getVieleStoreAccount } from '@/lib/viele-credentials-server';
import { verifyVieleAuth } from '@/lib/viele-auth';
import { parseVieleStoreId } from '@/lib/viele-catalog-validation';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, serviceKey);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');

    if (!storeId) {
      return NextResponse.json({ success: false, error: 'storeId is required' }, { status: 400 });
    }

    const numericStoreId = parseVieleStoreId(storeId);
    if (numericStoreId === null) return NextResponse.json({ success: false, error: 'storeId inválido' }, { status: 400 });

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req, { requiredStoreId: numericStoreId });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    const { data, error } = await supabase
      .from('viele_store_sort_orders')
      .select('item_code, sort_order, updated_at')
      .eq('store_id', numericStoreId)
      .order('sort_order', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const hasCustomOrder = Boolean(data && data.length > 0);
    const orderedCodes = (data || []).map(r => r.item_code);

    return NextResponse.json({
      success: true,
      storeId: numericStoreId,
      hasCustomOrder,
      count: orderedCodes.length,
      orderedCodes
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { storeId } = body;
    const rawItems = body.itemCodes || body.order || [];

    if (!storeId || !Array.isArray(rawItems) || rawItems.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'storeId and an array of itemCodes are required'
      }, { status: 400 });
    }

    const numericStoreId = parseVieleStoreId(storeId);
    if (numericStoreId === null) return NextResponse.json({ success: false, error: 'storeId inválido' }, { status: 400 });

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req, { requiredStoreId: numericStoreId });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    const itemCodes: string[] = rawItems.map((it: any) => {
      if (typeof it === 'string') return it.trim().toUpperCase();
      if (it && typeof it === 'object') {
        const code = it.itemCode ?? it.item_code;
        return typeof code === 'string' ? code.trim().toUpperCase() : '';
      }
      return '';
    }).filter(Boolean);

    if (itemCodes.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No valid item codes found in payload'
      }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const { data: membership, error: membershipError } = await supabase
      .from('viele_store_sort_orders').select('item_code').eq('store_id', numericStoreId);
    if (membershipError) return NextResponse.json({ success: false, error: membershipError.message }, { status: 500 });
    const allowedCodes = new Set((membership || []).map(row => row.item_code.trim().toUpperCase()));
    if (itemCodes.length !== rawItems.length || itemCodes.length !== allowedCodes.size || new Set(itemCodes).size !== itemCodes.length || itemCodes.some(code => !allowedCodes.has(code))) {
      return NextResponse.json({ success: false, error: 'El orden debe contener exactamente los SKU de la sucursal, sin duplicados.' }, { status: 400 });
    }

    const updates = itemCodes.map((item_code: string, index: number) => ({
      store_id: numericStoreId,
      item_code: item_code.trim(),
      sort_order: index + 1,
      updated_at: nowIso
    }));

    const { error } = await supabase
      .from('viele_store_sort_orders')
      .upsert(updates, { onConflict: 'store_id,item_code' });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      storeId: numericStoreId,
      updatedCount: updates.length,
      message: `Orden personalizado guardado exitosamente para la sucursal #${numericStoreId}`
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');

    if (!storeId) {
      return NextResponse.json({ success: false, error: 'storeId is required' }, { status: 400 });
    }

    const numericStoreId = parseVieleStoreId(storeId);
    if (numericStoreId === null) return NextResponse.json({ success: false, error: 'storeId inválido' }, { status: 400 });

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req, { requiredStoreId: numericStoreId });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    const account = getVieleStoreAccount(numericStoreId);
    if (account) {
      const login = await loginViele(account.email, account.password);
      if (login.success) {
        const og = await fetchVieleOrderGuide(login.cookieHeader);
        if (og.success && og.items && og.items.length > 0) {
          const sortUpserts = og.items.map((item: any, idx: number) => ({
            store_id: numericStoreId,
            item_code: (item.ItemID || '').trim().toUpperCase(),
            sort_order: parseInt(item.DisplayOrder) || (idx + 1),
            updated_at: new Date().toISOString()
          })).filter((x: any) => Boolean(x.item_code));
          const { data: membership, error: membershipError } = await supabase
            .from('viele_store_sort_orders').select('item_code').eq('store_id', numericStoreId);
          if (membershipError) return NextResponse.json({ success: false, error: membershipError.message }, { status: 500 });
          const currentCodes = new Set((membership || []).map(row => row.item_code.trim().toUpperCase()));
          const officialCodes = new Set(sortUpserts.map(row => row.item_code));
          if (sortUpserts.length !== og.items.length || officialCodes.size !== sortUpserts.length || currentCodes.size !== officialCodes.size || [...currentCodes].some(code => !officialCodes.has(code))) {
            return NextResponse.json({ success: false, error: 'El Order Guide cambió. Sincroniza el catálogo antes de restablecer su orden.' }, { status: 409 });
          }

          // Actualización atómica vía UPSERT: nunca deja la membresía en blanco
          const { error: upsertErr } = await supabase
            .from('viele_store_sort_orders')
            .upsert(sortUpserts, { onConflict: 'store_id,item_code' });

          if (upsertErr) {
            return NextResponse.json({
              success: false,
              error: `Error al actualizar posiciones de la sucursal: ${upsertErr.message}`
            }, { status: 500 });
          }

          return NextResponse.json({
            success: true,
            storeId: numericStoreId,
            syncedItems: sortUpserts.length,
            message: `Orden de la sucursal #${numericStoreId} restablecido al orden oficial de Viele & Sons (${sortUpserts.length} items)`
          });
        }
      }
    }

    return NextResponse.json({
      success: false,
      error: 'No se pudo consultar el Order Guide oficial. El orden de la sucursal permanece intacto.'
    }, { status: 502 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
