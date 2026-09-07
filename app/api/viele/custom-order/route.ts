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
 * - Restablecer el orden (DELETE) elimina las posiciones personalizadas y retorna al orden oficial.
 *
 * @dataFlow
 * - GET: SELECT item_code, sort_order FROM viele_store_sort_orders WHERE store_id = X ORDER BY sort_order ASC
 * - PUT: UPSERT a viele_store_sort_orders con el nuevo arreglo secuencial de item_code
 * - DELETE: DELETE FROM viele_store_sort_orders WHERE store_id = X
 *
 * @notes
 * - [2026-09-07] Creado para habilitar drag-and-drop con persistencia por sucursal.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    const { data, error } = await supabase
      .from('viele_store_sort_orders')
      .select('item_code, sort_order, updated_at')
      .eq('store_id', parseInt(storeId))
      .order('sort_order', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const hasCustomOrder = Boolean(data && data.length > 0);
    const orderedCodes = (data || []).map(r => r.item_code);

    return NextResponse.json({
      success: true,
      storeId: parseInt(storeId),
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

    const numericStoreId = parseInt(storeId);
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

    const { error } = await supabase
      .from('viele_store_sort_orders')
      .delete()
      .eq('store_id', numericStoreId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      storeId: numericStoreId,
      message: `Orden personalizado de la sucursal #${numericStoreId} restablecido al orden oficial de Viele & Sons`
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
