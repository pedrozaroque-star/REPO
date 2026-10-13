/**
 * @module app/api/delivery-armor/disputes/route
 * @description Endpoint para consultar expedientes de auditoría y generar el paquete de disputa (Dispute Dossier) formal.
 *
 * @businessRules
 *   - Provee información probatoria completa para DoorDash Merchant Portal y Uber Eats Manager.
 *   - Permite filtrar por tienda (ej. Slauson #7, Central #6), estado y término de búsqueda.
 *
 * @dataFlow
 *   Client Admin -> GET /api/delivery-armor/disputes?storeId=6&search=999 -> Supabase query -> formatDisputeStatement() -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { formatDisputeStatement } from '@/lib/delivery-armor'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('storeId')
    const search = searchParams.get('search')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50', 10)

    let query = supabaseAdmin
      .from('delivery_packing_audits')
      .select('*, stores(id, name, code)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (storeIdParam && storeIdParam !== 'all') {
      query = query.eq('store_id', parseInt(storeIdParam, 10))
    }

    if (status && status !== 'ALL') {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.or(`toast_display_number.ilike.%${search}%,customer_name.ilike.%${search}%,toast_order_guid.ilike.%${search}%`)
    }

    const { data: audits, error } = await query

    if (error) {
      throw new Error(`Error consultando auditorías: ${error.message}`)
    }

    const enriched = (audits || []).map(a => ({
      ...a,
      disputeStatement: formatDisputeStatement(a)
    }))

    return NextResponse.json({
      ok: true,
      audits: enriched,
      count: enriched.length
    })
  } catch (err: any) {
    console.error('Error en /api/delivery-armor/disputes:', err)
    return NextResponse.json({
      ok: false,
      error: 'Error al consultar expedientes de disputa'
    }, { status: 500 })
  }
}
