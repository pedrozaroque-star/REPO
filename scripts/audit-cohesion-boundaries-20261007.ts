/**
 * @module audit-cohesion-boundaries-20261007
 * @description Simulaciones de bordes del calendario operativo y entradas no finitas sobre el motor real.
 * @businessRules No usa mocks ni modifica bases de datos; distingue comprobación del hallazgo de aprobación del módulo.
 * @dataFlow Snapshot real -> funciones exportadas business-date/accounting-journal/qb-classes-locations -> evidencia JSON.
 * @notes Las utilidades de calendario se validan por separado; Toast contable delega paidBusinessDate al proveedor.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { getCaliforniaBusinessDate, getCaliforniaShift, getBusinessDayStartMs } from '../lib/business-date'
import { generateJournalLines, formatDocNumber } from '../lib/accounting-journal'
import { getQBStoreRefs } from '../lib/qb-classes-locations'

const cases = [
  ['2026-10-03T05:59:59-07:00', '2026-10-02', 'PM', '2026-10-02T13:00:00.000Z'],
  ['2026-10-03T06:00:00-07:00', '2026-10-03', 'AM', '2026-10-03T13:00:00.000Z'],
  ['2026-10-03T16:59:59-07:00', '2026-10-03', 'AM', '2026-10-03T13:00:00.000Z'],
  ['2026-10-03T17:00:00-07:00', '2026-10-03', 'PM', '2026-10-03T13:00:00.000Z'],
  ['2026-10-04T00:00:00-07:00', '2026-10-03', 'PM', '2026-10-03T13:00:00.000Z'],
  ['2026-03-08T05:59:59-07:00', '2026-03-07', 'PM', '2026-03-07T14:00:00.000Z'],
  ['2026-03-08T06:00:00-07:00', '2026-03-08', 'AM', '2026-03-08T13:00:00.000Z'],
  ['2026-11-01T01:30:00-07:00', '2026-10-31', 'PM', '2026-10-31T13:00:00.000Z'],
  ['2026-11-01T01:30:00-08:00', '2026-10-31', 'PM', '2026-10-31T13:00:00.000Z'],
  ['2026-11-01T05:59:59-08:00', '2026-10-31', 'PM', '2026-10-31T13:00:00.000Z'],
  ['2026-11-01T06:00:00-08:00', '2026-11-01', 'AM', '2026-11-01T14:00:00.000Z'],
]
const boundaries = cases.map(([input,date,shift,start]) => {
  assert.equal(getCaliforniaBusinessDate(input),date)
  assert.equal(getCaliforniaShift(input),shift)
  assert.equal(new Date(getBusinessDayStartMs(input)).toISOString(),start)
  return {input,date,shift,start,passed:true}
})
const snapshot = JSON.parse(fs.readFileSync('docs/cohesion-audit-20261006/db-snapshot.json','utf8'))
const p = snapshot.packets[0], m = snapshot.mappings.find((m:any)=>m.store_id===p.store_id)
const actual = {...p,for_here_sales:p.dine_in_sales,to_go_sales:p.togo_sales,grubhub_delivery_sales:p.grubhub_sales,tax_paid_by_uber:p.facilitator_tax_paid,marketplace_tax:p.marketplace_facilitator_tax,cash_deposits:p.cash_deposit}
const mapping = {...m,location:m.qb_location,className:m.qb_class,bank_account:m.bank_account_number,sales_tax_rate_name:m.qb_location}
const invalidNumbers = [NaN,Infinity,-Infinity].map(value=>{
  let rejected = false, emitsNonFinite = false
  try { const result=generateJournalLines({...actual,for_here_sales:value},mapping); emitsNonFinite=result.lines.some(l=>!Number.isFinite(l.debit)||!Number.isFinite(l.credit)) } catch { rejected=true }
  return {input:String(value),rejected,emitsNonFinite}
})
const storeReferences = snapshot.stores.map((s:any)=>({store:s.name,refs:getQBStoreRefs(s.name)}))
const unknownReference = getQBStoreRefs('Sucursal desconocida')
const blankReference = getQBStoreRefs('')
const accentVariants = ['Miércoles','Miercoles','Sábado','Sabado'].map(name=>({name,doc:formatDocNumber(name,'2026-09-21')}))
const sources = ['lib/business-date.ts','lib/accounting-journal.ts','lib/qb-classes-locations.ts']
const hashes=Object.fromEntries(sources.map(s=>[s,crypto.createHash('sha256').update(fs.readFileSync(s)).digest('hex')]))
const evidence={capturedAt:new Date().toISOString(),hostTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,hashes,boundaries,invalidNumbers,storeReferences,unknownReference,blankReference,accentVariants,limitations:['Calendar helper verification does not prove upstream Toast paidBusinessDate handling','Invalid-number tests perturb one field of an actual packet; no database mutation','Unknown names are rejected nowhere in getQBStoreRefs and resolve to real company references']}
fs.writeFileSync('docs/cohesion-audit-20261006/boundaries-runtime.json',JSON.stringify(evidence,null,2))
console.log(JSON.stringify({boundaryCases:boundaries.length,calendarPassed:true,invalidNumbers,unknownReference:unknownReference.locationName,blankReference:blankReference.locationName,accentVariants},null,2))
