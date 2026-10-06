import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'

async function testMutation() {
  console.log('Testing insert into order_ready_announcements...')
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .insert({
      store_id: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
      store_code: 'LYNWOOD',
      store_name: 'Lynwood',
      order_number: '999',
      dining_option: 'TOGO',
      customer_name: 'Test Customer',
      status: 'READY'
    })
    .select()
    .single()

  if (insErr) {
    console.error('Insert failed:', insErr)
    process.exit(1)
  }
  console.log('Insert succeeded, id:', inserted.id)

  console.log('Testing cleanup (delete)...')
  const { error: delErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .delete()
    .eq('id', inserted.id)

  if (delErr) {
    console.error('Delete failed:', delErr)
    process.exit(1)
  }
  console.log('Cleanup succeeded! Live DB Mutation Smoke Test PASSED.')
}

testMutation().catch(err => {
  console.error('Test error:', err)
  process.exit(1)
})
