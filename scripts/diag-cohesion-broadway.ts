/**
 * DiagnÃ³stico de solo lectura: Broadway LA 2026-10-02 (Toast vs Cohesion).
 * Busca el origen de: Toast Delivery Services 26.78, Tips Payable 3.00, diferencia CC 16.61.
 */
import { supabaseAdmin } from '../lib/supabase'
import { getAuthToken } from '../lib/toast-api'

const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function main() {
  const date = process.argv[3] || '20261002'
  const nameLike = process.argv[2] || 'Broadway'
  const { data: st } = await supabaseAdmin.from('stores').select('id,name,external_id').ilike('name', `%${nameLike}%`).limit(1).single()
  console.log('Store', st)
  const token = await getAuthToken()
  const h = { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': st!.external_id }

  const orders: any[] = []
  for (let page = 1; ; page++) {
    const u = new URL(`${HOST}/orders/v2/ordersBulk`)
    u.searchParams.set('businessDate', date)
    u.searchParams.set('pageSize', '100')
    u.searchParams.set('fields', ['diningOption','voided','deleted','closedDate','paidDate','openedDate','displayNumber','source','deliveryService','checks.amount','checks.taxAmount','checks.totalAmount','checks.closedDate','checks.paymentStatus','checks.appliedDiscounts','checks.appliedServiceCharges','checks.payments.type','checks.payments.amount','checks.payments.tipAmount','checks.payments.refundAmount','checks.payments.voided','checks.payments.originalProcessingFee','checks.payments.mcaRepaymentAmount','checks.payments.paymentStatus','checks.payments.otherPayment','checks.payments.paymentInstrument','checks.payments.displayName','checks.selections.price','checks.selections.tax','checks.selections.taxInclusion','checks.selections.voided','checks.selections.refundDetails','checks.selections.item.name','checks.selections.displayName'].join(','))
    u.searchParams.set('page', String(page))
    const res = await fetch(u.toString(), { headers: h })
    if (!res.ok) throw new Error(await res.text())
    const d = await res.json()
    orders.push(...d)
    if (d.length < 100) break
  }
  console.log('orders', orders.length)

  const sc: Record<string, number> = {}
  const allPay: Record<string, number> = {}
  const scDetail: any[] = []
  const selMatches: any[] = []
  let tipsCredit = 0, tipsAll = 0, refundsCredit = 0, credit = 0, creditVoidedOrDenied = 0
  const creditByStatus: Record<string, number> = {}
  const creditList: any[] = []

  for (const o of orders) {
    if (o.voided || o.deleted) continue
    for (const c of o.checks || []) {
      if (c.voided) continue
      for (const s of c.appliedServiceCharges || []) {
        const k = `${s.name} | gratuity=${s.gratuity} delivery=${s.delivery} dest=${s.destination} type=${s.chargeType}`
        sc[k] = (sc[k] || 0) + Number(s.chargeAmount || 0)
        if (scDetail.length < 8) scDetail.push({ order: o.displayNumber, ...s })
      }
      for (const s of c.selections || []) {
        const n = `${s.displayName || ''} ${s.item?.name || ''}`
        if (/tip|propina|donat|grat|deliver|charge/i.test(n)) selMatches.push({ order: o.displayNumber, n, price: s.price, voided: s.voided })
      }
      for (const p of c.payments || []) {
        const kk = `${p.type}|${p.otherPayment?.name || p.displayName || p.paymentInstrument?.displayName || ''}|${p.paymentStatus}|voided=${!!p.voided}`
        allPay[kk] = Math.round(((allPay[kk] || 0) + Number(p.amount || 0)) * 100) / 100; if (Number(p.tipAmount)) allPay[kk + '|TIPS'] = Math.round(((allPay[kk + '|TIPS'] || 0) + Number(p.tipAmount)) * 100) / 100
        const st2 = `${p.type}/${p.paymentStatus}/voided=${!!p.voided}`
        if (p.type === 'CREDIT') {
          creditByStatus[st2] = (creditByStatus[st2] || 0) + Number(p.amount || 0)
          if (p.voided || p.paymentStatus === 'DENIED' || p.paymentStatus === 'FAILED') creditVoidedOrDenied += Number(p.amount || 0)
          if (!p.voided) {
            credit += Number(p.amount || 0)
            tipsCredit += Number(p.tipAmount || 0)
            refundsCredit += Number(p.refundAmount || 0)
            creditList.push({ order: o.displayNumber, amt: p.amount, tip: p.tipAmount, refund: p.refundAmount, status: p.paymentStatus, paid: p.paidDate, closed: o.closedDate, bd: o.businessDate })
          }
        }
        tipsAll += Number(p.tipAmount || 0)
      }
    }
  }
  console.log('\nSERVICE CHARGES por tipo:', sc); console.log('\nTODOS LOS PAGOS:', allPay)
  console.log('muestra service charges', JSON.stringify(scDetail.slice(0, 4), null, 1))
  console.log('\nSelecciones con deliver/tip/grat/fee:', selMatches.length); console.table(selMatches.slice(0, 20))
  console.log('\nCREDIT por estado:', creditByStatus)
  console.log({ credit: credit.toFixed(2), tipsCredit: tipsCredit.toFixed(2), tipsAll: tipsAll.toFixed(2), refundsCredit: refundsCredit.toFixed(2), creditVoidedOrDenied: creditVoidedOrDenied.toFixed(2) })
  const withRefund = creditList.filter(x => Number(x.refund) > 0)
  console.log('CREDIT con refund:', withRefund)
  // bÃºsqueda de subconjunto que sume 16.61
  const target = 16.61
  const hit = creditList.filter(x => Math.abs(Number(x.amt) - target) < 0.005)
  console.log('pagos CREDIT = 16.61:', hit)
}
main().catch(e => { console.error(e); process.exit(1) })


