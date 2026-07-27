/**
 * Script de prueba: Ejecutar syncDailyInventoryUsage para poblar inventory_usage_log
 * con datos reales de los últimos 7 días.
 */
import { syncDailyInventoryUsage } from '../lib/inventory/usage-sync'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function testSync() {
  console.log('=== POBLANDO INVENTORY_USAGE_LOG CON DATOS REALES DE LA ÚLTIMA SEMANA ===\n')

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, external_id')
    .eq('is_active', true)

  const validStores = (stores || []).filter(s => s.external_id)
  console.log(`Tiendas activas con Toast ID: ${validStores.length}`)

  // Fechas: del 15 de julio al 21 de julio
  const dates = [
    '2026-07-15',
    '2026-07-16',
    '2026-07-17',
    '2026-07-18',
    '2026-07-19',
    '2026-07-20',
    '2026-07-21'
  ]

  let totalSynced = 0
  for (const dateStr of dates) {
    console.log(`\n📅 Procesando fecha ${dateStr}...`)
    for (const store of validStores) {
      try {
        const summary = await syncDailyInventoryUsage(store.external_id!, dateStr)
        totalSynced += summary.length
        console.log(`   ✅ ${store.name.padEnd(20)}: ${summary.length} ingredientes guardados`)
      } catch (err: any) {
        console.error(`   ❌ ${store.name.padEnd(20)}: Error - ${err.message}`)
      }
    }
  }

  console.log(`\n🎉 Sincronización completada. Total de registros en inventory_usage_log: ${totalSynced}`)

  // Verificar la tabla
  const { data: checkData, count } = await supabase
    .from('inventory_usage_log')
    .select('*', { count: 'exact' })
    .limit(5)

  console.log(`📊 Conteo total actual en DB: ${count} registros`)
  if (checkData && checkData.length > 0) {
    console.log(' Muestra de registro guardado:', JSON.stringify(checkData[0], null, 2))
  }
}

testSync().catch(console.error)
