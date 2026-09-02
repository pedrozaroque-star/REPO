import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function checkGL() {
  const { data } = await supabaseAdmin
    .from('accounting_gl_accounts')
    .select('account_number, account_name, qb_account_id')
    .order('account_number', { ascending: true })

  console.log(`Total accounts: ${data?.length}`)
  for (const a of data || []) {
    console.log(`${a.account_number.padEnd(8)} | ${a.account_name.padEnd(30)} | QB ID: ${a.qb_account_id ? '#' + a.qb_account_id : '—'}`)
  }
}

checkGL()
