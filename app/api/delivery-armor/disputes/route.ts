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
import { autoExpireUnclaimedAudits, formatDisputeStatement, getBusinessDateYmdLA } from '@/lib/delivery-armor'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('storeId')
    const search = searchParams.get('search')
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = parseInt(searchParams.get('limit') || '5000', 10)

    const parsedStoreId = storeIdParam && storeIdParam !== 'all' ? parseInt(storeIdParam, 10) : undefined
    await autoExpireUnclaimedAudits(parsedStoreId)

    const PAGE_SIZE = 1000
    const allAudits: any[] = []
    let offset = 0

    while (allAudits.length < limit) {
      const batchLimit = Math.min(PAGE_SIZE, limit - allAudits.length)
      let query = supabaseAdmin
        .from('delivery_packing_audits')
        .select('*, stores(id, name, code)')
        .order('created_at', { ascending: false })
        .range(offset, offset + batchLimit - 1)

      if (parsedStoreId) {
        query = query.eq('store_id', parsedStoreId)
      }

      if (status && status !== 'ALL') {
        query = query.eq('status', status)
      }

      if (search) {
        query = query.or(`toast_display_number.ilike.%${search}%,customer_name.ilike.%${search}%,toast_order_guid.ilike.%${search}%`)
      }

      const { data: batch, error } = await query

      if (error) {
        throw new Error(`Error consultando auditorías: ${error.message}`)
      }

      if (!batch || batch.length === 0) break
      allAudits.push(...batch)
      if (batch.length < batchLimit) break
      offset += batch.length
    }

    const enriched = allAudits
      .map(a => {
        const businessDate = getBusinessDateYmdLA(a.created_at || a.order_opened_at)
        return {
          ...a,
          business_date: businessDate,
          disputeStatement: formatDisputeStatement(a)
        }
      })
      .filter(a => {
        if (startDate && startDate !== 'ALL' && a.business_date < startDate) return false
        if (endDate && endDate !== 'ALL' && a.business_date > endDate) return false
        return true
      })

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
