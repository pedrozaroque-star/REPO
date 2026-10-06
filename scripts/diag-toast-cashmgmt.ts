import { getAuthToken } from '../lib/toast-api'
import { supabaseAdmin } from '../lib/supabase'

const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
async function main() {
  const nameLike = process.argv[2] || 'Central'
  const date = process.argv[3] || '20260928'
  const { data: st } = await supabaseAdmin.from('stores').select('name,external_id').ilike('name', `%${nameLike}%`).limit(1).single()
  const token = await getAuthToken()
  const h = { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': st!.external_id }
  const r = await fetch(`${HOST}/cashmgmt/v1/entries?businessDate=${date}`, { headers: h })
  const entries: any[] = await r.json()
  const agg: Record<string, { n: number; sum: number }> = {}
  const list: any[] = []
  for (const e of entries) {
    const k = `${e.type}${e.payoutReason ? ' | payout:' + (e.payoutReason.name || e.payoutReason.guid) : ''}${e.reason ? ' | reason:' + e.reason : ''}`
    agg[k] = agg[k] || { n: 0, sum: 0 }
    agg[k].n++; agg[k].sum = Math.round((agg[k].sum + Number(e.amount || 0)) * 100) / 100
    if (Number(e.amount)) list.push({ type: e.type, amount: e.amount, date: e.date, reason: e.reason })
  }
  console.log(st!.name, date, 'entradas:', entries.length)
  console.log(agg)
  console.log('con monto != 0:', list)
}
main().catch(e => { console.error(e); process.exit(1) })
