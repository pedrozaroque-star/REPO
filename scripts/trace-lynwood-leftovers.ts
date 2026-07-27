import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function traceLynwood() {
  console.log('=== AUDITORÍA MATEMÁTICA LYNWOOD (HORCHATA Y ASADA) 20/07 Y 21/07 ===\n')

  const storeId = 14 // Lynwood
  const storeUuid = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

  // Buscar ID de Horchata y Carne Asada
  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, name')
    .or('name.ilike.%horchata%,name.ilike.%carne asada%')

  const horchata = items?.find(i => i.name.toLowerCase().includes('horchata'))
  const asada = items?.find(i => i.name.toLowerCase().includes('asada'))

  console.log(`Horchata ID: ${horchata?.id}`)
  console.log(`Asada ID: ${asada?.id}\n`)

  // 1. Sobrantes contados el 20/07 y 21/07
  const { data: counts } = await supabase
    .from('inventory_counts')
    .select('*')
    .eq('store_id', '14')
    .in('count_date', ['2026-07-20', '2026-07-21'])
    .in('inventory_item_id', [horchata?.id, asada?.id])

  console.log('📦 SOBRANTES CONTADOS (inventory_counts):')
  counts?.forEach(c => {
    const itemName = c.inventory_item_id === horchata?.id ? 'Horchata' : 'Carne Asada'
    console.log(`   Fecha: ${c.count_date} | ${itemName} | Sobrante Real Contado: ${c.quantity_on_hand}`)
  })

  // 2. Órdenes generadas el 20/07 (que llegaron el 21/07 AM) vs generadas el 21/07 (que llegan el 22/07 AM)
  const { data: orders } = await supabase
    .from('inventory_orders')
    .select('id, order_date, status, inventory_order_lines(inventory_item_id, final_qty, calculated_qty)')
    .eq('store_id', 14)
    .in('order_date', ['2026-07-20', '2026-07-21'])

  console.log('\n🚚 ÓRDENES PEDIDAS A BODEGA (inventory_orders):')
  orders?.forEach(o => {
    console.log(`   Orden ID: ${o.id} | Fecha Pedido: ${o.order_date} | Status: ${o.status}`)
    const horchataLine = o.inventory_order_lines?.find((l: any) => l.inventory_item_id === horchata?.id)
    const asadaLine = o.inventory_order_lines?.find((l: any) => l.inventory_item_id === asada?.id)
    if (horchataLine) console.log(`      -> Horchata Pedida para entregar al día siguiente: ${horchataLine.final_qty || horchataLine.calculated_qty}`)
    if (asadaLine) console.log(`      -> Carne Asada Pedida para entregar al día siguiente: ${asadaLine.final_qty || asadaLine.calculated_qty}`)
  })

  // 3. Consumo Teórico en Toast (inventory_usage_log) el 21/07
  const { data: usageLog } = await supabase
    .from('inventory_usage_log')
    .select('*')
    .eq('store_id', storeUuid)
    .eq('business_date', '2026-07-21')
    .in('inventory_item_id', [horchata?.id, asada?.id])

  console.log('\n📊 CONSUMO TEÓRICO VENDIDO EN TOAST EL 21/07 (inventory_usage_log):')
  usageLog?.forEach(u => {
    const itemName = u.inventory_item_id === horchata?.id ? 'Horchata' : 'Carne Asada'
    console.log(`   ${itemName} | Consumo Teórico Toast (PMIX): ${u.theoretical_usage} gal/bolsas`)
  })
}

traceLynwood().catch(console.error)
