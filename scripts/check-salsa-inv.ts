import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function run() {
  const { data: salsas } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, purchase_unit_cost, quantity_per_unit')
    .ilike('name', '%salsa%')
  console.log('Salsa inventory items:', salsas)
}

run().catch(console.error)
