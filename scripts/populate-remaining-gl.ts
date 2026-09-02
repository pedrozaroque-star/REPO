import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function populateRemaining() {
  const updates = [
    { num: '24001', id: '140984' }, // Sales Tax Payable
    { num: '40060', id: '140989' }, // Sales - Uber Eats
    { num: '40062', id: '140990' }, // Sales - DoorDash
    { num: '40063', id: '140991' }, // Sales - GrubHub
  ]

  for (const u of updates) {
    await supabaseAdmin
      .from('accounting_gl_accounts')
      .update({ qb_account_id: u.id })
      .eq('account_number', u.num)
  }

  console.log('✅ Cuentas restantes actualizadas con éxito.')
}

populateRemaining()
