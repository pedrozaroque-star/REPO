import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'
import { fetchToastAccountingData } from '../lib/toast-accounting'

async function main() {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, name, external_id')
    .ilike('name', '%Broadway%')
    .single()

  const data = await fetchToastAccountingData(store!.external_id!, '20261009')
  console.log('depositsCollected:', data.depositsCollected)
  console.log('openOrdersCount:', data.openOrdersCount)
  console.log('openOrdersList:', data.openOrdersList)
  console.log('tipsPayable:', data.tipsPayable)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })
