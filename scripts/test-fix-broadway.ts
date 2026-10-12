import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'
import { generateJournalLines, calculateExpectedCash } from '../lib/accounting-journal'

async function main() {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, name')
    .ilike('name', '%Broadway%')
    .single()

  const { data: mapping } = await supabaseAdmin
    .from('accounting_site_mappings')
    .select('*')
    .eq('store_id', store!.id)
    .single()

  const siteMappingConfig = {
    location: mapping.qb_location || 'Broadway LA',
    className: mapping.qb_class || 'Broadway LA',
    bank_account: mapping.bank_account_number || '10010',
    sales_dine_in_account: mapping.sales_dine_in_account || '40050',
    sales_uber_account: mapping.sales_uber_account || '40060',
    sales_doordash_account: mapping.sales_doordash_account || '40062',
    sales_grubhub_account: mapping.sales_grubhub_account || '40063',
    sales_tax_account: mapping.sales_tax_account || '24001',
    sales_tax_rate_name: 'Broadway LA',
    ar_uber_account: mapping.ar_uber_account || '12050',
    ar_doordash_account: mapping.ar_doordash_account || '12053',
    ar_grubhub_account: mapping.ar_grubhub_account || '12054',
    cc_fees_account: mapping.cc_fees_account || '51030',
    cash_over_short_account: mapping.cash_over_short_account || '51050',
    undeposited_funds_account: mapping.undeposited_funds_account || '13200',
    gift_card_account: mapping.gift_card_account || '20500',
    open_orders_account: mapping.open_orders_account || '12049',
    tips_account: mapping.tips_account || '12100',
    cogs_account: mapping.cogs_account || '50006',
  }

  const salesData: any = {
    for_here_sales: 7196.37,
    to_go_sales: 10439.81,
    toast_online_sales: 318.73,
    uber_delivery_sales: 1694.28,
    uber_takeout_sales: 64.42,
    doordash_takeout_sales: 28.07,
    doordash_delivery_sales: 1981.12,
    grubhub_delivery_sales: 95.15,
    grubhub_takeout_sales: 32.96,
    net_sales: 21850.91,
    gross_sales: 22029.19,
    sales_tax: 1631.44,
    marketplace_tax: 219.10,
    tax_paid_by_uber: 142.20,
    deferred_gift_cards: 65.00,
    tips_payable: 9.23,
    paid_in: 0,
    ebt_amount: 2032.53,
    uber_payment: 1900.90,
    doordash_payment: 2215.15,
    grubhub_payment: 141.25,
    deposits_collected: 0,
    credit_card_deposit: 11031.01,
    credit_card_fees: 212.24,
    credit_card_other_deductions: 0,
    cash_deposits: 0,
    cash_payouts: [],
    cash_payouts_total: 0,
  }

  const expCash = calculateExpectedCash(salesData)
  const result = generateJournalLines(salesData, siteMappingConfig)

  console.log('Expected Cash calculated:', expCash, 'Cohesion says: 6384.80')
  console.log('Total Debits:', result.totalDebits, 'Total Credits:', result.totalCredits, 'Cohesion says: 23917.88')
  console.log('Over/Short line:', result.lines.find(l => l.account === '51050'))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })
