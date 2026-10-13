import { supabaseAdmin } from '../lib/supabase'

async function checkOct12Packets() {
  const { data: packets, error } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('id, store_id, business_date, status, net_sales, cash_deposit, expected_cash, qb_sync_response, stores!inner(name)')
    .eq('business_date', '2026-10-12')
    .order('store_id')

  if (error) {
    console.error('Error fetching packets:', error)
    return
  }

  console.log(`Found ${packets?.length || 0} packets for 2026-10-12:\n`)

  let openOrdersFound = 0
  let pendingDepositsFound = 0

  for (const p of packets || []) {
    const storeName = (p.stores as any)?.name || `Store #${p.store_id}`
    const val = p.qb_sync_response?.validation
    const hasOpenOrders = Boolean(
      val?.hasOpenOrders || 
      (val?.openOrdersCount && val.openOrdersCount > 0) || 
      (val?.outOfBalanceOrdersCount && val.outOfBalanceOrdersCount > 0)
    )
    const openOrdersCount = val?.openOrdersCount || 0
    const outOfBalanceCount = val?.outOfBalanceOrdersCount || 0
    const openOrders = val?.openOrders || []

    const cashDep = Number(p.cash_deposit ?? 0)
    const expCash = Number(p.expected_cash ?? val?.expected_cash_deposit ?? 0)
    const isDepositPending = Boolean(val?.isDepositPending || (cashDep === 0 && expCash > 0))

    if (hasOpenOrders) openOrdersFound++
    if (isDepositPending) pendingDepositsFound++

    console.log(`--------------------------------------------------`)
    console.log(`Store: ${storeName}`)
    console.log(`Status in DB: ${p.status}`)
    console.log(`Net Sales: $${Number(p.net_sales || 0).toFixed(2)}`)
    console.log(`Expected Cash: $${expCash.toFixed(2)} | Cash Deposit: $${cashDep.toFixed(2)}`)
    console.log(`Deposit Pending?: ${isDepositPending ? '⚠️ SÍ (PENDING DEPOSIT)' : '✅ NO'}`)
    console.log(`Has Open Orders?: ${hasOpenOrders ? '⚠️ SÍ (OPEN ORDERS)' : '✅ NO'}`)
    
    if (hasOpenOrders) {
      console.log(`  -> Open Orders Count: ${openOrdersCount}`)
      console.log(`  -> Out of Balance Count: ${outOfBalanceCount}`)
      if (openOrders.length > 0) {
        console.log(`  -> Orders Detail:`)
        for (const o of openOrders) {
          console.log(`     * Order #${o.orderNumber || o.orderId} | Server: ${o.serverName} | Total: $${o.totalAmount} | Status: ${o.status} | Reason: ${o.reason}`)
        }
      }
    }
  }

  console.log(`\n==================================================`)
  console.log(`TOTALS FOR 2026-10-12:`)
  console.log(`Total Packets: ${packets?.length || 0}`)
  console.log(`Packets with Open Orders: ${openOrdersFound}`)
  console.log(`Packets with Pending Deposit: ${pendingDepositsFound}`)
  console.log(`==================================================`)
}

checkOct12Packets()
