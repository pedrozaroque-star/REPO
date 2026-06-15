import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  console.log('Querying all stores...')
  const { data: stores, error } = await supabase
    .from('stores')
    .select('id, name, external_id')
    .order('id')

  if (error) {
    console.error('Error:', error)
    return
  }

  for (const s of stores || []) {
    console.log(`- ID: ${s.id} | Name: ${s.name} | External ID (UUID): ${s.external_id}`)
  }
}

run()
