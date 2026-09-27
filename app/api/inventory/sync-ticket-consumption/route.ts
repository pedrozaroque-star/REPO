/**
 * @module app/api/inventory/sync-ticket-consumption
 * @description Sincroniza tickets individuales de Toast para calcular consumo y empaques por orden.
 * @businessRules
 *   - Requiere autorización de cron cuando CRON_SECRET está configurado.
 *   - Conserva canal, selecciones y modificadores; no reemplaza PMIX ni genera movimientos de inventario.
 *   - Excluye órdenes/checks anulados.
 * @dataFlow
 *   Toast ordersBulk → normalización de selecciones → toast_ticket_consumption_snapshots.
 * @notes
 *   - Los snapshots alimentan la vista de empaque por ticket; los movimientos se activarán cuando termine la conciliación con PMIX para evitar doble conteo.
 *   - [2026-09-23] Toast requiere el prefijo `Bearer ` en ordersBulk; omitirlo causaba 401 aunque el login fuera exitoso.
 *   - Los GUID de diningOption se resuelven con el catálogo de la tienda. Se guardan solo campos de canal, sin direcciones ni datos de clientes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const toastHost = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function getToken() {
  const response = await fetch(`${toastHost}/authentication/v1/authentication/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.TOAST_CLIENT_ID, clientSecret: process.env.TOAST_CLIENT_SECRET, userAccessType: 'TOAST_MACHINE_CLIENT' }),
  })
  if (!response.ok) throw new Error(`Toast authentication failed (${response.status})`)
  return (await response.json()).token.accessToken as string
}

export async function GET(request: NextRequest) {
  try {
  if (process.env.CRON_SECRET && request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const businessDate = request.nextUrl.searchParams.get('businessDate')
  const externalStoreId = request.nextUrl.searchParams.get('storeId')
  if (!businessDate || !externalStoreId) return NextResponse.json({ error: 'businessDate and storeId are required' }, { status: 400 })

  const db = await getSupabaseAdminClient()
  const { data: store } = await db.from('stores').select('id, external_id').eq('external_id', externalStoreId).maybeSingle()
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  const token = await getToken()
  const optionsResponse = await fetch(`${toastHost}/config/v2/diningOptions`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': externalStoreId },
  })
  if (!optionsResponse.ok) throw new Error(`Toast dining options failed (${optionsResponse.status})`)
  const diningOptions = await optionsResponse.json() as Array<{ guid: string; name: string; behavior?: string }>
  if (!Array.isArray(diningOptions)) throw new Error('Invalid Toast dining options response')
  const diningOptionMap = new Map(diningOptions.map(option => [option.guid, option]))
  const snapshots: Record<string, unknown>[] = []
  for (let page = 1; ; page++) {
    const response = await fetch(`${toastHost}/orders/v2/ordersBulk?businessDate=${businessDate.replaceAll('-', '')}&pageSize=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': externalStoreId },
    })
    if (!response.ok) throw new Error(`Toast orders failed (${response.status})`)
    const orders = await response.json() as any[]
    if (!Array.isArray(orders) || orders.length === 0) break
    for (const order of orders) {
      if (order.voided || !order.guid) continue
      const selections = (order.checks || []).filter((check: any) => !check.voided).flatMap((check: any) =>
        (check.selections || []).filter((selection: any) => !selection.voided).map((selection: any) => ({
          guid: selection.item?.guid, name: selection.displayName, quantity: Number(selection.quantity || 1),
          modifiers: (selection.modifiers || []).filter((modifier: any) => !modifier.voided).map((modifier: any) => ({ guid: modifier.item?.guid, name: modifier.displayName, quantity: Number(modifier.quantity || 1) })),
        })))
      const diningOption = diningOptionMap.get(order.diningOption?.guid)
      const diningOptionName = diningOption?.name || order.diningOption?.name || null
      const serviceValue = order.deliveryInfo?.deliveryService?.name || order.deliveryService?.name || order.deliveryService
      const deliveryService = typeof serviceValue === 'string' ? serviceValue : null
      const channelMetadata = {
        diningOption: { guid: order.diningOption?.guid || null, name: diningOptionName, behavior: diningOption?.behavior || null },
        source: order.source || null,
        deliveryService,
      }
      const channelContext = diningOptionName
      snapshots.push({ store_id: store.id, business_date: businessDate, toast_order_guid: order.guid, dining_option_name: channelContext, channel_metadata: channelMetadata, selections, source_opened_at: order.openedDate || null, synced_at: new Date().toISOString() })
    }
    if (orders.length < 100) break
  }
  const { error } = await db.from('toast_ticket_consumption_snapshots').upsert(snapshots, { onConflict: 'store_id,toast_order_guid' })
  if (error) throw error
  return NextResponse.json({ synced: snapshots.length, businessDate, storeId: externalStoreId })
  } catch (error: any) {
    console.error('[SyncTicketConsumption]', error)
    return NextResponse.json({ error: error?.message || 'Unable to synchronize Toast ticket snapshots' }, { status: 500 })
  }
}
