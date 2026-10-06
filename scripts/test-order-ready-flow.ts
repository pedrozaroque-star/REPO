import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function testApi() {
  console.log('--- Testing Order Ready Board Endpoints ---')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // 1. Direct simulation via Supabase Admin
  const { supabaseAdmin } = await import('../lib/supabase')
  
  console.log('1. Inserting simulated order #271 (TOGO)...')
  const { data: ord, error: insErr } = await supabaseAdmin.from('order_ready_announcements').insert({
    store_code: 'LYNWOOD',
    store_id: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
    store_name: 'Lynwood',
    order_number: '271',
    dining_option: 'TOGO',
    customer_name: 'Cliente Lynwood',
    status: 'READY',
    ready_at: new Date().toISOString(),
    announced: false
  }).select().single()

  if (insErr) {
    console.error('Error inserting:', insErr)
    process.exit(1)
  }
  console.log('Inserted order:', ord.id, 'Number:', ord.order_number, 'Status:', ord.status)

  // 2. Querying orders
  console.log('2. Querying active orders for LYNWOOD...')
  const { data: rows, error: qErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .select('*')
    .eq('store_code', 'LYNWOOD')
    .eq('status', 'READY')

  if (qErr) {
    console.error('Query error:', qErr)
    process.exit(1)
  }
  console.log('Found ready orders:', rows.length)

  // 3. Cleanup
  console.log('3. Cleaning up test order...')
  await supabaseAdmin.from('order_ready_announcements').delete().eq('id', ord.id)
  console.log('Cleanup complete! All tests passed.')
}

testApi().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
