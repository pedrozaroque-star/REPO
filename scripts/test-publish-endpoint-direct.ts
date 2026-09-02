/**
 * Probar la ruta de publicación oficial en una póliza
 * Run via: npx tsx scripts/test-publish-endpoint-direct.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testEndpoint() {
  const { data: packets } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('id, business_date, status, stores(name)')
    .eq('status', 'ready')
    .limit(3)

  console.log('Publishable packets found in DB:', packets)

  if (!packets || packets.length === 0) {
    console.log('No ready packets to publish.')
    return
  }

  const target = packets[0]
  console.log(`\nPublishing packet for ${(target.stores as any)?.name} (${target.business_date})...`)

  const res = await fetch(`http://localhost:3000/api/accounting/packets/${target.id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ performed_by: 'Carlos (Test)' })
  })

  console.log('HTTP Status:', res.status, res.statusText)
  const json = await res.json()
  console.log('Response JSON:\n', JSON.stringify(json, null, 2))
}

testEndpoint().catch(console.error)
