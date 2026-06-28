import dotenv from 'dotenv'
import path from 'path'
import { getAuthToken } from '../lib/toast-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function compare() {
    const token = await getAuthToken()
    if (!token) {
        console.error("❌ Failed to obtain token")
        return
    }

    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
    const businessDate = '20260626' // June 26, 2026

    const fields = [
        'openedDate',
        'closedDate',
        'duration',
        'voided',
        'diningOption',
        'displayNumber',
        'checks.voided',
        'checks.selections.guid',
        'checks.selections.createdDate',
        'checks.selections.modifiedDate',
        'checks.selections.fulfillmentStatus',
        'checks.selections.voided'
    ].join(',')

    const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
    url.searchParams.append('businessDate', businessDate)
    url.searchParams.append('pageSize', '50')
    url.searchParams.append('page', '1')
    url.searchParams.append('fields', fields)

    const res = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId
        }
    })

    if (!res.ok) {
        console.error("Error fetching", res.status)
        return
    }

    const data = await res.json()
    const rawOrders = Array.isArray(data) ? data : []

    // Filter DT orders
    const dtOrders = rawOrders.filter(o => {
        if (o.voided) return false
        return o.diningOption?.guid === 'c877cda2-6b07-4317-a6b8-793640565f40' // Lynwood DT GUID
    })

    console.log(`\n📋 Comparing durations for ${dtOrders.length} Drive-Thru orders on ${businessDate}:`)
    console.log(`Order# | POS Open   | POS Close  | POS Dur | KDS Start  | KDS Bump   | KDS Dur`)
    console.log(`---------------------------------------------------------------------------------`)

    for (const order of dtOrders) {
        // Collect all non-voided selections
        const selections = []
        if (order.checks) {
            for (const check of order.checks) {
                if (check.voided) continue
                if (check.selections) {
                    for (const sel of check.selections) {
                        if (sel.voided) continue
                        selections.push(sel)
                    }
                }
            }
        }

        if (selections.length === 0) continue

        // Calculate POS duration
        const posOpened = new Date(order.openedDate)
        const posClosed = order.closedDate ? new Date(order.closedDate) : null
        const posDurSec = posClosed ? Math.floor((posClosed.getTime() - posOpened.getTime()) / 1000) : null

        // Calculate KDS duration using selections
        const createdDates = selections.map(s => new Date(s.createdDate).getTime()).filter(t => !isNaN(t))
        const modifiedDates = selections.map(s => new Date(s.modifiedDate).getTime()).filter(t => !isNaN(t))

        if (createdDates.length === 0 || modifiedDates.length === 0) continue

        const kdsStart = new Date(Math.min(...createdDates))
        const kdsEnd = new Date(Math.max(...modifiedDates))
        const kdsDurSec = Math.floor((kdsEnd.getTime() - kdsStart.getTime()) / 1000)

        const toTimeStr = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false })
        const formatSec = (s: number | null) => {
            if (s === null) return 'N/A'
            const m = Math.floor(s / 60)
            const sec = s % 60
            return `${m}:${String(sec).padStart(2, '0')}`
        }

        console.log(
            `${String(order.displayNumber).padEnd(6)} | ` +
            `${toTimeStr(posOpened)} | ` +
            `${posClosed ? toTimeStr(posClosed) : 'Pending '} | ` +
            `${String(formatSec(posDurSec)).padEnd(7)} | ` +
            `${toTimeStr(kdsStart)} | ` +
            `${toTimeStr(kdsEnd)} | ` +
            `${formatSec(kdsDurSec)}`
        )
    }
}

compare()
