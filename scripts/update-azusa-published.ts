import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function updateAzusa() {
  await supabaseAdmin
    .from('accounting_sales_packets')
    .update({
      status: 'published',
      qb_journal_entry_id: '572551',
      published_at: new Date().toISOString(),
    })
    .eq('id', '83fd5b90-3a06-4723-9843-30b3e2883e7b')

  console.log('Azusa packet updated to published!')
}

updateAzusa()
