/**
 * @module audit-cohesion-history-20261006
 * @description Auditoría reproducible de pólizas reales del 21 al 27 septiembre 2026.
 * @businessRules QBO solamente consultas; no recalcula ni modifica pólizas o configuraciones.
 * @dataFlow Supabase SELECT y QBO JournalEntry/Account -> comparación multiconjunto -> evidencia local.
 * @notes OAuth puede renovar su token mediante el cliente existente. Smoke opcional inserta y elimina únicamente una bitácora propia sin FK.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { supabaseAdmin as db } from '../lib/supabase'
import { getQuickBooksClient } from '../lib/quickbooks'
import { getQBStoreRefs } from '../lib/qb-classes-locations'

const out = 'docs/cohesion-audit-20261006'
fs.mkdirSync(out, { recursive: true })
const start = '2026-09-21', end = '2026-09-27'
async function read(q: any) { const r = await q; if (r.error) throw new Error(r.error.message); return r.data || [] }
const cents = (v: any) => { const n = Number(v); assert(Number.isFinite(n)); return Math.round(n * 100) }
function bag(rows: any[]) { const b: Record<string, number> = {}; for (const r of rows) { const k = JSON.stringify(r); b[k] = (b[k] || 0) + 1 } return b }
function delta(a: any[], b: any[]) { const x = bag(a), y = bag(b); return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => x[k] !== y[k]).map(k => ({ line: JSON.parse(k), app: x[k] || 0, qb: y[k] || 0 })) }
async function main() {
  const [packets, mappings, stores] = await Promise.all([
    read(db.from('accounting_sales_packets').select('*').gte('business_date', start).lte('business_date', end)),
    read(db.from('accounting_site_mappings').select('*')),
    read(db.from('stores').select('id,name,external_id,is_active')),
  ])
  fs.writeFileSync(`${out}/db-snapshot.json`, JSON.stringify({ capturedAt: new Date().toISOString(), packets, mappings, stores }, null, 2))
  console.log(JSON.stringify({ stage: 'DB read', packets: packets.length, mappings: mappings.length, activeStores: stores.filter((s: any) => s.is_active).map((s: any) => s.name) }))
  if (process.argv.includes('--smoke')) {
    const marker = `codex-audit-${crypto.randomUUID()}`
    let insertedId: string | undefined
    try {
      const inserted = await db.from('accounting_sync_logs').insert({ action: 'generate', details: { auditOnly: true, marker, purpose: 'isolated schema smoke; no packet or store' } }).select('id,details').single()
      if (inserted.error) throw new Error(inserted.error.message)
      insertedId = inserted.data.id
      const found = await read(db.from('accounting_sync_logs').select('id,details').eq('id', insertedId))
      assert.equal(found.length, 1); assert.equal(found[0].details.marker, marker)
    } finally {
      if (insertedId) {
        const deleted = await db.from('accounting_sync_logs').delete().eq('id', insertedId)
        if (deleted.error) throw new Error(`Smoke cleanup failed for ${insertedId}: ${deleted.error.message}`)
        assert.equal((await read(db.from('accounting_sync_logs').select('id').eq('id', insertedId))).length, 0)
      }
    }
    fs.writeFileSync(`${out}/smoke.json`, JSON.stringify({ passed: true, insertedAndDeleted: insertedId, table: 'accounting_sync_logs', limitation: 'Does not validate packet or mapping mutations' }, null, 2))
    console.log('PASS isolated accounting_sync_logs INSERT / SELECT / DELETE / absence')
  }
  const qbo: any = await getQuickBooksClient()
  async function query(method: string, filters: any[], entity: string) {
    const results: any[] = []
    for (let offset = 1; ; offset += 1000) {
      const data: any = await new Promise((resolve, reject) => qbo[method]([...filters, {field:'limit',value:1000}, {field:'offset',value:offset}], (err: any, data: any) => err ? reject(new Error(`QBO ${method} failed: ${err?.Fault?.Error?.[0]?.Message || err?.message || 'request rejected'}`)) : resolve(data)))
      const page = data?.QueryResponse?.[entity] || []; results.push(...page); if (page.length < 1000) break
    }
    return results
  }
  const journals = await query('findJournalEntries', [{field:'TxnDate',value:start,operator:'>='},{field:'TxnDate',value:end,operator:'<='}], 'JournalEntry')
  const accounts = await query('findAccounts', [], 'Account')
  fs.writeFileSync(`${out}/qbo-snapshot.json`, JSON.stringify({ capturedAt: new Date().toISOString(), journals, accounts }, null, 2))
  const numbers = new Map(accounts.map((a: any) => [String(a.Id), String(a.AcctNum || `QBO:${a.Id}`)]))
  const rows: any[] = []
  for (const store of stores.filter((s: any) => mappings.some((m: any) => m.store_id === s.id && m.is_active))) {
    const refs = getQBStoreRefs(store.name)
    for (let day = 21; day <= 27; day++) {
      const date = `2026-09-${day}`, p = packets.find((p: any) => p.store_id === store.id && p.business_date === date)
      const candidates = journals.filter((j: any) => j.TxnDate === date && (j.Line || []).some((l: any) => String(l.JournalEntryLineDetail?.DepartmentRef?.value) === refs.locationId))
      // POS prefix identifies the historical Cohesion document convention, not cryptographic provenance.
      const cohesion = candidates.filter((j: any) => /^POS/i.test(j.DocNumber || ''))
      const row: any = { store: store.name, storeId: store.id, date, appStatus: p?.status, appId: p?.id, candidates: candidates.map((j: any) => ({id:j.Id,doc:j.DocNumber})), comparisons: [] }
      if (!p) row.state = 'missing_app'
      else if (!cohesion.length) row.state = 'missing_cohesion_POS_reference'
      else {
        for (const je of cohesion) {
          const app = (p.journal_lines || []).map((l: any) => [String(l.account), String(l.sourceMemo || ''), cents(l.debit), cents(l.credit), String(l.location || ''), String(l.className || '')])
          const qb = (je.Line || []).filter((l: any) => l.JournalEntryLineDetail).map((l: any) => { const d = l.JournalEntryLineDetail; return [numbers.get(String(d.AccountRef?.value)) || `QBO:${d.AccountRef?.value}`, l.Description || '', d.PostingType === 'Debit' ? cents(l.Amount) : 0, d.PostingType === 'Credit' ? cents(l.Amount) : 0, d.DepartmentRef?.name || '', d.ClassRef?.name || ''] })
          const differences = delta(app, qb)
          const moneyDifferences = delta(app.map((l: any) => [l[0],l[2],l[3]]), qb.map((l: any) => [l[0],l[2],l[3]]))
          row.comparisons.push({ qbId:je.Id, doc:je.DocNumber, exact:differences.length === 0, amountsExact:moneyDifferences.length === 0, differences, moneyDifferences })
        }
        row.state = cohesion.length > 1 ? 'multiple_references' : row.comparisons[0].exact ? 'exact' : 'different'
      }
      rows.push(row)
    }
  }
  const summary = { start,end,expected:rows.length,packets:packets.length,qboJournals:journals.length,counts:rows.reduce((a: any,r: any) => { a[r.state]=(a[r.state]||0)+1; return a }, {}), amountsExact:rows.filter(r=>r.comparisons.length===1 && r.comparisons[0].amountsExact).length, limitation:'Stored packets versus live QBO. No fresh Toast recalculation. POS prefix is historical source heuristic; multiple references are not automatically duplicates.' }
  fs.writeFileSync(`${out}/historical-comparison.json`, JSON.stringify({summary,rows},null,2))
  console.log(JSON.stringify(summary,null,2))
}
main().catch(e => { console.error('AUDIT FAILED:', e instanceof Error ? e.message : 'unknown'); process.exitCode=1 })
