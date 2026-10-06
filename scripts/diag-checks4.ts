import { supabaseAdmin } from '../lib/supabase'
import { getAuthToken } from '../lib/toast-api'
const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
async function main() {
  const nameLike = process.argv[2], date = process.argv[3], targets = process.argv.slice(4).map(Number)
  const { data: st } = await supabaseAdmin.from('stores').select('id,name,external_id').ilike('name', `%${nameLike}%`).limit(1).single()
  const token = await getAuthToken()
  const h = { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': st!.external_id }
  const orders: any[] = []
  for (let page = 1; ; page++) {
    const u = new URL(`${HOST}/orders/v2/ordersBulk`)
    u.searchParams.set('businessDate', date); u.searchParams.set('pageSize','100'); u.searchParams.set('page', String(page))
    const res = await fetch(u.toString(), { headers: h }); if (!res.ok) throw new Error(await res.text())
    const d = await res.json(); orders.push(...d); if (d.length < 100) break
  }
  console.log(st!.name, 'orders', orders.length)
  for (const o of orders) for (const c of o.checks || []) {
    const pays = (c.payments||[])
    const hit0 = pays.some((p:any)=>targets.includes(Math.round(Number(p.amount)*100)/100)||false)
    const hit = pays.some((p:any)=>Math.abs(Number(p.amount)-10.22)<0.005) && new Date(o.paidDate||c.closedDate||0).getTime()>=Date.parse('2026-10-03T13:00:00Z') && new Date(o.paidDate||c.closedDate||0).getTime()<Date.parse('2026-10-04T13:00:00Z'); const gift = (c.selections||[]).some((s:any)=>/gift/i.test(JSON.stringify([s.displayName,s.item?.name,s.giftCard])) || s.giftCard)
    const mism = pays.length && Math.abs(pays.filter((p:any)=>p.paymentStatus==='CAPTURED'||p.paymentStatus==='AUTHORIZED').reduce((a:number,p:any)=>a+Number(p.amount||0),0)-Number(c.totalAmount||0))>0.009
    if (hit||gift||mism) console.log(JSON.stringify({order:o.displayNumber,src:o.source,opt:o.diningOption?.guid?.slice(0,6),voided:o.voided||c.voided,deleted:o.deleted||c.deleted,paidDate:o.paidDate,closed:c.closedDate,amount:c.amount,tax:c.taxAmount,total:c.totalAmount,payStatus:c.paymentStatus,pays:pays.map((p:any)=>[p.type,p.paymentStatus,p.amount,p.tipAmount,p.voided,p.refundStatus]),sels:(c.selections||[]).map((s:any)=>[s.displayName,s.price,s.giftCard?'GC':'',s.voided?'V':'']).slice(0,6),hit,gift,mism}))
  }
}
main()



