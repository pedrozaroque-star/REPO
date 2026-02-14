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

async function inspectOrders() {
    const token = await getAuthToken()
    const storeId = await getFirstStore(token!)

    // Yesterday
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const businessDate = d.toISOString().split('T')[0].replace(/-/g, '')

    const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
    url.searchParams.append('businessDate', businessDate)
    url.searchParams.append('pageSize', '1') // Just 1 order
    url.searchParams.append('page', '1')
    // url.searchParams.append('fields', 'checks.selections') // Request full selection object to see keys

    console.log(`Fetching 1 order for ${businessDate}...`)
    const res = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId!
        }
    })

    const data = await res.json()
    console.log(JSON.stringify(data, null, 2))
}

inspectOrders()
