/**
 * @module audit-cohesion-engine-20261006
 * @description Auditoría reproducible del motor con snapshot real y lectura opcional Toast.
 * @businessRules No modifica DB ni publica pólizas; diferencias son hallazgos, no aprobación.
 * @dataFlow Snapshot Supabase -> motor real -> evidencia JSON; --live consulta Toast real.
 * @notes Datos históricos incompletos se identifican; fingerprints detectan edición concurrente.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { generateJournalLines, calculateExpectedCash, formatDocNumber } from '../lib/accounting-journal'
dotenv.config({ path: '.env.local', quiet: true })
const files = ['lib/accounting-journal.ts', 'lib/toast-accounting.ts']
const hashes = () => Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))
async function main() {
 const before = hashes()
 const snapshot = JSON.parse(fs.readFileSync('docs/cohesion-audit-20261006/db-snapshot.json','utf8'))
 const results = snapshot.packets.map((p:any) => {
  const m = snapshot.mappings.find((x:any)=>x.store_id === p.store_id)
  assert(m)
  const data = {...p, for_here_sales:p.dine_in_sales,to_go_sales:p.togo_sales,grubhub_delivery_sales:p.grubhub_sales,tax_paid_by_uber:p.facilitator_tax_paid,marketplace_tax:p.marketplace_facilitator_tax,cash_deposits:p.cash_deposit}
  const config = {...m,location:m.qb_location,className:m.qb_class,bank_account:m.bank_account_number,sales_tax_rate_name:m.qb_location}
  const journal = generateJournalLines(data,config)
  assert(Number.isFinite(journal.totalDebits) && Number.isFinite(journal.totalCredits))
  const name = snapshot.stores.find((s:any)=>s.id===p.store_id).name
  assert.equal(formatDocNumber(name,p.business_date),formatDocNumber(name.toLowerCase(),p.business_date))
  return {id:p.id,store:name,date:p.business_date,balanced:journal.isBalanced,expectedCash:calculateExpectedCash(data),storedExpectedCash:p.expected_cash,delta:Math.round((journal.totalDebits-p.journal_total_debits)*100)/100}
 })
 let live:any = null
 if(process.argv.includes('--live')) {
  const {fetchToastAccountingData} = await import('../lib/toast-accounting')
  const store = snapshot.stores.find((s:any)=>s.name==='Azusa') || snapshot.stores[0]
  const data = await fetchToastAccountingData(store.external_id,'20260921')
  assert(Object.values(data).filter(v=>typeof v==='number').every(Number.isFinite))
  const m = snapshot.mappings.find((x:any)=>x.store_id===store.id)
  const sd:any = {net_sales:data.netSales,total_taxes:data.totalTaxes,for_here_sales:data.forHereSales,to_go_sales:data.toGoSales,drive_thru_sales:data.driveThruSales,toast_online_sales:data.toastOnlineSales,toast_delivery_sales:data.toastDeliverySales,tips_payable:data.tipsPayable,deposits_collected:data.depositsCollected,paid_in:data.paidIn,uber_delivery_sales:data.uberDeliverySales,uber_takeout_sales:data.uberTakeoutSales,doordash_delivery_sales:data.doordashDeliverySales,doordash_takeout_sales:data.doordashTakeoutSales,grubhub_delivery_sales:data.grubhubDeliverySales,grubhub_takeout_sales:data.grubhubTakeoutSales,deferred_gift_cards:data.deferredSalesGiftCards,gift_card_redemption:data.giftCardRedemption,delivery_service_charges:data.deliveryServiceCharges,tax_paid_by_uber:data.taxPaidByUber,sales_tax:data.salesTax,marketplace_tax:data.marketplaceTax,ebt_amount:data.ebtAmount,uber_payment:data.uberPayment,doordash_payment:data.doordashPayment,grubhub_payment:data.grubhubPayment,credit_card_deposit:data.creditCardDeposit,credit_card_fees:data.creditCardFees,credit_card_other_deductions:data.creditCardOtherDeductions,cash_deposits:data.cashDeposit}
  sd.cash_deposits=calculateExpectedCash(sd)
  const journal=generateJournalLines(sd,{...m,location:m.qb_location,className:m.qb_class,bank_account:m.bank_account_number,sales_tax_rate_name:m.qb_location})
  const stored=snapshot.packets.find((p:any)=>p.store_id===store.id&&p.business_date==='2026-09-21')
  const key=(l:any)=>JSON.stringify([l.account,l.memo,l.sourceMemo,l.debit,l.credit,l.location,l.className])
  const actual=journal.lines.map(key).sort(),previous=stored.journal_lines.map(key).sort()
  live = {store:store.name,date:'2026-09-21',data,journal,storedLineDifferences:{onlyLive:actual.filter((k:string)=>!previous.includes(k)),onlyStored:previous.filter((k:string)=>!actual.includes(k))}}
 }
 const after = hashes()
 assert.deepEqual(after,before,'Source changed while audit was running')
 const output = {capturedAt:new Date().toISOString(),hashes:before,realPackets:results.length,balanced:results.filter((r:any)=>r.balanced).length,changedTotals:results.filter((r:any)=>r.delta!==0).length,results,live,limitations:['Snapshot no conserva todas las dimensiones opcionales de journal; no equivale a comparación QBO','Bordes de hora/DST no ejercitados: extractor recibe businessDate y no convierte timestamps','No se inyectaron fixtures ni mocks']}
 fs.writeFileSync('docs/cohesion-audit-20261006/engine-runtime.json',JSON.stringify(output,null,2))
 console.log(JSON.stringify({realPackets:output.realPackets,balanced:output.balanced,changedTotals:output.changedTotals,liveStore:live?.store,hashes:before}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
