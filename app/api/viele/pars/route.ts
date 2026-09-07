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
      .from('viele_store_pars')
      .select('item_code, par_quantity, updated_at')
      .eq('store_id', parseInt(storeId));

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const parsMap: Record<string, number> = {};
    (data || []).forEach(row => {
      parsMap[row.item_code] = Number(row.par_quantity) || 0;
    });

    return NextResponse.json({ success: true, storeId: parseInt(storeId), count: Object.keys(parsMap).length, pars: parsMap });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { storeId, pars } = body;

    if (!storeId || !pars || typeof pars !== 'object') {
      return NextResponse.json({ success: false, error: 'storeId and pars object are required' }, { status: 400 });
    }

    const updates = Object.entries(pars).map(([item_code, par_quantity]) => ({
      store_id: parseInt(storeId),
      item_code,
      par_quantity: Number(par_quantity) || 0,
      updated_at: new Date().toISOString()
    }));

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
