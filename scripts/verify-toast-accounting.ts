import dotenv from 'dotenv'
import path from 'path'
import { fetchToastAccountingData } from '../lib/toast-accounting'
import { supabaseAdmin } from '../lib/supabase'
import { generateJournalLines, calculateExpectedCash, formatDocNumber } from '../lib/accounting-journal'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function verify() {
  const lynwoodExtId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
  console.log('Fetching Lynwood for 2026-09-08...')
  const data = await fetchToastAccountingData(lynwoodExtId, '20260908')
  console.log('Toast Accounting Granular Data for Lynwood:\n', JSON.stringify(data, null, 2))

  const { data: mapping } = await supabaseAdmin
    .from('accounting_site_mappings')
    .select('*, stores!inner(id, name, external_id)')
    .eq('stores.external_id', lynwoodExtId)
    .single()

  if (!mapping) throw new Error('Mapping not found for Lynwood')

  const salesPacketData = {
    net_sales: data.netSales,
    total_taxes: data.totalTaxes,
    for_here_sales: data.forHereSales,
    to_go_sales: data.toGoSales,
    drive_thru_sales: data.driveThruSales,
    toast_online_sales: data.toastOnlineSales,
    uber_delivery_sales: data.uberDeliverySales,
    uber_takeout_sales: data.uberTakeoutSales,
    doordash_takeout_sales: data.doordashTakeoutSales,
    doordash_delivery_sales: data.doordashDeliverySales,
    grubhub_delivery_sales: data.grubhubDeliverySales,
    grubhub_takeout_sales: data.grubhubTakeoutSales,
    deferred_gift_cards: data.deferredSalesGiftCards,
    gift_card_redemption: data.giftCardRedemption,
    delivery_service_charges: data.deliveryServiceCharges,
    tax_paid_by_uber: data.taxPaidByUber,
    sales_tax: data.salesTax,
    marketplace_tax: data.marketplaceTax,
    ebt_amount: data.ebtAmount,
    uber_payment: data.uberPayment,
    doordash_payment: data.doordashPayment,
    grubhub_payment: data.grubhubPayment,
    credit_card_deposit: data.creditCardDeposit,
    credit_card_fees: data.creditCardFees,
    credit_card_other_deductions: data.creditCardOtherDeductions,
    cash_deposits: data.cashDeposit,
  }

  const siteConfig = {
    location: mapping.qb_location,
    className: mapping.qb_class,
    bank_account: mapping.bank_account_number,
    sales_tax_rate_name: mapping.qb_location,
  }

  const journal = generateJournalLines(salesPacketData, siteConfig)
  const expectedCash = calculateExpectedCash(salesPacketData)
  const docNumber = formatDocNumber('Lynwood', '2026-09-08')
  const cashOverShort = Math.round((salesPacketData.cash_deposits - expectedCash) * 100) / 100

  console.log('\n--- VERIFICATION WITH COHESION ---')
  console.log('Expected Cash:', expectedCash, '(Cohesion: 3487.32)')
  console.log('Cash Deposit:', salesPacketData.cash_deposits, '(Cohesion: 3487.32)')
  console.log('Cash Over/(Short):', cashOverShort, '(Cohesion: 0.00)')
  console.log('Debits:', journal.totalDebits, '| Credits:', journal.totalCredits, '(Cohesion: 14181.57)')
  console.log('Is Balanced:', journal.isBalanced)
  console.log('Lines count:', journal.lines.length)
  console.log('\nAll Journal Lines:')
  journal.lines.forEach((l, i) => {
    console.log(`${i+1}. [${l.account}] ${l.memo.padEnd(32)} Debit: ${l.debit.toFixed(2).padStart(8)} | Credit: ${l.credit.toFixed(2).padStart(8)}`)
  })

  // Update packet in Supabase
  const { data: packet } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('id')
    .eq('store_id', mapping.store_id)
    .eq('business_date', '2026-09-08')
    .maybeSingle()

  if (packet) {
    const { error: updateErr } = await supabaseAdmin
      .from('accounting_sales_packets')
      .update({
        net_sales: data.netSales,
        gross_sales: data.grossSales,
        total_taxes: data.totalTaxes,
        dine_in_sales: data.forHereSales,
        togo_sales: data.toGoSales,
        uber_delivery_sales: data.uberDeliverySales,
        uber_takeout_sales: data.uberTakeoutSales,
        doordash_takeout_sales: data.doordashTakeoutSales,
        doordash_delivery_sales: data.doordashDeliverySales,
        grubhub_sales: data.grubhubDeliverySales + data.grubhubTakeoutSales,
        sales_tax: data.salesTax,
        marketplace_facilitator_tax: data.marketplaceTax,
        facilitator_tax_paid: data.taxPaidByUber,
        credit_card_deposit: data.creditCardDeposit,
        credit_card_fees: data.creditCardFees,
        uber_payment: data.uberPayment,
        doordash_payment: data.doordashPayment,
        grubhub_payment: data.grubhubPayment,
        ebt_amount: data.ebtAmount,
        expected_cash: expectedCash,
        cash_deposit: data.cashDeposit,
        cash_over_short: cashOverShort,
        journal_lines: journal.lines,
        journal_total_debits: journal.totalDebits,
        journal_total_credits: journal.totalCredits,
        status: 'ready',
        qb_doc_number: docNumber,
        notes: 'Recalculado con paridad 100% Cohesion (Gift Cards, Drive Thru, Service Charges, MCA)',
      })
      .eq('id', packet.id)

    if (updateErr) console.error('Error updating packet in Supabase:', updateErr)
    else console.log('\n✅ Paquete actualizado exitosamente en Supabase para Lynwood 09/08/2026!')
  }
}

verify().catch(console.error)

