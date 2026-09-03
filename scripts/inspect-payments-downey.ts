import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getAuthToken } from '../lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function inspectPayments() {
  const token = await getAuthToken()
  const storeExternalId = 'b7f63b01-f089-4ad7-a346-afdb1803dc1a' // Downey
  const businessDate = '20260831'

  const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
  url.searchParams.append('businessDate', businessDate)
  url.searchParams.append('pageSize', '100')

  let allPayments: any[] = []
  let page = 1
  let nextUrl = url.toString()

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeExternalId,
      },
    })
    const orders = await res.json()
    if (!orders || !Array.isArray(orders) || orders.length === 0) break

    for (const order of orders) {
      for (const check of order.checks || []) {
        const pSum = (check.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
        const chkTotal = Number(check.totalAmount || (Number(check.amount || 0) + Number(check.taxAmount || 0)))
        const diff = pSum - chkTotal
        if (Math.abs(diff) > 0.01) {
          console.log('DIFF FOUND ON CHECK:', check.guid, 'Order:', order.displayNumber, 'Paid:', pSum, 'Total:', chkTotal, 'Diff:', diff, 'Payments:', check.payments?.map((p: any) => `${p.type}: ${p.amount}`))
        }
        for (const p of check.payments || []) {
          allPayments.push({
            type: p.type,
            amount: p.amount,
            tip: p.tipAmount,
            otherPayment: p.otherPayment,
            paymentStatus: p.paymentStatus,
            displayName: p.displayName || p.paymentInstrument?.displayName || '',
            otherPaymentName: p.otherPayment?.name || (p as any).otherPaymentName,
            cardType: p.cardType
          })
        }
      }
    }

    const linkHeader = res.headers.get('link')
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      nextUrl = match ? match[1] : ''
    } else {
      break
    }
  }

  // Aggregate by type and displayName
  const summary: Record<string, { count: number, total: number, tips: number }> = {}
  for (const p of allPayments) {
    const detail = p.otherPaymentName || p.otherPayment?.guid || p.displayName || p.cardType || 'Sin detalle'
    const key = `${p.type} | ${detail}`
    if (!summary[key]) summary[key] = { count: 0, total: 0, tips: 0 }
    summary[key].count++
    summary[key].total += Number(p.amount || 0)
    summary[key].tips += Number(p.tip || 0)
  }

  console.log('--- RESUMEN DE PAGOS EN TOAST (DOWNEY 20260831) ---')
  for (const [k, v] of Object.entries(summary)) {
    console.log(`${k}: ${v.count} pagos, Total: $${v.total.toFixed(2)}, Tips: $${v.tips.toFixed(2)}`)
  }
}

inspectPayments()
