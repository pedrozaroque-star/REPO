import { fetchToastAccountingData } from '../lib/toast-accounting'
import { generateJournalLines, calculateExpectedCash, type SalesPacketData } from '../lib/accounting-journal'

async function main() {
  const d: any = await fetchToastAccountingData('475bc112-187d-4b9c-884d-1f6a041698ce', '20261003')
  const s: SalesPacketData = {
    net_sales: d.netSales, total_taxes: d.totalTaxes, for_here_sales: d.forHereSales, to_go_sales: d.toGoSales,
    drive_thru_sales: d.driveThruSales, toast_online_sales: d.toastOnlineSales, toast_delivery_sales: d.toastDeliverySales, tips_payable: d.tipsPayable,
    uber_delivery_sales: d.uberDeliverySales, uber_takeout_sales: d.uberTakeoutSales, doordash_takeout_sales: d.doordashTakeoutSales,
    doordash_delivery_sales: d.doordashDeliverySales, grubhub_delivery_sales: d.grubhubDeliverySales, grubhub_takeout_sales: d.grubhubTakeoutSales,
    deferred_gift_cards: d.deferredSalesGiftCards, gift_card_redemption: d.giftCardRedemption, delivery_service_charges: d.deliveryServiceCharges,
    tax_paid_by_uber: d.taxPaidByUber, sales_tax: d.salesTax, marketplace_tax: d.marketplaceTax, ebt_amount: d.ebtAmount,
    uber_payment: d.uberPayment, doordash_payment: d.doordashPayment, grubhub_payment: d.grubhubPayment,
    credit_card_deposit: d.creditCardDeposit, credit_card_fees: d.creditCardFees, credit_card_other_deductions: d.creditCardOtherDeductions, cash_deposits: 0,
  }
  s.cash_deposits = calculateExpectedCash(s)
  const j = generateJournalLines(s, { location: 'Broadway LA', className: 'Broadway LA', bank_account: '10010', sales_tax_rate_name: 'Broadway LA' })
  for (const l of j.lines) console.log(l.account.padEnd(6), l.memo.padEnd(32), l.debit.toFixed(2).padStart(10), l.credit.toFixed(2).padStart(10))
  console.log('TOTALES', j.totalDebits, j.totalCredits, 'balanceada=', j.isBalanced)

  // Valores esperados de la pantalla de Cohesion (captura del usuario)
  const exp: Record<string, number> = {
    'For Here|c': 8869.03, 'Toast Online|c': 61.44, 'To Go|c': 10563.39, 'Toast Delivery Services|c': 26.78,
    'Tips/Grat Payable|c': 3.0, 'Credit Card Deposit|d': 10991.86, 'Credit Card Fees|d': 200.88,
    'Credit Card Other Deductions|d': 12.49, 'Deposit To Bank|d': 9374.21, 'Sales Tax|c': 1911.97,
  }
  let bad = 0
  for (const k of Object.keys(exp)) {
    const [memo, side] = k.split('|')
    const line = j.lines.find(l => l.memo === memo)
    const v = line ? (side === 'c' ? line.credit : line.debit) : NaN
    const ok = Math.abs(v - exp[k]) < 0.005
    if (!ok) bad++
    console.log(ok ? 'OK ' : 'XX ', memo, v, 'esperado', exp[k])
  }
  console.log('Totales Cohesion esperado: 26743.90 -> ', j.totalDebits === 26743.9 && j.totalCredits === 26743.9 ? 'OK' : 'XX', '| fallos:', bad)
}
main().catch(e => { console.error(e); process.exit(1) })
