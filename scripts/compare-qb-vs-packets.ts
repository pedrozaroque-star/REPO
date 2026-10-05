/**
 * @module scripts/compare-qb-vs-packets
 * @description SOLO LECTURA. Compara accounting_sales_packets (nuestra app) contra los JournalEntry
 * existentes en QuickBooks Online (publicados por Cohesion o por nuestra app) para un rango de fechas.
 * @businessRules No escribe nada en QuickBooks ni en Supabase.
 * @dataFlow QBO query JournalEntry -> agrupa por Department(Location)+TxnDate -> compara total y por cuenta con packets.
 * @notes Uso: node --env-file=.env.local --import=tsx scripts/compare-qb-vs-packets.ts 2026-09-28 2026-10-04
 */
import { getQuickBooksClient } from '../lib/quickbooks'
import { supabaseAdmin } from '../lib/supabase'

const start = process.argv[2] || '2026-09-28'
const end = process.argv[3] || '2026-10-04'
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const qbo: any = await getQuickBooksClient()

  const jes: any[] = await new Promise((resolve, reject) => {
    qbo.findJournalEntries(
      [
        { field: 'TxnDate', value: start, operator: '>=' },
        { field: 'TxnDate', value: end, operator: '<=' },
        { field: 'limit', value: 1000 },
      ],
      (err: any, data: any) => {
        if (err) return reject(err)
        resolve(data?.QueryResponse?.JournalEntry || [])
      }
    )
  })
  console.log(`JournalEntries en QBO (${start}..${end}): ${jes.length}`)

  // Catálogo GL: qb_account_id -> account_number
  const { data: gl } = await supabaseAdmin.from('accounting_gl_accounts').select('account_number, qb_account_id, account_name')
  const qbIdToNum = new Map<string, string>()
  for (const g of gl || []) if (g.qb_account_id) qbIdToNum.set(String(g.qb_account_id), g.account_number)

  // Packets de nuestra app
  const { data: packets } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('id, store_id, business_date, status, journal_lines, journal_total_debits, qb_journal_entry_id, qb_doc_number, stores!inner(name)')
    .gte('business_date', start)
    .lte('business_date', end)

  const { data: maps } = await supabaseAdmin.from('accounting_site_mappings').select('store_id, qb_location')
  const locByStore = new Map<number, string>((maps || []).map((m: any) => [m.store_id, m.qb_location]))

  type JE = { id: string; doc: string; created: string; total: number; byAcct: Map<string, number> }
  const byKey = new Map<string, JE[]>()
  for (const je of jes) {
    const lines = je.Line || []
    const dept = lines.find((l: any) => l.JournalEntryLineDetail?.DepartmentRef)?.JournalEntryLineDetail?.DepartmentRef?.name || '??'
    const key = `${dept}|${je.TxnDate}`
    const byAcct = new Map<string, number>()
    let total = 0
    for (const l of lines) {
      const d = l.JournalEntryLineDetail
      if (!d) continue
      const num = qbIdToNum.get(String(d.AccountRef?.value)) || `QB:${d.AccountRef?.value}(${d.AccountRef?.name})`
      const signed = (d.PostingType === 'Debit' ? 1 : -1) * Number(l.Amount)
      byAcct.set(num, r2((byAcct.get(num) || 0) + signed))
      if (d.PostingType === 'Debit') total += Number(l.Amount)
    }
    const arr = byKey.get(key) || []
    arr.push({ id: je.Id, doc: je.DocNumber || '', created: je.MetaData?.CreateTime || '', total: r2(total), byAcct })
    byKey.set(key, arr)
  }

  let matched = 0, diff = 0, missingInQB = 0, dup = 0
  const rows: string[] = []
  for (const p of (packets || []) as any[]) {
    const loc = locByStore.get(p.store_id) || (p.stores as any)?.name
    const key = `${loc}|${p.business_date}`
    const list = byKey.get(key) || []
    const ours = Number(p.journal_total_debits) || 0
    if (list.length === 0) { missingInQB++; rows.push(`⚪ ${key}  app=${ours}  (status=${p.status})  NO existe en QBO`); continue }
    if (list.length > 1) { dup++; rows.push(`🔴 DUPLICADO ${key}  QBO tiene ${list.length} JEs: ${list.map(j => `${j.doc}#${j.id}=$${j.total}`).join(' | ')}  app=${ours} (${p.status})`) }
    for (const je of list) {
      // diferencia por cuenta
      const ourAcct = new Map<string, number>()
      for (const l of p.journal_lines || []) {
        const s = (Number(l.debit) || 0) - (Number(l.credit) || 0)
        ourAcct.set(l.account, r2((ourAcct.get(l.account) || 0) + s))
      }
      const accts = new Set([...ourAcct.keys(), ...je.byAcct.keys()])
      const dif: string[] = []
      for (const a of accts) {
        const o = ourAcct.get(a) || 0, q = je.byAcct.get(a) || 0
        if (Math.abs(o - q) > 0.005) dif.push(`${a}: app=${o} qbo=${q} Δ=${r2(o - q)}`)
      }
      if (dif.length === 0 && Math.abs(ours - je.total) < 0.005) { matched++; rows.push(`✅ ${key}  ${je.doc}#${je.id}  $${je.total}  (app status=${p.status})`) }
      else { diff++; rows.push(`🟠 ${key}  ${je.doc}#${je.id} qbo=$${je.total} app=$${ours} (${p.status}, creado ${je.created})\n      ${dif.join('\n      ')}`) }
    }
  }
  console.log(rows.sort().join('\n'))
  console.log(`\nRESUMEN: iguales=${matched}  con diferencias=${diff}  duplicados=${dup}  sin JE en QBO=${missingInQB}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
