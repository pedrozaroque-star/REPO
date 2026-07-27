import { createClient } from '@supabase/supabase-js'
import { syncDailyInventoryUsage } from '../lib/inventory/usage-sync'
import { calculateDailyOrder, fetchWeeklyData, fetchAllInventoryItems } from '../app/inventory/orders/actions'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function testLynwoodFixed() {
  console.log('=== SIMULACIÓN EXHAUSTIVA CORREGIDA DE LYNWOOD (21/07/2026) ===\n')

  const storeUuid = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
  const dateStr = '2026-07-21'

  // 1. Re-sincronizar el log de consumo de Lynwood
  await syncDailyInventoryUsage(storeUuid, dateStr)

  // 2. Cargar datos semanales
  const mondayStr = '2026-07-20'
  const weeklyData = await fetchWeeklyData(14, mondayStr)
  const items = await fetchAllInventoryItems()

  // Mapear items a OrderableItems
  const orderableItems = items.map(i => ({
    id: i.id,
    name: i.name,
    unit_type: i.unit_type || 'Unit',
    excel_reference: i.excel_reference || i.name,
    order_unit_description: '',
    order_rounding_rule: 'none'
  }))

  // 3. Ejecutar calculateDailyOrder para Lynwood el 21/07
  const lines = await calculateDailyOrder(
    14,
    dateStr,
    orderableItems,
    weeklyData.bases,
    weeklyData.counts,
    mondayStr,
    weeklyData.parIdeal
  )

  // Filtrar productos clave (Horchata, Jamaica, Piña, Asada, Pastor, Pollo, Frijol, Arroz)
  const keyProducts = ['horchata', 'jamaica', 'piña', 'asada', 'pastor', 'pollo', 'arroz', 'frijol']
  const filtered = lines.filter(l => keyProducts.some(kp => l.item_name.toLowerCase().includes(kp)))

  console.log('📦 RESULTADOS CALCULADOS EN PANTALLA (21/07/2026):')
  console.log('Producto                       | PAR Mañana | Sugerido | Sobrante Real | Varianza | Pedir')
  console.log('─'.repeat(95))

  for (const f of filtered) {
    console.log(`${f.item_name.padEnd(30)} | ${String(f.par_value).padEnd(10)} | ${String(f.suggested_leftover ?? '—').padEnd(8)} | ${String(f.leftover_value ?? '—').padEnd(13)} | ${String(f.variance ?? '—').padEnd(8)} | ${f.calculated_qty}`)
  }
}

testLynwoodFixed().catch(console.error)
