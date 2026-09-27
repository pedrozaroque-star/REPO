/**
 * @module scripts/verify-ticket-channel-db
 * @description Prueba real del almacenamiento JSON de canal y limpieza del único registro de prueba.
 * @businessRules Solo usa un GUID aleatorio de prueba; no altera tickets reales ni inventario. El registro se elimina en finally.
 * @dataFlow .env.local → insert/select/update/select/delete en snapshots de Lynwood → comprobación de limpieza.
 * @notes No envía columnas generadas ni timestamps; prueba exactamente los campos atómicos del endpoint.
 */
import dotenv from 'dotenv'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
dotenv.config({ path: '.env.local', quiet: true })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
async function run() {
  const { data: store, error } = await db.from('stores').select('id').eq('external_id', '80a1ec95-bc73-402e-8884-e5abbe9343e6').single()
  if (error) throw error
  const guid = `channel-smoke-${randomUUID()}`
  const metadata = { diningOption: { name: 'DoorDash - Takeout', behavior: 'TAKE_OUT' }, source: 'API', deliveryService: null }
  try {
    const inserted = await db.from('toast_ticket_consumption_snapshots').insert({ store_id: store.id, toast_order_guid: guid, business_date: '2026-09-22', selections: [], channel_metadata: metadata }).select('channel_metadata').single()
    if (inserted.error) throw inserted.error
    if (inserted.data.channel_metadata.diningOption.behavior !== 'TAKE_OUT') throw new Error('JSON insert verification failed')
    const updated = await db.from('toast_ticket_consumption_snapshots').update({ dining_option_name: 'DoorDash - Takeout' }).eq('store_id', store.id).eq('toast_order_guid', guid).select('dining_option_name').single()
    if (updated.error) throw updated.error
    if (updated.data.dining_option_name !== 'DoorDash - Takeout') throw new Error('Update verification failed')
  } finally {
    const cleanup = await db.from('toast_ticket_consumption_snapshots').delete().eq('store_id', store.id).eq('toast_order_guid', guid)
    if (cleanup.error) throw cleanup.error
    const remaining = await db.from('toast_ticket_consumption_snapshots').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('toast_order_guid', guid)
    if (remaining.error) throw remaining.error
    if (remaining.count !== 0) throw new Error('Test row cleanup verification failed')
  }
  console.log('Live DB insert/read/update/delete passed; test row removed.')
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })
