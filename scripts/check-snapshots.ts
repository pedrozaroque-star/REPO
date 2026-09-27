import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function run() {
  const { count, error } = await supabase
    .from('toast_ticket_consumption_snapshots')
    .select('*', { count: 'exact', head: true })
  console.log('Total rows in toast_ticket_consumption_snapshots:', count, 'Error:', error)

  const { data: sample } = await supabase
    .from('toast_ticket_consumption_snapshots')
    .select('store_id, business_date, dining_option_name, selections')
    .limit(3)
  console.log('Sample rows:', JSON.stringify(sample, null, 2))
}

run().catch(console.error)
