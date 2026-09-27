/**
 * @module scripts/audit-lynwood-ticket-packaging
 * @description Auditoría de solo lectura para validar snapshots de prueba de Lynwood contra el motor de empaque por ticket.
 * @businessRules No crea movimientos, no sincroniza Toast y no modifica órdenes ni sobrantes.
 * @dataFlow Supabase stores/snapshots → ticket-packaging → resumen seguro para auditoría.
 * @notes Se usa únicamente como smoke test de datos reales antes de habilitar kardex.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { calculateTicketPackaging, type ToastTicketSelection } from '../lib/inventory/ticket-packaging'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Supabase environment variables are unavailable')
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

async function run() {
  const { data: stores, error: storeError } = await supabase.from('stores').select('id, name, external_id').ilike('name', '%lynwood%').limit(2)
  if (storeError) throw storeError
  if (!stores?.length) throw new Error('Lynwood store not found')
  const store = stores[0]
  const { data: snapshots, error } = await supabase.from('toast_ticket_consumption_snapshots')
    .select('business_date, toast_order_guid, dining_option_name, channel_metadata, selections')
    .eq('store_id', store.id).eq('business_date', '2026-09-22').order('toast_order_guid').limit(1000)
  if (error) throw error
  if (!snapshots?.length) {
    const { data: pmixDates, error: pmixError } = await supabase.from('pmix_daily_cache')
      .select('business_date').eq('store_id', store.external_id).order('business_date', { ascending: false }).limit(10)
    if (pmixError) throw pmixError
    console.log(JSON.stringify({
      store: store.name,
      externalStoreId: store.external_id,
      snapshots: 0,
      recentPmixBusinessDates: (pmixDates || []).map(row => row.business_date),
      nextAction: 'Run the ticket snapshot sync for one of these closed business dates; this creates operational snapshots only and does not change inventory usage or orders.',
    }, null, 2))
    return
  }
  const totals = new Map<string, number>()
  const dates = new Set<string>()
  let recognizedTickets = 0
  let warnings = 0
  const unrecognized = new Map<string, number>()
  const channels = new Map<string, number>()
  const packagingChannels = new Map<string, number>()
  const rawChannelContexts = new Map<string, number>()
  const channelEvidence = new Map<string, number>()
  for (const snapshot of snapshots) {
    dates.add(snapshot.business_date)
    const result = calculateTicketPackaging({ diningOptionName: snapshot.dining_option_name, diningOptionBehavior: snapshot.channel_metadata?.diningOption?.behavior, source: snapshot.channel_metadata?.source, deliveryService: snapshot.channel_metadata?.deliveryService, selections: snapshot.selections as ToastTicketSelection[] })
    if (result.recognizedSelections > 0) recognizedTickets++
    channels.set(result.channel, (channels.get(result.channel) || 0) + 1)
    packagingChannels.set(result.packagingChannel, (packagingChannels.get(result.packagingChannel) || 0) + 1)
    const context = snapshot.dining_option_name || '(empty)'
    const evidence = JSON.stringify(snapshot.channel_metadata)
    channelEvidence.set(evidence, (channelEvidence.get(evidence) || 0) + 1)
    rawChannelContexts.set(context, (rawChannelContexts.get(context) || 0) + 1)
    warnings += result.warnings.length
    for (const selection of snapshot.selections as ToastTicketSelection[]) {
      const name = selection.name || '(sin nombre)'
      if (name && !result.recognizedSelections) unrecognized.set(name, (unrecognized.get(name) || 0) + (Number(selection.quantity) || 1))
    }
    for (const line of result.lines) totals.set(line.key, (totals.get(line.key) || 0) + line.quantity)
  }
  console.log(JSON.stringify({ store: store.name, dates: [...dates], snapshots: snapshots.length, recognizedTickets, warnings, channels: Object.fromEntries(channels), rawChannelContexts: Array.from(rawChannelContexts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20), totals: Object.fromEntries(totals), unrecognizedTicketSelections: Array.from(unrecognized.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25) }, null, 2))
  console.log('Channel evidence:', JSON.stringify(Array.from(channelEvidence.entries())))
  console.log('Packaging channels:', JSON.stringify(Object.fromEntries(packagingChannels)))
}

run().catch(error => { console.error(error.message); process.exitCode = 1 })
