/**
 * @module api/viele/pars
 * @description Endpoint para consultar y actualizar niveles base de inventario (PAR)
 *              por sucursal para los insumos de Viele & Sons.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan
 * - Cada tienda tiene sus propios PARs configurados.
 * - Solo administradores o supervisores autorizados pueden actualizar los PARs.
 *
 * @dataFlow
 * - GET: viele_store_pars filtrado por store_id
 * - PUT: upsert a viele_store_pars con store_id e item_code
 * @notes PAR requiere enteros no negativos y SKU perteneciente a la membresía de la sucursal; no redondea entradas.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyVieleAuth } from '@/lib/viele-auth';
import { parseVieleNonnegativeInteger, parseVieleStoreId } from '@/lib/viele-catalog-validation';

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
      .from('viele_store_pars')
      .select('item_code, par_quantity, updated_at')
      .eq('store_id', numericStoreId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const parsMap: Record<string, number> = {};
    (data || []).forEach(row => {
      parsMap[row.item_code] = Number(row.par_quantity) || 0;
    });

    return NextResponse.json({ success: true, storeId: numericStoreId, count: Object.keys(parsMap).length, pars: parsMap });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { storeId, pars } = body;

    if (!storeId || !pars || typeof pars !== 'object' || Array.isArray(pars) || Object.keys(pars).length === 0) {
      return NextResponse.json({ success: false, error: 'storeId and pars object are required' }, { status: 400 });
    }

    const numericStoreId = parseVieleStoreId(storeId);
    if (numericStoreId === null) return NextResponse.json({ success: false, error: 'storeId inválido' }, { status: 400 });

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req, { requiredStoreId: numericStoreId });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    const nowIso = new Date().toISOString();
    const updates: { store_id: number; item_code: string; par_quantity: number; updated_at: string }[] = [];
    const { data: membership, error: membershipError } = await supabase
      .from('viele_store_sort_orders').select('item_code').eq('store_id', numericStoreId);
    if (membershipError) return NextResponse.json({ success: false, error: membershipError.message }, { status: 500 });
    const allowedCodes = new Set((membership || []).map(row => row.item_code.trim().toUpperCase()));
    const seenCodes = new Set<string>();

    // Validación numérica estricta: rechazar negativos, Infinity, NaN o valores no numéricos
    for (const [item_code, par_raw] of Object.entries(pars)) {
      const code = item_code.trim().toUpperCase();
      const numVal = parseVieleNonnegativeInteger(par_raw);
      if (numVal === null || !allowedCodes.has(code) || seenCodes.has(code)) {
        return NextResponse.json({
          success: false,
          error: `PAR inválido para ${item_code}: requiere un entero no negativo y un SKU único de la sucursal.`
        }, { status: 400 });
      }
      seenCodes.add(code);

      updates.push({
        store_id: numericStoreId,
        item_code: code,
        par_quantity: numVal,
        updated_at: nowIso
      });
    }

    const { error } = await supabase
      .from('viele_store_pars')
      .upsert(updates, { onConflict: 'store_id,item_code' });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, updatedCount: updates.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
