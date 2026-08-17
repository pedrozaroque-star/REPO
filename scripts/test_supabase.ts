import { getSupabaseAdminClient } from '../lib/supabase'

async function check() {
  const supabase = await getSupabaseAdminClient()
  console.log('Testing stores table...')
  const { data: stores, error: errStores } = await supabase.from('stores').select('id, name').limit(3)
  console.log('Stores:', stores, 'Error:', errStores)

  console.log('Testing suppliers table...')
  const { data: suppliers, error: errSuppliers } = await supabase.from('suppliers').select('id, name').limit(5)
  console.log('Suppliers:', suppliers, 'Error:', errSuppliers)
}

check()
















