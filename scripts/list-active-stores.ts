import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function run() {
  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, external_id, is_active')
    .eq('is_active', true)
    .order('id')
  console.log('Active stores:', stores)
}

run().catch(console.error)
