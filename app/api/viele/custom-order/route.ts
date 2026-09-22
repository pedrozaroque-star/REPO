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
 * - DELETE: UPSERT atómico con posiciones oficiales de V&S Order Guide / viele_items
 *
 * @notes
 * - [2026-09-21] Corrección de auditoría: DELETE ahora es atómico vía UPSERT y nunca ejecuta DELETE sin reemplazo,
 *   evitando que fallos de red dejen a la tienda con membresía vacía o desprotegida.
 * - [2026-09-21] Control RBAC estricto vía verifyVieleAuth para GET, PUT y DELETE.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loginViele, fetchVieleOrderGuide, VIELE_STORE_ACCOUNTS } from '@/lib/viele-api';
import { verifyVieleAuth } from '@/lib/viele-auth';

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

    const numericStoreId = parseInt(storeId);

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

    const numericStoreId = parseInt(storeId);

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req, { requiredStoreId: numericStoreId });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    const itemCodes: string[] = rawItems.map((it: any) => {
      if (typeof it === 'string') return it.trim();
      if (it && typeof it === 'object') return (it.itemCode || it.item_code || '').trim();
      return '';
    }).filter(Boolean);

    if (itemCodes.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No valid item codes found in payload'
      }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

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

    const numericStoreId = parseInt(storeId);

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req, { requiredStoreId: numericStoreId });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    const account = VIELE_STORE_ACCOUNTS[numericStoreId];
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

    // Fallback seguro: si no hay sesión remota, restablecer usando el orden maestro de viele_items
    // NUNCA borrar la membresía completa con un DELETE no condicionado
    const { data: storeExisting, error: fetchExistingErr } = await supabase
      .from('viele_store_sort_orders')
      .select('item_code')
      .eq('store_id', numericStoreId);

    if (fetchExistingErr) {
      return NextResponse.json({ success: false, error: fetchExistingErr.message }, { status: 500 });
    }

    if (storeExisting && storeExisting.length > 0) {
      const { data: masterItems } = await supabase
        .from('viele_items')
        .select('item_code, sort_order');

      const masterOrderMap = new Map((masterItems || []).map(i => [i.item_code.trim().toUpperCase(), i.sort_order]));
      const fallbackUpserts = storeExisting.map(r => ({
        store_id: numericStoreId,
        item_code: r.item_code,
        sort_order: masterOrderMap.get(r.item_code.trim().toUpperCase()) ?? 999,
        updated_at: new Date().toISOString()
      }));

      const { error: fallbackErr } = await supabase
        .from('viele_store_sort_orders')
        .upsert(fallbackUpserts, { onConflict: 'store_id,item_code' });

      if (fallbackErr) {
        return NextResponse.json({ success: false, error: fallbackErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        storeId: numericStoreId,
        message: `Orden de la sucursal #${numericStoreId} restablecido al orden maestro predeterminado (${fallbackUpserts.length} items)`
      });
    }

    return NextResponse.json({
      success: true,
      storeId: numericStoreId,
      message: `La sucursal #${numericStoreId} no requería restablecimiento`
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
