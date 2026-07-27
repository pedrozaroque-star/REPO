import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function inspectLynwoodPmix() {
  console.log('=== INSPECCIÓN DETALLADA DE VENTAS TOAST (PMIX) EN LYNWOOD EL 21/07 ===\n')

  const storeUuid = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

  const { data: pmixRow } = await supabase
    .from('pmix_daily_cache')
    .select('business_date, store_id, pmix_data')
    .eq('store_id', storeUuid)
    .eq('business_date', '2026-07-21')
    .single()

  if (!pmixRow || !pmixRow.pmix_data) {
    console.log('❌ No se encontró PMIX en cache')
    return
  }

  const items = typeof pmixRow.pmix_data === 'string' ? JSON.parse(pmixRow.pmix_data) : pmixRow.pmix_data

  console.log(`Total platillos diferentes vendidos el 21/07: ${items.length}`)

  // Filtrar todos los items relacionados con Horchata, Jamaica, Tamarindo, Piña, Bebidas o Aguas
  const aguasSales = items.filter((i: any) => {
    const name = (i.name || '').toLowerCase()
    return name.includes('horchata') || name.includes('jamaica') || name.includes('tamarindo') || name.includes('piña') || name.includes('agua')
  })

  console.log('\n🥤 VENTAS REGISTRADAS EN TOAST POS (21/07/2026):')
  console.log('Platillo / Bebida en Toast         | Cantidad Vendida | Venta Neta ($)')
  console.log('─'.repeat(75))

  let totalHorchataQty = 0
  for (const a of aguasSales) {
    console.log(`${(a.name || '?').padEnd(35)} | ${String(a.quantity || 0).padEnd(16)} | $${(a.net_sales || 0).toFixed(2)}`)
    if (a.name.toLowerCase().includes('horchata')) {
      totalHorchataQty += (a.quantity || 0)
    }
  }

  console.log(`\n🥤 Total vasos/unidades de Horchata vendidos en Toast el 21/07: ${totalHorchataQty} unidades`)
}

inspectLynwoodPmix().catch(console.error)
