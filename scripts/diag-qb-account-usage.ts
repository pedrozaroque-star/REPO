import { getQuickBooksClient } from '../lib/quickbooks'
import { supabaseAdmin } from '../lib/supabase'

async function main() {
  const qbo: any = await getQuickBooksClient()
  const start = process.argv[2] || '2026-08-01'
  const end = process.argv[3] || '2026-10-04'
  const all: any[] = []
  for (let pos = 1; ; pos += 1000) {
    const jes: any[] = await new Promise((res, rej) =>
      qbo.findJournalEntries(
        [{ field: 'TxnDate', value: start, operator: '>=' }, { field: 'TxnDate', value: end, operator: '<=' }, { field: 'limit', value: 1000 }, { field: 'offset', value: pos }],
        (e: any, d: any) => (e ? rej(e) : res(d?.QueryResponse?.JournalEntry || []))
      )
    )
    all.push(...jes)
    if (jes.length < 1000) break
  }
  const { data: gl } = await supabaseAdmin.from('accounting_gl_accounts').select('account_number,account_name,qb_account_id').in('account_number', ['53060', '12049', '12100'])
  console.log('cuentas', gl)
  const byAcct: Record<string, Record<string, number>> = {}
  for (const g of gl || []) byAcct[g.account_number] = {}
  for (const je of all) {
    if (!/^POS/.test(je.DocNumber || '')) continue
    for (const l of je.Line || []) {
      const id = String(l.JournalEntryLineDetail?.AccountRef?.value)
      const g = (gl || []).find(x => String(x.qb_account_id) === id)
      if (g) byAcct[g.account_number][je.TxnDate] = (byAcct[g.account_number][je.TxnDate] || 0) + 1
    }
  }
  console.log('JEs POS (Cohesion) totales:', all.filter(j => /^POS/.test(j.DocNumber || '')).length, 'rango', start, end)
  for (const [a, m] of Object.entries(byAcct)) console.log('Líneas por fecha con cuenta', a, m)
}
main().catch(e => { console.error(e?.message || e); process.exit(1) })
