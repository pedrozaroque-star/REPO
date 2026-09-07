/**
 * @module api/viele/catalog
 * @description Endpoint para consultar el catálogo maestro de 89 productos de Viele & Sons.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan
 * - Solo devuelve artículos activos (is_active = true)
 * - Orden predeterminado: sort_order ASC
 *
 * @dataFlow
 * - Supabase: SELECT * FROM viele_items WHERE is_active = true ORDER BY sort_order ASC
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

    const { data, error } = await dbQuery;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: data?.length || 0, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
