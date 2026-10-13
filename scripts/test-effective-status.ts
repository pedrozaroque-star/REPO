/**
 * Test script to verify effectiveStatus calculation for accounting calendar grid
 */

function getEffectiveStatus(packet: any): string {
  if (!packet) return 'pending'
  if (packet.status === 'published') return 'published'
  if (packet.status === 'rejected') return 'rejected'

  const val = packet.qb_sync_response?.validation
  const hasOpenOrders = Boolean(
    val?.hasOpenOrders ||
    (val?.openOrdersCount && val.openOrdersCount > 0) ||
    (val?.outOfBalanceOrdersCount && val.outOfBalanceOrdersCount > 0) ||
    packet.has_open_orders
  )
  if (hasOpenOrders) return 'open_orders'

  const cashDeposit = Number(packet.cash_deposit ?? 0)
  const expectedCash = Number(packet.expected_cash ?? val?.expected_cash_deposit ?? 0)
  const isDepositPending = Boolean(val?.isDepositPending || (cashDeposit === 0 && expectedCash > 0))
  if (isDepositPending) return 'pending_deposit'

  if (packet.status === 'reviewed') return 'reviewed'
  if (packet.status === 'ready') return 'ready'
  return packet.status || 'pending'
}

console.log('--- RUNNING EFFECTIVE STATUS SIMULATION TESTS ---')

// Case 1: Null packet
const test1 = getEffectiveStatus(null)
console.log('Test 1 (null packet):', test1, test1 === 'pending' ? '✅ PASS' : '❌ FAIL')

// Case 2: Monday 10/12 Lynwood - Ready in DB, but cash_deposit is 0 and expected_cash is 1331.72
const mondayPacket = {
  status: 'ready',
  cash_deposit: 0,
  expected_cash: 1331.72,
  qb_sync_response: {
    validation: {
      passed: true,
      hasOpenOrders: false,
      openOrdersCount: 0,
      isDepositPending: true,
      expected_cash_deposit: 1331.72,
    }
  }
}
const test2 = getEffectiveStatus(mondayPacket)
console.log('Test 2 (Monday Lynwood pending deposit):', test2, test2 === 'pending_deposit' ? '✅ PASS' : '❌ FAIL')

// Case 3: Tuesday Central with open orders left by cashier
const openOrderPacket = {
  status: 'ready',
  cash_deposit: 0,
  expected_cash: 5000,
  qb_sync_response: {
    validation: {
      passed: true,
      hasOpenOrders: true,
      openOrdersCount: 2,
      isDepositPending: true,
    }
  }
}
const test3 = getEffectiveStatus(openOrderPacket)
console.log('Test 3 (Store with open orders):', test3, test3 === 'open_orders' ? '✅ PASS' : '❌ FAIL')

// Case 4: Balanced store with deposit recorded
const balancedReadyPacket = {
  status: 'ready',
  cash_deposit: 1331.72,
  expected_cash: 1331.72,
  qb_sync_response: {
    validation: {
      passed: true,
      hasOpenOrders: false,
      openOrdersCount: 0,
      isDepositPending: false,
    }
  }
}
const test4 = getEffectiveStatus(balancedReadyPacket)
console.log('Test 4 (Ready and deposited):', test4, test4 === 'ready' ? '✅ PASS' : '❌ FAIL')

// Case 5: Already published to QuickBooks Online
const publishedPacket = {
  status: 'published',
  cash_deposit: 1331.72,
  expected_cash: 1331.72,
  qb_sync_response: {
    validation: { passed: true, hasOpenOrders: false }
  }
}
const test5 = getEffectiveStatus(publishedPacket)
console.log('Test 5 (Published):', test5, test5 === 'published' ? '✅ PASS' : '❌ FAIL')

// Case 6: Reviewed by accountant
const reviewedPacket = {
  status: 'reviewed',
  cash_deposit: 1331.72,
  expected_cash: 1331.72,
}
const test6 = getEffectiveStatus(reviewedPacket)
console.log('Test 6 (Reviewed):', test6, test6 === 'reviewed' ? '✅ PASS' : '❌ FAIL')

console.log('--- ALL SIMULATIONS COMPLETE ---')
