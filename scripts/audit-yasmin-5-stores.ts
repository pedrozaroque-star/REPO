import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'
import { getAuthToken } from '../lib/toast-api'
import { fetchToastAccountingData } from '../lib/toast-accounting'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function main() {
  const storeNames = ['Broadway', 'Hollywood', 'Huntington Park', 'Slauson', 'West Covina']
  const targetDate = '2026-10-09'
  const targetDateYMD = '20261009'
  const token = await getAuthToken()

  console.log(`\n===============================================================`)
  console.log(`AUDITING YASMIN'S 5 STORES FOR ${targetDate}`)
  console.log(`===============================================================\n`)

  for (const name of storeNames) {
    console.log(`\n--- STORE: ${name} ---`)
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id, name, external_id')
      .ilike('name', `%${name}%`)
      .single()

    if (!store) {
      console.log(`Store ${name} not found!`)
      continue
    }

    // 1. Toast Deposits
    const depRes = await fetch(`${TOAST_API_HOST}/cashmgmt/v1/deposits?businessDate=${targetDateYMD}`, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id! }
    })
    const rawDeps = depRes.ok ? await depRes.json() : []

    // 2. Toast Entries (Payouts)
    const entRes = await fetch(`${TOAST_API_HOST}/cashmgmt/v1/entries?businessDate=${targetDateYMD}`, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id! }
    })
    const rawEntries = entRes.ok ? await entRes.json() : []
    const payouts = Array.isArray(rawEntries) ? rawEntries.filter((e: any) => e.type === 'PAY_OUT') : []

    // 3. fetchToastAccountingData
    const toastData = await fetchToastAccountingData(store.external_id!, targetDateYMD)

    // 4. Supabase DB packet
    const { data: packet } = await supabaseAdmin
      .from('accounting_sales_packets')
      .select('*')
      .eq('store_id', store.id)
      .eq('business_date', targetDate)
      .maybeSingle()

    console.log(`Toast Raw Deposits Count:`, rawDeps.length, rawDeps)
    console.log(`Toast Raw Payouts Count:`, payouts.length, payouts.map((p: any) => ({ amount: p.amount, date: p.date, reason: p.reason })))
    console.log(`ToastAccountingData:`)
    console.log(`  netSales:`, toastData.netSales)
    console.log(`  grossSales:`, toastData.grossSales)
    console.log(`  toastDepositAmount:`, toastData.toastDepositAmount)
    console.log(`  hasToastDeposit:`, toastData.hasToastDeposit)
    console.log(`  cashPayoutsTotal:`, toastData.cashPayoutsTotal)
    console.log(`  openOrdersCount:`, toastData.openOrdersCount)
    console.log(`DB Packet:`)
    console.log(`  status:`, packet?.status)
    console.log(`  net_sales:`, packet?.net_sales)
    console.log(`  expected_cash:`, packet?.expected_cash)
    console.log(`  cash_deposit:`, packet?.cash_deposit)
    console.log(`  cash_over_short:`, packet?.cash_over_short)
    console.log(`  debits:`, packet?.journal_total_debits, `credits:`, packet?.journal_total_credits)
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
