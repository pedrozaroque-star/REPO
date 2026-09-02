import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function debug() {
  const { data: sales } = await supabaseAdmin.from('sales_daily_cache').select('store_id, business_date').limit(5)
  const { data: mappings } = await supabaseAdmin.from('accounting_site_mappings').select('store_id, qb_location')
  
  console.log('Sales sample store_id type & values:', sales?.map(s => ({ id: s.store_id, type: typeof s.store_id, date: s.business_date })))
  console.log('Mappings store_id type & values:', mappings?.map(m => ({ id: m.store_id, type: typeof m.store_id, loc: m.qb_location })))
}

debug()
