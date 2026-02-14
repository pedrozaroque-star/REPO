import { getProductMix } from '../lib/toast-pmix'
import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function getFirstStore(token: string) {
    const res = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json()
    const list = Array.isArray(data) ? data : (data.restaurants || [])
    return list.length > 0 ? (list[0].restaurantGuid || list[0].guid) : null
}

async function testPmix() {
    console.log('--- TESTING PRODUCT MIX ---')
    const token = await getAuthToken()
    if (!token) { console.error('No Token'); return }

    const storeId = await getFirstStore(token)
    if (!storeId) { console.error('No Store'); return }

    console.log(`Store: ${storeId}`)

    // Yesterday
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const dStr = d.toISOString().split('T')[0]

    console.log(`Fetching for ${dStr}...`)

    const items = await getProductMix({
        storeId,
        startDate: dStr,
        endDate: dStr
    })

    console.log(`Fetched ${items.length} items.`)

    // Sort by Qty Desc
    items.sort((a, b) => b.quantity - a.quantity)

    console.log('--- TOP 10 ITEMS ---')
    items.slice(0, 10).forEach(i => {
        console.log(`${i.quantity}x ${i.name} ($${i.net_sales.toFixed(2)}) [${i.guid}]`)
    })
}

testPmix()
