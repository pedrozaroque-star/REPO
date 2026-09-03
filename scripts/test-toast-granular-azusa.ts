/**
 * Extraer datos granulares directamente de Toast API para Azusa (01/09/2026)
 * para comprobar el cálculo exacto de opciones de comedor, impuestos y pagos
 * y compararlo con el asiento #572651 de Cohesion en QuickBooks.
 */

import dotenv from 'dotenv'
import path from 'path'
import { getAuthToken, getToastRestaurants } from '../lib/toast-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testToastGranular() {
  console.log('🍞 Consultando Toast API para Azusa (01/09/2026)...')

  const token = await getAuthToken()
  const azusaExtId = 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8'
  const businessDate = '20260901'

  // 1. Obtener Dining Options Map
  const host = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
  const optRes = await fetch(`${host}/config/v2/diningOptions`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Toast-Restaurant-External-ID': azusaExtId
    }
  })

  const diningOptions = await optRes.json()
  const diningMap: Record<string, string> = {}
  for (const opt of diningOptions || []) {
    diningMap[opt.guid] = opt.name
  }
  console.log('Dining Options Map:', diningMap)

  // 2. Consultar ordersBulk
  const url = new URL(`${host}/orders/v2/ordersBulk`)
  url.searchParams.append('businessDate', businessDate)
  url.searchParams.append('pageSize', '100')
  url.searchParams.append('page', '1')

  const fields = [
    'diningOption',
    'voided',
    'source',
    'deliveryService',
    'checks.amount',
    'checks.taxAmount',
    'checks.appliedDiscounts',
    'checks.payments.type',
    'checks.payments.amount',
    'checks.payments.tipAmount',
    'checks.payments.otherPayment',
    'checks.payments.paymentInstrument',
    'checks.payments.displayName',
    'checks.selections.price',
    'checks.selections.preDiscountPrice',
    'checks.selections.tax',
    'checks.selections.taxInclusion',
    'checks.selections.voided',
    'checks.selections.refundDetails'
  ].join(',')
  url.searchParams.append('fields', fields)

  let page = 1
  let hasMore = true
  let allOrders: any[] = []

  while (hasMore) {
    url.searchParams.set('page', String(page))
    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Toast-Restaurant-External-ID': azusaExtId
      }
    })

    if (!res.ok) {
      console.error('Toast API Error:', res.status, await res.text())
      break
    }

    const data = await res.json()
    allOrders.push(...data)
    if (data.length < 100) hasMore = false
    else page++
  }

  console.log(`✓ Total de órdenes extraídas de Toast: ${allOrders.length}`)

  // Analizar ventas por Dining Option
  const salesByDining: Record<string, number> = {}
  const paymentsByType: Record<string, number> = {}
  let totalTax = 0

  for (const o of allOrders) {
    if (o.voided) continue
    const optName = diningMap[o.diningOption?.guid] || o.diningOption?.name || 'Desconocido'

    for (const c of o.checks || []) {
      if (c.voided) return
      totalTax += Number(c.taxAmount || 0)

      let checkNet = 0
      for (const sel of c.selections || []) {
        if (sel.voided) continue
        let p = Number(sel.price || 0)
        if (sel.taxInclusion === 'INCLUDED') p -= Number(sel.tax || 0)
        if (sel.refundDetails?.refundAmount) p -= Number(sel.refundDetails.refundAmount)
        checkNet += p
      }

      if (c.appliedDiscounts) {
        for (const d of c.appliedDiscounts) {
          checkNet -= Number(d.amount || 0)
        }
      }

      salesByDining[optName] = (salesByDining[optName] || 0) + checkNet

      for (const p of c.payments || []) {
        const pType = p.type || 'UNKNOWN'
        const pName = p.displayName || p.paymentInstrument?.displayName || pType
        paymentsByType[pName] = (paymentsByType[pName] || 0) + Number(p.amount || 0)
      }
    }
  }

  console.log('\n📊 Ventas por Dining Option en Toast POS:')
  for (const [k, v] of Object.entries(salesByDining)) {
    console.log(`  • ${k.padEnd(25)} : $${v.toFixed(2)}`)
  }

  console.log(`\nImpuestos Totales: $${totalTax.toFixed(2)}`)

  console.log('\n💳 Pagos por Tipo en Toast POS:')
  for (const [k, v] of Object.entries(paymentsByType)) {
    console.log(`  • ${k.padEnd(25)} : $${v.toFixed(2)}`)
  }
}

testToastGranular().catch(console.error)
