import { getAuthToken } from '../lib/toast-api'
import { supabaseAdmin } from '../lib/supabase'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

function isDeliveryPlatform(dName: string, delivService?: string, source?: string): boolean {
  const full = `${dName} ${delivService || ''} ${source || ''}`.toLowerCase()
  return (
    full.includes('doordash') ||
    full.includes('dash') ||
    full.includes('uber') ||
    full.includes('postmates') ||
    full.includes('grubhub') ||
    full.includes('grub') ||
    full.includes('toast online') ||
    full.includes('online ordering') ||
    full.includes('curbside') ||
    full.includes('toast delivery')
  )
}

async function testFilter() {
  const { data: store } = await supabaseAdmin.from('stores').select('*').eq('id', 7).single()
  const token = await getAuthToken()

  // Dining options map
  const dRes = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id }
  })
  const dList = await dRes.json()
  const dMap: Record<string, string> = {}
  dList.forEach((d: any) => { dMap[d.guid] = d.name })

  // Fetch all orders
  let page = 1
  const allOrders: any[] = []
  while (page <= 10) {
    const url = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=20261012&pageSize=100&page=${page}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id }
    })
    const data = await res.json()
    if (!data || data.length === 0) break
    allOrders.push(...data)
    if (data.length < 100) break
    page++
  }

  const deliveryOrders = allOrders.filter(o => {
    if (o.voided || o.deleted) return false
    const dName = dMap[o.diningOption?.guid] || o.diningOption?.name || ''
    const delivService = o.deliveryService?.name || ''
    const source = typeof o.source === 'string' ? o.source : (o.source?.name || '')
    return isDeliveryPlatform(dName, delivService, source)
  })

  console.log(`Total orders today: ${allOrders.length}`)
  console.log(`Total STRICT DELIVERY orders today: ${deliveryOrders.length}`)

  console.log('\n--- 10 MOST RECENT STRICT DELIVERY ORDERS ---')
  for (const o of deliveryOrders.slice(-10).reverse()) {
    const dName = dMap[o.diningOption?.guid] || ''
    const cust = o.customer || o.checks?.[0]?.customer
    const custName = cust ? `${cust.firstName || ''} ${cust.lastName || ''}`.trim() : 'Sin Nombre'
    const timeLA = new Date(o.openedDate).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })
    console.log(`Ticket #${o.displayNumber} | ${dName} | ${custName} | ${timeLA} | ${o.checks?.[0]?.selections?.length} items`)
  }
}

testFilter()
