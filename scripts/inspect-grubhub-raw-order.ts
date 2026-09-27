/**
 * @module scripts/inspect-grubhub-raw-order
 * @description Inspects raw order structure from Toast API for Grubhub orders to examine checks, items, modifiers, discounts, and dining options.
 */
import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

// LA Broadway store GUID
const STORE_ID = '475bc112-187d-4b9c-884d-1f6a041698ce'
const BUSINESS_DATE = '20260922'

async function inspectGrubhubOrders() {
    console.log('🔑 Authenticating with Toast API...')
    const token = await getAuthToken()

    console.log(`📦 Fetching orders for store ${STORE_ID} on ${BUSINESS_DATE}...`)
    
    // Fetch dining options map
    const dRes = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': STORE_ID
        }
    })
    const diningMap: Record<string, string> = {}
    if (dRes.ok) {
        const dJson = await dRes.json()
        if (Array.isArray(dJson)) {
            dJson.forEach(d => { if (d.guid && d.name) diningMap[d.guid] = d.name })
        }
    }

    const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
    url.searchParams.append('businessDate', BUSINESS_DATE)
    url.searchParams.append('pageSize', '100')
    url.searchParams.append('page', '1')

    const fields = [
        'diningOption',
        'voided',
        'openedDate',
        'closedDate',
        'duration',
        'displayNumber',
        'checks.voided',
        'checks.amount',
        'checks.taxAmount',
        'checks.appliedDiscounts',
        'checks.appliedServiceCharges',
        'checks.payments.tipAmount',
        'checks.payments.amount',
        'checks.payments.displayName',
        'checks.payments.type',
        'checks.payments.refundAmount',
        'checks.selections.price',
        'checks.selections.preDiscountPrice',
        'checks.selections.quantity',
        'checks.selections.tax',
        'checks.selections.displayName',
        'checks.selections.voided',
        'checks.selections.appliedDiscounts',
        'checks.selections.modifiers',
        'source',
        'deliveryService'
    ].join(',')
    url.searchParams.append('fields', fields)

    const res = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': STORE_ID
        }
    })

    if (!res.ok) {
        console.error('Toast API Error:', res.status, await res.text())
        return
    }

    const orders = await res.json()
    console.log(`Received ${orders.length} orders. Finding Grubhub orders...`)

    const ghOrders = orders.filter((o: any) => {
        const dName = o.diningOption?.name || diningMap[o.diningOption?.guid] || ''
        const dService = (o.deliveryService?.name || '').toLowerCase()
        const dOptionRaw = dName.toLowerCase()
        const sourceRaw = (typeof o.source === 'string' ? o.source : (o.source?.name || '')).toLowerCase()
        const fullString = `${dService} ${dOptionRaw} ${sourceRaw}`.trim()
        return fullString.includes('grubhub') || fullString.includes('grub')
    })

    console.log(`Found ${ghOrders.length} Grubhub orders on ${BUSINESS_DATE} for LA Broadway:`)
    ghOrders.forEach((o: any, idx: number) => {
        console.log(`\n--- [Grubhub Order #${idx + 1}] DisplayNumber: ${o.displayNumber} ---`)
        console.log(`DiningOption:`, o.diningOption, `(Resolved name: ${diningMap[o.diningOption?.guid]})`)
        console.log(`DeliveryService:`, o.deliveryService)
        console.log(`Source:`, o.source)
        
        o.checks?.forEach((c: any, cIdx: number) => {
            console.log(`  Check #${cIdx + 1}: Amount=${c.amount}, Tax=${c.taxAmount}`)
            console.log(`  Applied Discounts:`, c.appliedDiscounts || [])
            console.log(`  Payments:`, c.payments?.map((p: any) => ({ type: p.type, name: p.displayName, amount: p.amount, tip: p.tipAmount })))
            console.log(`  Selections Count: ${c.selections?.length || 0}`)
            c.selections?.slice(0, 3).forEach((s: any) => {
                console.log(`    - Item: "${s.displayName}", Price: ${s.price}, PreDiscount: ${s.preDiscountPrice}, Modifiers: ${s.modifiers?.length || 0}`)
            })
        })
    })
}

inspectGrubhubOrders().catch(console.error)
