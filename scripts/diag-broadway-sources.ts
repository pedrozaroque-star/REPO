import { supabaseAdmin } from '../lib/supabase'
import { getAuthToken } from '../lib/toast-api'

const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
async function main() {
  const date = process.argv[2] || '20261003'
  const ext = process.argv[3] || '475bc112-187d-4b9c-884d-1f6a041698ce'
  const token = await getAuthToken()
  const h = { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': ext }
  const opts: any[] = await (await fetch(`${HOST}/config/v2/diningOptions`, { headers: h })).json()
  const map: Record<string, string> = {}
  for (const o of opts) map[o.guid] = o.name
  const orders: any[] = []
  for (let page = 1; ; page++) {
    const u = new URL(`${HOST}/orders/v2/ordersBulk`)
    u.searchParams.set('businessDate', date); u.searchParams.set('pageSize', '100'); u.searchParams.set('page', String(page))
    u.searchParams.set('fields', 'diningOption,voided,deleted,source,deliveryService,displayNumber,deliveryInfo,checks.voided,checks.appliedDiscounts,checks.payments.type,checks.payments.amount,checks.payments.otherPayment,checks.payments.displayName,checks.selections.price,checks.selections.voided,checks.selections.tax,checks.selections.taxInclusion')
    const r = await fetch(u.toString(), { headers: h }); if (!r.ok) throw new Error(await r.text())
    const d = await r.json(); orders.push(...d); if (d.length < 100) break
  }
  const agg: Record<string, { n: number; net: number }> = {}
  const delivs: any[] = []
  for (const o of orders) {
    if (o.voided || o.deleted) continue
    const key = `${map[o.diningOption?.guid] || o.diningOption?.name || '?'} | src=${o.source || ''} | ds=${o.deliveryService || ''}`
    let net = 0
    for (const c of o.checks || []) { if (c.voided) continue; for (const s of c.selections || []) { if (!s.voided) net += Number(s.price || 0) - (s.taxInclusion === 'INCLUDED' ? Number(s.tax || 0) : 0) }; for (const d of c.appliedDiscounts || []) net -= Number(d.amount || 0) }
    agg[key] = agg[key] || { n: 0, net: 0 }; agg[key].n++; agg[key].net = Math.round((agg[key].net + net) * 100) / 100
    if (/toast|deliver/i.test(key) && !/uber|door|grub/i.test(key)) delivs.push({ order: o.displayNumber, key, net: Math.round(net * 100) / 100 })
  }
  console.log(agg)
  console.log('candidatos Toast/Delivery (no marketplace):', delivs)
}
main().catch(e => { console.error(e); process.exit(1) })
