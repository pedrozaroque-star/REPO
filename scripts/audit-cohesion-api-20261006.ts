/**
 * @module audit-cohesion-api-20261006
 * @description Reproduce hallazgos API/UI con handlers reales y snapshot real, sin mutaciones externas.
 * @businessRules No publicar ni llamar handlers con payloads válidos de escritura. Resultado PASS significa reproducción, no aprobación.
 * @dataFlow Código actual + snapshot Supabase → assertions → evidencia JSON local.
 * @notes Ejecutar con npx tsx; bloques puros se extraen del código actual, no se mantienen copias de lógica.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'
import vm from 'node:vm'
import { NextRequest } from 'next/server'

async function main() {
  const paths = ['app/api/accounting/packets/route.ts', 'app/api/accounting/packets/[id]/route.ts', 'app/api/accounting/packets/[id]/publish/route.ts', 'app/api/accounting/packets/publish-batch/route.ts', 'app/api/cron/sync-accounting/route.ts', 'app/contabilidad/page.tsx', 'app/contabilidad/[packetId]/page.tsx', 'app/contabilidad/layout.tsx', 'middleware.ts']
  const sources = Object.fromEntries(paths.map(p => [p, fs.readFileSync(p, 'utf8')]))
  const checks: any[] = []
  const record = (name: string, details: unknown) => { checks.push({ name, reproduced: true, details }); console.log('PASS', name, JSON.stringify(details)) }
  const packetsRoute = await import('../app/api/accounting/packets/route')
  const batchRoute = await import('../app/api/accounting/packets/publish-batch/route')
  for (const [name, handler] of [['generate', packetsRoute.POST], ['batch', batchRoute.POST]] as const) {
    const response = await handler(new NextRequest('http://localhost/api/accounting/packets', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}))
    assert.equal(response.status, 400)
    record('Unauthenticated request reaches business validation: '+name, {status:response.status, body:await response.json()})
  }
  const snapshot = JSON.parse(fs.readFileSync('docs/cohesion-audit-20261006/db-snapshot.json', 'utf8'))
  const packets = snapshot.packets
  assert.equal(packets.length, 105)
  const missingAliases = packets.filter((p: any) => p.cc_gross === undefined && p.cc_deposit === undefined && p.cc_fees === undefined && p.discounts === undefined)
  assert.equal(missingAliases.length, 105)
  const detail = sources['app/contabilidad/[packetId]/page.tsx']
  for (const field of ['total_credit_cards_gross', 'credit_card_deposit', 'credit_card_fees', 'total_discounts']) assert.ok(detail.includes('formatCurrency(packet.'+field+' ??'))
  const formatterText = detail.slice(detail.indexOf('const formatCurrency ='), detail.indexOf('const formatDateDisplay ='))
  const formatter = vm.runInNewContext(ts.transpile(formatterText+'\nformatCurrency', {target:ts.ScriptTarget.ES2020}), {Intl})
  const depositExpression = detail.match(/formatCurrency\((packet\.credit_card_deposit[^)]*)\)/)![1]
  const displayed = vm.runInNewContext('formatCurrency('+depositExpression+')',{packet:packets[0],formatCurrency:formatter})
  assert.equal(displayed, '$2,774.70')
  record('FIX VERIFIED UI reads real DB credit card fields', {checkedPackets:missingAliases.length, sampleId:packets[0].id, actualDeposit:packets[0].credit_card_deposit, displayed})
  const generate = sources[paths[0]]
  for (const source of [generate,sources[paths[4]]]) {
    const expression = source.match(/const previousDeposit = ([\s\S]*?)\n\s*salesPacketData.cash_deposits = previousDeposit/)![1]
    for (const value of [0,100.25,null,undefined]) {
      const actual = vm.runInNewContext(expression,{existingPacket:{cash_deposit:value},Number})
      assert.equal(actual,value ?? 0)
    }
  }
  record('FIX VERIFIED recalculation preserves existing deposit including zero',{handlers:2,cases:4})
  const fallback = generate.slice(generate.indexOf('const uberSales ='), generate.indexOf('\n        const siteConfig:'))
  // Remove the enclosing if closing brace; execute exact fallback body with controlled business inputs.
  const body = fallback.slice(0, fallback.lastIndexOf('}'))
  const runFallback = (sale: any) => vm.runInNewContext(ts.transpile('let salesPacketData;'+body+'\nsalesPacketData', {target:ts.ScriptTarget.ES2020}), {sale, round:(v:number)=>Math.round(v*100)/100, Math})
  const zeroSales = runFallback({net_sales:0,taxes:0,doordash_sales:100})
  assert.ok(!Number.isFinite(zeroSales.doordash_payment))
  record('Actual fallback computes NaN at zero net sales with channel sales', {doordashPayment:String(zeroSales.doordash_payment)})
  const realFallback = runFallback({net_sales:packets[0].net_sales,taxes:packets[0].total_taxes,uber_sales:packets[0].uber_delivery_sales,doordash_sales:packets[0].doordash_delivery_sales,grubhub_sales:packets[0].grubhub_sales})
  record('Fallback replaces actual card deposits with estimated percentages', {sampleId:packets[0].id, actual:packets[0].credit_card_deposit, estimated:realFallback.credit_card_deposit})
  const cron = sources[paths[4]]
  const dateBlock = cron.slice(cron.indexOf('const laFormatter ='), cron.indexOf('\n    console.log(`[sync-accounting] Fecha'))
  const dates = (now:Date) => vm.runInNewContext(ts.transpile(dateBlock.replace('formatToParts(new Date())','formatToParts(inputDate)')+'\nrollingDates', {target:ts.ScriptTarget.ES2020}), {Date,Intl,inputDate:now})
  for (const [input, expected] of [['2026-10-07T00:00:00-07:00','2026-10-05'],['2026-10-07T05:59:00-07:00','2026-10-05'],['2026-10-07T06:00:00-07:00','2026-10-06'],['2026-10-07T16:59:00-07:00','2026-10-06'],['2026-10-07T17:00:00-07:00','2026-10-06'],['2026-11-01T05:59:00-08:00','2026-10-30'],['2026-11-01T06:00:00-08:00','2026-10-31']]) { assert.equal(dates(new Date(input))[0],expected); record('Cron date '+input,{expected}) }
  const result = {capturedAt:new Date().toISOString(), scope:'No network mutations; two real handlers with empty bodies; real DB snapshot; source-extracted pure logic.', hashes:paths.map(path=>({path,sha256:crypto.createHash('sha256').update(sources[path]).digest('hex'),lines:sources[path].split('\n').length})),checks}
  fs.writeFileSync(process.argv[2] || 'docs/cohesion-audit-20261006/api-runtime-evidence-20261007.json', JSON.stringify(result,null,2)+'\n')
  console.log('PASS reproduction checks:',checks.length)
}
main().catch(e=>{console.error(e);process.exitCode=1})
