import dotenv from 'dotenv'
import path from 'path'
import { getAuthToken } from '../lib/toast-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

async function fetchAllDTOrdersFromToast(token: string, storeId: string, storeName: string, businessDate: string) {
    const diningOptionsMap = await getDiningOptionsMap(token, storeId)
    const orders: any[] = []
    let page = 1
    const pageSize = 100
    let hasMore = true
    const formattedDate = businessDate.replace(/-/g, '')
    const fields = 'openedDate,closedDate,duration,voided,diningOption,displayNumber'

    while (hasMore) {
        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', formattedDate)
        url.searchParams.append('pageSize', String(pageSize))
        url.searchParams.append('page', String(page))
        url.searchParams.append('fields', fields)

        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) {
            console.error(`Error page ${page}: ${res.status}`)
            break
        }

        const data = await res.json()
        const rawOrders = Array.isArray(data) ? data : []

        for (const o of rawOrders) {
            if (o.voided) continue
            const guid = o.diningOption?.guid
            const name = o.diningOption?.name || diningOptionsMap[guid] || ''
            if (!name.toLowerCase().includes('drive')) continue

            let durationSeconds = null
            if (typeof o.duration === 'number' && o.duration > 0) {
                durationSeconds = o.duration
            } else if (o.openedDate && o.closedDate) {
                const diffMs = new Date(o.closedDate).getTime() - new Date(o.openedDate).getTime()
                if (diffMs > 0) {
                    durationSeconds = Math.floor(diffMs / 1000)
                }
            }

            if (durationSeconds === null) continue
            if (durationSeconds < 15 || durationSeconds > 900) continue // outlier filter

            orders.push({
                displayNumber: o.displayNumber,
                durationSeconds
            })
        }

        if (rawOrders.length < pageSize) {
            hasMore = false
        } else {
            page++
        }
    }

    return orders
}

async function verify() {
    const token = await getAuthToken()
    if (!token) return

    const date = '2026-06-24'
    const stores = {
        'Lynwood': '80a1ec95-bc73-402e-8884-e5abbe9343e6',
        'Norwalk': '42ed15a6-106b-466a-9076-1e8f72451f6b'
    }

    console.log(`🔍 Verifying parity for date: ${date}\n`)

    for (const [name, storeId] of Object.entries(stores)) {
        console.log(`--- ${name} ---`)
        
        // 1. Fetch from Toast
        const toastOrders = await fetchAllDTOrdersFromToast(token, storeId, name, date)
        const toastCount = toastOrders.length
        const toastSum = toastOrders.reduce((sum, o) => sum + o.durationSeconds, 0)
        const toastAvg = toastCount > 0 ? Math.round(toastSum / toastCount) : 0
        const minToast = toastCount > 0 ? Math.min(...toastOrders.map(o => o.durationSeconds)) : 0
        const maxToast = toastCount > 0 ? Math.max(...toastOrders.map(o => o.durationSeconds)) : 0

        // 2. Fetch from DB
        const { data: dbOrders, error } = await supabase
            .from('dt_orders')
            .select('duration_seconds')
            .eq('store_id', storeId)
            .eq('business_date', date)

        if (error) {
            console.error("DB error:", error.message)
            continue
        }

        const dbCount = dbOrders.length
        const dbSum = dbOrders.reduce((sum: number, o: any) => sum + o.duration_seconds, 0)
        const dbAvg = dbCount > 0 ? Math.round(dbSum / dbCount) : 0
        const minDb = dbCount > 0 ? Math.min(...dbOrders.map((o: any) => o.duration_seconds)) : 0
        const maxDb = dbCount > 0 ? Math.max(...dbOrders.map((o: any) => o.duration_seconds)) : 0

        console.log(`Toast API (Calculado en vivo):`)
        console.log(`   Count: ${toastCount} orders`)
        console.log(`   Average: ${Math.floor(toastAvg / 60)}:${String(toastAvg % 60).padStart(2, '0')} (${toastAvg}s)`)
        console.log(`   Fastest: ${minToast}s | Slowest: ${maxToast}s`)

        console.log(`Database (Registrado por el Sync):`)
        console.log(`   Count: ${dbCount} orders`)
        console.log(`   Average: ${Math.floor(dbAvg / 60)}:${String(dbAvg % 60).padStart(2, '0')} (${dbAvg}s)`)
        console.log(`   Fastest: ${minDb}s | Slowest: ${maxDb}s`)

        const countMatch = toastCount === dbCount ? "✅ MATCH" : "❌ MISMATCH"
        const avgMatch = toastAvg === dbAvg ? "✅ MATCH" : "❌ MISMATCH"
        console.log(`\nResults comparison: Count: ${countMatch} | Avg: ${avgMatch}\n`)
    }
}

verify()
