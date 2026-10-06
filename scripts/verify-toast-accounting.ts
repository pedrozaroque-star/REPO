import dotenv from 'dotenv'
import path from 'path'
import { fetchToastAccountingData } from '../lib/toast-accounting'
import { supabaseAdmin } from '../lib/supabase'
import { generateJournalLines, calculateExpectedCash, formatDocNumber } from '../lib/accounting-journal'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function verify() {
  const { data: packet, error } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('*, stores!inner(name)')
    .ilike('stores.name', '%Bell%')
    .eq('business_date', '2026-10-03')
    .single()

  if (error) console.error(error)
  console.log('Bell 2026-10-03 packet:\n', JSON.stringify(packet, null, 2))
}

verify().catch(console.error)

