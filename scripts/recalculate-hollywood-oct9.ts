import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'
import { fetchToastAccountingData } from '../lib/toast-accounting'
import { generateJournalLines, calculateExpectedCash, formatDocNumber } from '../lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '../lib/accounting-journal'

async function main() {
  console.log('--- RECALCULATING HOLLYWOOD FOR 2026-10-09 ---')

  // 1. Get store & mapping
  const { data: mapping } = await supabaseAdmin
    .from('accounting_site_mappings')
    .select('*, stores!inner(id, name, external_id)')
    .ilike('stores.name', '%Hollywood%')
    .single()

  if (!mapping) throw new Error('Hollywood mapping not found')
  console.log('Store:', (mapping.stores as any)?.name, 'extId:', (mapping.stores as any)?.external_id)

  const extId = (mapping.stores as any)?.external_id
  const dateStr = '2026-10-09'
  const dateYMD = '20261009'

  // 2. Fetch fresh Toast data
  const toastData = await fetchToastAccountingData(extId, dateYMD)
  console.log('\n--- TOAST DATA EXTRACTED ---')
  console.log('Net Sales:', toastData.netSales)
  console.log('Gross Sales:', toastData.grossSales)
  console.log('Delivery Service Charges:', toastData.deliveryServiceCharges)
  console.log('Discounts Total:', toastData.discountsTotal)
  console.log('Total Taxes:', toastData.totalTaxes)
  console.log('Cash Payouts Total:', toastData.cashPayoutsTotal)
  console.log('Toast Cash Payouts List:', JSON.stringify(toastData.toastCashPayoutsList, null, 2))

  // 3. Build sales packet data
  const salesPacketData: SalesPacketData = {
    net_sales: toastData.netSales,
    total_taxes: toastData.totalTaxes,
    for_here_sales: toastData.forHereSales,
    to_go_sales: toastData.toGoSales,
    drive_thru_sales: toastData.driveThruSales,
    kiosk_dine_in_sales: toastData.kioskDineInSales,
    kiosk_takeout_sales: toastData.kioskTakeOutSales,
    toast_online_sales: toastData.toastOnlineSales,
    toast_delivery_sales: toastData.toastDeliverySales,
    tips_payable: toastData.tipsPayable,
    deposits_collected: toastData.depositsCollected,
    paid_in: toastData.paidIn,
    uber_delivery_sales: toastData.uberDeliverySales,
    uber_takeout_sales: toastData.uberTakeoutSales,
    doordash_takeout_sales: toastData.doordashTakeoutSales,
    doordash_delivery_sales: toastData.doordashDeliverySales,
    grubhub_delivery_sales: toastData.grubhubDeliverySales,
    grubhub_takeout_sales: toastData.grubhubTakeoutSales,
    deferred_gift_cards: toastData.deferredSalesGiftCards,
    gift_card_redemption: toastData.giftCardRedemption,
    delivery_service_charges: toastData.deliveryServiceCharges,
    tax_paid_by_uber: toastData.taxPaidByUber,
    sales_tax: toastData.salesTax,
    marketplace_tax: toastData.marketplaceTax,
    ebt_amount: toastData.ebtAmount,
    uber_payment: toastData.uberPayment,
    doordash_payment: toastData.doordashPayment,
    grubhub_payment: toastData.grubhubPayment,
    credit_card_deposit: toastData.creditCardDeposit,
    credit_card_fees: toastData.creditCardFees,
    credit_card_other_deductions: toastData.creditCardOtherDeductions,
    cash_deposits: 0,
    cash_payouts: toastData.toastCashPayoutsList,
    cash_payouts_total: toastData.cashPayoutsTotal,
  }

  const siteConfig: SiteMappingConfig = {
    location: mapping.qb_location,
    className: mapping.qb_class,
    bank_account: mapping.bank_account_number,
    sales_tax_rate_name: mapping.qb_location,
    sales_dine_in_account: mapping.sales_dine_in_account,
    sales_uber_account: mapping.sales_uber_account,
    sales_doordash_account: mapping.sales_doordash_account,
    sales_grubhub_account: mapping.sales_grubhub_account,
    sales_tax_account: mapping.sales_tax_account,
    ar_uber_account: mapping.ar_uber_account,
    ar_doordash_account: mapping.ar_doordash_account,
    ar_grubhub_account: mapping.ar_grubhub_account,
    ar_postmates_account: mapping.ar_postmates_account,
    cc_fees_account: mapping.cc_fees_account,
    undeposited_funds_account: mapping.undeposited_funds_account,
    cash_over_short_account: mapping.cash_over_short_account,
    gift_card_account: mapping.gift_card_account,
    open_orders_account: mapping.open_orders_account,
    cash_on_hand_account: mapping.cash_on_hand_account,
    tips_account: mapping.tips_account,
    cogs_account: mapping.cogs_account,
  }

  const expectedCashFromSales = calculateExpectedCash(salesPacketData)
  const cashPayoutsTotal = salesPacketData.cash_payouts_total || 0
  const expectedCashDeposit = Math.round((expectedCashFromSales - cashPayoutsTotal) * 100) / 100

  const finalDeposit = toastData.hasToastDeposit && toastData.toastDepositAmount > 0
    ? toastData.toastDepositAmount
    : 0
  salesPacketData.cash_deposits = finalDeposit

  const journal = generateJournalLines(salesPacketData, siteConfig)
  const docNumber = formatDocNumber((mapping.stores as any)?.name.replace(/^Tacos Gavilan\s+/i, '').trim(), dateStr)

  console.log('\n--- JOURNAL CALCULATION ---')
  console.log('Expected Cash From Sales:', expectedCashFromSales, '(Target Cohesion: 3536.67)')
  console.log('Cash Payouts Total:', cashPayoutsTotal, '(Target Cohesion: 86.00)')
  console.log('Expected Cash Deposit:', expectedCashDeposit, '(Target Cohesion: 3450.67)')
  console.log('Deposit To Bank:', finalDeposit, '(Target Cohesion: 0.00)')
  console.log('Cash Over/(Short):', Math.round((finalDeposit - expectedCashDeposit) * 100) / 100, '(Target Cohesion: -3450.67)')
  console.log('Journal Total Debits:', journal.totalDebits, '(Target Cohesion: 17692.92)')
  console.log('Journal Total Credits:', journal.totalCredits, '(Target Cohesion: 17692.92)')
  console.log('Is Balanced:', journal.isBalanced)

  console.log('\n--- JOURNAL LINES ---')
  for (const l of journal.lines) {
    console.log(`${l.account.padEnd(6)} | ${l.memo.padEnd(50)} | Deb: ${l.debit.toFixed(2).padStart(8)} | Cred: ${l.credit.toFixed(2).padStart(8)}`)
  }

  // Update in DB
  const validationInfo = {
    passed: journal.isBalanced,
    isDepositPending: finalDeposit === 0 && expectedCashDeposit > 0,
    hasOpenOrders: toastData.hasOpenOrders,
    openOrdersCount: toastData.openOrdersCount,
    outOfBalanceOrdersCount: toastData.outOfBalanceOrdersCount,
    openOrders: toastData.openOrdersList,
    checkedAt: new Date().toISOString(),
    message: journal.isBalanced ? 'Packet was Updated and Passed All Validation' : 'Unbalanced Journal Entry',
    discount_breakdown: toastData.discountBreakdown || {},
    card_breakdown: toastData.cardBreakdown || {},
    sales_gross_by_option: toastData.salesGrossByOption || {},
    deposits_collected: toastData.depositsCollected || 0,
    paid_in: toastData.paidIn || 0,
    deposit_source: finalDeposit > 0 ? 'toast' : 'pending',
    toast_deposits: toastData.toastDepositsList || [],
    expected_cash_from_sales: expectedCashFromSales,
    cash_payouts_total: cashPayoutsTotal,
    cash_payouts: salesPacketData.cash_payouts || [],
    expected_cash_deposit: expectedCashDeposit,
  }

  const grossSalesAmount = Math.round(((salesPacketData.net_sales || 0) + (toastData.discountsTotal || 0)) * 100) / 100

  const packetData = {
    store_id: mapping.store_id,
    business_date: dateStr,
    status: journal.isBalanced ? 'ready' : 'pending',
    dine_in_sales: salesPacketData.for_here_sales,
    togo_sales: salesPacketData.to_go_sales,
    uber_delivery_sales: salesPacketData.uber_delivery_sales,
    uber_takeout_sales: salesPacketData.uber_takeout_sales,
    doordash_delivery_sales: salesPacketData.doordash_delivery_sales,
    doordash_takeout_sales: salesPacketData.doordash_takeout_sales,
    grubhub_sales: Math.round(((salesPacketData.grubhub_delivery_sales || 0) + (salesPacketData.grubhub_takeout_sales || 0)) * 100) / 100,
    gross_sales: grossSalesAmount,
    net_sales: salesPacketData.net_sales,
    total_discounts: toastData.discountsTotal || 0,
    sales_tax: salesPacketData.sales_tax,
    marketplace_facilitator_tax: salesPacketData.marketplace_tax,
    facilitator_tax_paid: salesPacketData.tax_paid_by_uber,
    total_taxes: salesPacketData.total_taxes,
    total_credit_cards_gross: Math.round((salesPacketData.credit_card_deposit + salesPacketData.credit_card_fees + (salesPacketData.credit_card_other_deductions || 0)) * 100) / 100,
    credit_card_deposit: salesPacketData.credit_card_deposit,
    credit_card_fees: salesPacketData.credit_card_fees,
    uber_payment: salesPacketData.uber_payment,
    doordash_payment: salesPacketData.doordash_payment,
    grubhub_payment: salesPacketData.grubhub_payment,
    ebt_amount: salesPacketData.ebt_amount,
    expected_cash: expectedCashDeposit,
    cash_deposit: salesPacketData.cash_deposits,
    cash_over_short: Math.round((salesPacketData.cash_deposits - expectedCashDeposit) * 100) / 100,
    journal_total_debits: journal.totalDebits,
    journal_total_credits: journal.totalCredits,
    journal_lines: journal.lines,
    qb_doc_number: docNumber,
    notes: validationInfo.message,
    qb_sync_response: {
      validation: validationInfo,
      discount_breakdown: toastData.discountBreakdown || {},
      card_breakdown: toastData.cardBreakdown || {},
      sales_gross_by_option: toastData.salesGrossByOption || {},
      deposit_source: finalDeposit > 0 ? 'toast' : 'pending',
      toast_deposits: toastData.toastDepositsList || [],
      cash_payouts: salesPacketData.cash_payouts || [],
      cash_payouts_total: cashPayoutsTotal,
      expected_cash_from_sales: expectedCashFromSales,
      expected_cash_deposit: expectedCashDeposit,
    },
    updated_at: new Date().toISOString(),
  }

  const { error: upsertErr } = await supabaseAdmin
    .from('accounting_sales_packets')
    .upsert(packetData, { onConflict: 'store_id, business_date' })

  if (upsertErr) console.error('DB Upsert error:', upsertErr)
  else console.log('\n✅ DB SUCCESS: Packet upserted successfully!')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
