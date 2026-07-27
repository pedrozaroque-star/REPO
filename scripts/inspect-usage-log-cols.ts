import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function inspectColumns() {
  const { data, error } = await supabase
    .from('inventory_usage_log')
    .select('*')
    .limit(1)

  if (error) console.error('Error:', error.message)
  else console.log('Columnas de inventory_usage_log:', data)
}

inspectColumns().catch(console.error)
