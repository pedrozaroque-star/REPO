import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function checkLog() {
  const { data, count } = await supabase
    .from('inventory_usage_log')
    .select('*', { count: 'exact' })
    .limit(10)

  console.log(`📊 TOTAL REGISTROS EN INVENTORY_USAGE_LOG: ${count}`)
  if (data && data.length > 0) {
    console.log(' Muestra:', data.map(d => `${d.business_date} | Store ${d.store_id} | Item: ${d.inventory_item_id} | Usage: ${d.theoretical_usage}`))
  }
}

checkLog().catch(console.error)
