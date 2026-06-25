import dotenv from 'dotenv'
import path from 'path'
import { getAuthToken } from '../lib/toast-api'
import { getDTStores } from '../lib/drive-thru-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function getDiningOptionsMap(token: string, storeId: string): Promise<Record<string, string>> {
    try {
        const url = `${TOAST_API_HOST}/config/v2/diningOptions`
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })
        if (!res.ok) return {}
        const list = await res.json()
        const map: Record<string, string> = {}
        if (Array.isArray(list)) {
            for (const item of list) {
                if (item.guid && item.name) {
                    map[item.guid] = item.name
                }
            }
        }
        return map
    } catch {
        return {}
    }
}

async function inspect() {
    const token = await getAuthToken()
    if (!token) {
        console.error("No token")
        return
    }

    const stores = {
        'Lynwood': '80a1ec95-bc73-402e-8884-e5abbe9343e6',
        'Norwalk': '42ed15a6-106b-466a-9076-1e8f72451f6b'
    }

    const businessDate = '20260624' // Yesterday June 24, 2026
    const fields = 'openedDate,closedDate,duration,voided,diningOption,displayNumber'

    for (const [name, storeId] of Object.entries(stores)) {
        console.log(`\n🔍 Fetching raw orders for ${name} (${storeId})...`)
        
        const diningOptionsMap = await getDiningOptionsMap(token, storeId)
        console.log(`Dining options map for ${name}:`, diningOptionsMap)

        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', businessDate)
        url.searchParams.append('pageSize', '100')
        url.searchParams.append('page', '1')
        url.searchParams.append('fields', fields)

        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) {
            console.error(`Error fetching for ${name}: ${res.status}`)
            continue
        }

        const data = await res.json()
        const rawOrders = Array.isArray(data) ? data : []

        console.log(`Fetched ${rawOrders.length} raw orders total for ${name}`)

        // Filter and show the first 5 DT orders
        const dtOrders = rawOrders.filter(o => {
            if (o.voided) return false
            const guid = o.diningOption?.guid
            const name = o.diningOption?.name || diningOptionsMap[guid] || ''
            return name.toLowerCase().includes('drive')
        })

        console.log(`Found ${dtOrders.length} non-voided Drive-Thru orders`)

        dtOrders.slice(0, 5).forEach((order, idx) => {
            let calculatedSec = null
            if (order.openedDate && order.closedDate) {
                calculatedSec = Math.floor((new Date(order.closedDate).getTime() - new Date(order.openedDate).getTime()) / 1000)
            }
            console.log(`   Order #${idx + 1} (display: ${order.displayNumber}):`)
            console.log(`      diningOption  : ${JSON.stringify(order.diningOption)}`)
            console.log(`      resolved name : ${order.diningOption?.name || diningOptionsMap[order.diningOption?.guid]}`)
            console.log(`      openedDate    : ${order.openedDate}`)
            console.log(`      closedDate    : ${order.closedDate}`)
            console.log(`      duration (prop): ${order.duration}`)
            console.log(`      calculated dur: ${calculatedSec} seconds`)
        })
    }
}

inspect()
