import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'
import { getAuthToken } from '../lib/toast-api'

async function main() {
  const token = await getAuthToken()
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, name, external_id')
    .ilike('name', '%Broadway%')
    .single()

  const res = await fetch(`https://ws-api.toasttab.com/orders/v2/orders/825279bc-4ae3-425a-89fd-6d42ecabed71`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': store!.external_id! }
  })
  const ord = await res.json()
  console.log('Order #561:', JSON.stringify(ord, null, 2))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })
