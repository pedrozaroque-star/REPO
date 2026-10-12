import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'
import { fetchToastAccountingData } from '../lib/toast-accounting'
import { generateJournalLines, formatDocNumber, calculateExpectedCash } from '../lib/accounting-journal'

async function main() {
  const storeName = 'Broadway'
  const date = '2026-10-09'
  const targetDateYMD = '20261009'

  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, name, external_id')
    .ilike('name', `%${storeName}%`)
    .single()

  if (!store || !store.external_id) {
    throw new Error('Store not found')
  }

  console.log(`Recalculating ${store.name} for ${date}...`)
  const toastData = await fetchToastAccountingData(store.external_id, targetDateYMD)

  const { data: mapping } = await supabaseAdmin
    .from('accounting_site_mappings')
    .select('*')
    .eq('store_id', store.id)
    .single()

  const siteMappingConfig = {
    location: mapping?.qb_location || `${storeName} LA`,
    className: mapping?.qb_class || `${storeName} LA`,
    bank_account: mapping?.bank_account_number || '10010',
    sales_dine_in_account: mapping?.sales_dine_in_account || '40050',
    sales_uber_account: mapping?.sales_uber_account || '40060',
    sales_doordash_account: mapping?.sales_doordash_account || '40062',
    sales_grubhub_account: mapping?.sales_grubhub_account || '40063',
    sales_tax_account: mapping?.sales_tax_account || '24001',
    sales_tax_rate_name: mapping?.sales_tax_rate_name || 'Broadway LA',
    ar_uber_account: mapping?.ar_uber_account || '12050',
    ar_doordash_account: mapping?.ar_doordash_account || '12053',
    ar_grubhub_account: mapping?.ar_grubhub_account || '12054',
    cc_fees_account: mapping?.cc_fees_account || '51030',
    cash_over_short_account: mapping?.cash_over_short_account || '51050',
    undeposited_funds_account: mapping?.undeposited_funds_account || '13200',
    gift_card_account: mapping?.gift_card_account || '20500',
    open_orders_account: mapping?.open_orders_account || '12049',
    tips_account: mapping?.tips_account || '12100',
    cogs_account: mapping?.cogs_account || '50006',
  }

  const cashDeposits = toastData.hasToastDeposit ? toastData.toastDepositAmount : 0
  const salesDataForJournal: any = {
    for_here_sales: toastData.forHereSales,
    to_go_sales: toastData.toGoSales,
    drive_thru_sales: toastData.driveThruSales,
    kiosk_dine_in_sales: toastData.kioskDineInSales,
    kiosk_takeout_sales: toastData.kioskTakeOutSales,
    toast_online_sales: toastData.toastOnlineSales,
    toast_delivery_sales: toastData.toastDeliverySales,
    uber_delivery_sales: toastData.uberDeliverySales,
    uber_takeout_sales: toastData.uberTakeoutSales,
    doordash_takeout_sales: toastData.doordashTakeoutSales,
    doordash_delivery_sales: toastData.doordashDeliverySales,
    grubhub_delivery_sales: toastData.grubhubDeliverySales,
    grubhub_takeout_sales: toastData.grubhubTakeoutSales,
    delivery_service_charges: toastData.deliveryServiceCharges,
    gross_sales: toastData.grossSales,
    net_sales: toastData.netSales,
    sales_tax: toastData.salesTax,
    marketplace_tax: toastData.marketplaceTax,
    tax_paid_by_uber: toastData.taxPaidByUber,
    deferred_gift_cards: toastData.deferredSalesGiftCards,
    gift_card_redemption: toastData.giftCardRedemption,
    tips_payable: toastData.tipsPayable,
    deposits_collected: toastData.depositsCollected,
    paid_in: toastData.paidIn,
    credit_card_deposit: toastData.creditCardDeposit,
    credit_card_fees: toastData.creditCardFees,
    credit_card_other_deductions: toastData.creditCardOtherDeductions,
    uber_payment: toastData.uberPayment,
    doordash_payment: toastData.doordashPayment,
    grubhub_payment: toastData.grubhubPayment,
    ebt_amount: toastData.ebtAmount,
    cash_deposits: cashDeposits,
    cash_payouts: toastData.toastCashPayoutsList,
    cash_payouts_total: toastData.cashPayoutsTotal,
  }

  const expectedCashFromSales = calculateExpectedCash(salesDataForJournal)
  const expectedCashDeposit = Math.round((expectedCashFromSales - toastData.cashPayoutsTotal) * 100) / 100
  const cashOverShort = Math.round((cashDeposits - expectedCashDeposit) * 100) / 100

  const journalResult = generateJournalLines(salesDataForJournal, siteMappingConfig)

  console.log('Results:')
  console.log('  Net Sales:', toastData.netSales)
  console.log('  Gross Sales:', toastData.grossSales)
  console.log('  Expected Cash:', expectedCashFromSales)
  console.log('  Cash Deposit:', cashDeposits)
  console.log('  Cash Over/Short:', cashOverShort)
  console.log('  Open Orders Count:', toastData.openOrdersCount)
  console.log('  Total Debits:', journalResult.totalDebits, 'Total Credits:', journalResult.totalCredits)
  console.log('  Balanced:', journalResult.isBalanced)

  // Update in DB
  const docNumber = formatDocNumber(store.name, date)
  const packetData: any = {
    store_id: store.id,
    business_date: date,
    status: 'ready',
    dine_in_sales: toastData.forHereSales,
    togo_sales: toastData.toGoSales,
    uber_delivery_sales: toastData.uberDeliverySales,
    uber_takeout_sales: toastData.uberTakeoutSales,
    doordash_delivery_sales: toastData.doordashDeliverySales,
    doordash_takeout_sales: toastData.doordashTakeoutSales,
    grubhub_sales: Math.round((toastData.grubhubDeliverySales + toastData.grubhubTakeoutSales) * 100) / 100,
    gross_sales: toastData.grossSales,
    net_sales: toastData.netSales,
    total_discounts: toastData.discountsTotal,
    sales_tax: toastData.salesTax,
    marketplace_facilitator_tax: toastData.marketplaceTax,
    facilitator_tax_paid: toastData.taxPaidByUber,
    total_taxes: toastData.totalTaxes,
    total_credit_cards_gross: toastData.creditCardGross,
    credit_card_deposit: toastData.creditCardDeposit,
    credit_card_fees: toastData.creditCardFees,
    uber_payment: toastData.uberPayment,
    doordash_payment: toastData.doordashPayment,
    grubhub_payment: toastData.grubhubPayment,
    ebt_amount: toastData.ebtAmount,
    expected_cash: expectedCashDeposit,
    cash_deposit: cashDeposits,
    cash_over_short: cashOverShort,
    journal_total_debits: journalResult.totalDebits,
    journal_total_credits: journalResult.totalCredits,
    journal_lines: journalResult.lines,
    qb_doc_number: docNumber,
    qb_sync_response: {
      sales_gross_by_option: toastData.salesGrossByOption,
      discounts_breakdown: toastData.discountBreakdown,
      cards_breakdown: toastData.cardBreakdown,
      open_orders_list: toastData.openOrdersList,
      open_orders_count: toastData.openOrdersCount,
      out_of_balance_orders_count: toastData.outOfBalanceOrdersCount,
      cash_payouts_list: toastData.toastCashPayoutsList,
      cash_payouts_total: toastData.cashPayoutsTotal,
      toast_deposits_list: toastData.toastDepositsList,
      has_toast_deposit: toastData.hasToastDeposit,
      validation: {
        passed: journalResult.isBalanced,
        has_open_orders: toastData.hasOpenOrders,
        tips_payable: toastData.tipsPayable,
        deferred_sales_gift_cards: toastData.deferredSalesGiftCards,
        paid_in: toastData.paidIn,
        deposits_collected: toastData.depositsCollected,
        credit_card_other_deductions: toastData.creditCardOtherDeductions,
      }
    }
  }

  const { error: upsertErr } = await supabaseAdmin
    .from('accounting_sales_packets')
    .upsert(packetData, { onConflict: 'store_id,business_date' })

  if (upsertErr) {
    console.error('Upsert error:', upsertErr)
  } else {
    console.log('Successfully updated Broadway packet in Supabase!')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })
