import { createClient } from '@supabase/supabase-js'
import { syncDailyInventoryUsage } from '../lib/inventory/usage-sync'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function resyncAllWithDbStoreId() {
  console.log('=== RESINCRONIZANDO INVENTORY_USAGE_LOG CON NUMERIC STORE_ID ===\n')

  const { data: stores } = await supabase.from('stores').select('id, name, external_id').eq('is_active', true)
  if (!stores) return

  const dates = ['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21']

  for (const dateStr of dates) {
    console.log(`📅 Fecha ${dateStr}...`)
    for (const store of stores) {
      if (!store.external_id) continue
      try {
        await syncDailyInventoryUsage(store.id.toString(), dateStr)
      } catch (err: any) {
        console.error(`Error en tienda ${store.name}: ${err.message}`)
      }
    }
  }

  console.log('\n🎉 Resincronización completada con éxito.')
}

resyncAllWithDbStoreId().catch(console.error)
