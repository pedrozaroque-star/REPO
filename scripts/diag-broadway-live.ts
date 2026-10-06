import { supabaseAdmin } from '../lib/supabase'
import { fetchToastAccountingData } from '../lib/toast-accounting'

async function main() {
  const ext = '475bc112-187d-4b9c-884d-1f6a041698ce'
  const d: any = await fetchToastAccountingData(ext, '20261002')
  const { openOrdersList, ...rest } = d
  console.log('LIVE fetchToastAccountingData:', rest)
  const { data } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('id,status,net_sales,credit_card_deposit,credit_card_fees,expected_cash,cash_deposit,journal_total_debits,updated_at')
    .eq('store_id', 5).eq('business_date', '2026-10-02').maybeSingle()
  console.log('PACKET en DB:', data)
}
main().catch(e => { console.error(e); process.exit(1) })
