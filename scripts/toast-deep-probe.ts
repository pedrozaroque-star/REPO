
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

// Santa Ana GUID
const TARGET_GUID = '3c2d8251-c43c-43b8-8306-387e0a4ed7c2'

async function getAuthToken() {
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })
    if (!res.ok) throw new Error(`Auth Failed: ${res.status}`)
    const data: any = await res.json()
    return data.token.accessToken
}

async function probe() {
    try {
        console.log('🕵️‍♂️ Starting Deep Probe for Santa Ana Address...')
        const token = await getAuthToken()

        // 1. STANDARD PARTNER DETAIL
        console.log('\n--- 1. Checking Partner Detail API ---')
        const r1 = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants/${TARGET_GUID}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        if (r1.ok) {
            const d1: any = await r1.json()
            console.log('Result:', JSON.stringify(d1.address || "NO ADDRESS OBJECT", null, 2))
        } else console.log('Failed:', r1.status)

        // 2. CONFIG V2 (Often blocked but worth a try)
        console.log('\n--- 2. Checking Config V2 API ---')
        const r2 = await fetch(`${TOAST_API_HOST}/config/v2/restaurants/${TARGET_GUID}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        if (r2.ok) {
            const d2: any = await r2.json()
            console.log('Result:', JSON.stringify(d2, null, 2))
        } else console.log('Failed:', r2.status)

        // 3. ORDERS API (Inspect a recent order to see store info in header?)
        console.log('\n--- 3. Checking Orders API (Metadata) ---')
        // We fetch one order from today
        const today = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z'
        const r3 = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${today.split('T')[0].replace(/-/g, '')}&pageSize=1`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': TARGET_GUID
            }
        })
        if (r3.ok) {
            const d3: any = await r3.json()
            // Sometimes orders have restaurant info embedded?
            console.log('Orders Found:', d3.length)
            if (d3.length > 0) console.log('First Order Keys:', Object.keys(d3[0]))
        } else console.log('Failed:', r3.status)

    } catch (e) {
        console.error(e)
    }
}

probe()
