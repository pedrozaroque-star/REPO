/**
 * @module app/api/inventory/ticket-packaging-preview
 * @description Expone una vista previa auditable del consumo por ticket que depende de canal, separadores y modificadores de Toast.
 * @businessRules
 *   - Solo lee snapshots previamente sincronizados; no crea movimientos ni altera sobrantes, órdenes o PMIX.
 *   - Cubre los productos con reglas aprobadas: tacos, Taco Plates, sopes, mulitas, quesadillas, tortas, burritos, nachos, platos, desayunos y postres.
 * @dataFlow
 *   store + businessDate → toast_ticket_consumption_snapshots → ticket-packaging → totales y detalle por ticket.
 * @notes
 *   - Se mantiene separado de inventory_usage_log hasta integrar todos los grupos de productos y prevenir doble conteo contra PMIX.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { calculateTicketPackaging, type PackagingItemKey, type ToastTicketSelection } from '@/lib/inventory/ticket-packaging'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const externalStoreId = request.nextUrl.searchParams.get('storeId')
    const businessDate = request.nextUrl.searchParams.get('businessDate')
    if (!externalStoreId || !businessDate) return NextResponse.json({ error: 'storeId and businessDate are required' }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return NextResponse.json({ error: 'businessDate must use YYYY-MM-DD' }, { status: 400 })

    const db = await getSupabaseAdminClient()
    const { data: store } = await db.from('stores').select('id, name, external_id').eq('external_id', externalStoreId).maybeSingle()
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    const { data: snapshots, error } = await db
      .from('toast_ticket_consumption_snapshots')
      .select('toast_order_guid, dining_option_name, channel_metadata, selections')
      .eq('store_id', store.id)
      .eq('business_date', businessDate)
      .order('toast_order_guid')
    if (error) throw error

    const totals = new Map<PackagingItemKey, number>()
    const tickets = (snapshots || []).map(snapshot => {
      const result = calculateTicketPackaging({
        diningOptionName: snapshot.dining_option_name,
        diningOptionBehavior: snapshot.channel_metadata?.diningOption?.behavior,
        source: typeof snapshot.channel_metadata?.source === 'string' ? snapshot.channel_metadata.source : null,
        deliveryService: typeof snapshot.channel_metadata?.deliveryService === 'string' ? snapshot.channel_metadata.deliveryService : null,
        selections: Array.isArray(snapshot.selections) ? snapshot.selections as ToastTicketSelection[] : [],
      })
      for (const line of result.lines) totals.set(line.key, (totals.get(line.key) || 0) + line.quantity)
      return { toastOrderGuid: snapshot.toast_order_guid, ...result }
    })

    return NextResponse.json({
      store: { id: store.id, name: store.name, externalId: store.external_id },
      businessDate,
      scope: 'all_configured_ticket_rules',
      ticketCount: tickets.length,
      totals: Array.from(totals.entries()).map(([key, quantity]) => ({ key, quantity })),
      tickets,
      nextStep: 'Outer delivery/To Go bags remain ticket-level and require agreed capacity rules before inventory movements are written.',
    })
  } catch (error: any) {
    console.error('[TicketPackagingPreview]', error)
    return NextResponse.json({ error: error?.message || 'Unable to calculate ticket packaging preview' }, { status: 500 })
  }
}
