import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function inspectStoreId() {
  const { data: stores } = await supabase.from('stores').select('*').eq('name', 'Lynwood')
  console.log('Tienda Lynwood:', stores)

  const { data: pmixRows } = await supabase
    .from('pmix_daily_cache')
    .select('store_id, business_date')
    .eq('business_date', '2026-07-21')

  console.log('\nstore_ids en pmix_daily_cache para 2026-07-21:', pmixRows)
}

inspectStoreId().catch(console.error)
