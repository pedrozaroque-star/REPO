import dotenv from 'dotenv'
import path from 'path'
import { getAuthToken } from '../lib/toast-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function inspectOrder() {
    const token = await getAuthToken()
    if (!token) {
        console.error("❌ Failed to obtain token")
        return
    }

    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
    const businessDate = '20260626' // June 26, 2026

    console.log(`🔍 Fetching orders for Lynwood on ${businessDate}...`)

    // We fetch a wide set of fields to inspect what timestamps, statuses, or KDS-related info might be available
    const fields = [
        'openedDate',
        'closedDate',
        'duration',
        'voided',
        'diningOption',
        'displayNumber',
        'checks.voided',
        'checks.amount',
        'checks.taxAmount',
        'checks.selections.guid',
        'checks.selections.item.name',
        'checks.selections.voided',
        'checks.selections.fulfilledDate', // Let's check if this exists!
        'checks.selections.readyDate',     // Let's check if this exists!
        'checks.selections.kdsStatus',     // Let's check if this exists!
        'checks.payments.guid',
        'checks.payments.amount',
        'checks.payments.paidDate',
        'checks.payments.voided',
        'estimatedFulfillmentDate',
        'promisedDate'
    ].join(',')

    let page = 1
    const pageSize = 100
    let found = false

    while (page <= 10 && !found) {
        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', businessDate)
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
            console.error(`❌ Toast API error: ${res.status}`)
            break
        }

        const data = await res.json()
        const rawOrders = Array.isArray(data) ? data : []

        if (rawOrders.length === 0) {
            console.log("No more orders found.")
            break
        }

        const target = rawOrders.find(o => String(o.displayNumber) === '691')
        if (target) {
            console.log("\n🎯 FOUND ORDER #691!")
            console.log(JSON.stringify(target, null, 2))
            found = true
            break
        }

        page++
    }

    if (!found) {
        console.log("❌ Order #691 not found in the first 10 pages.")
    }
}

inspectOrder()
