
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '@/lib/toast-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID

if (!TOAST_API_HOST || !TOAST_CLIENT_ID) {
    console.error('Missing env vars')
    process.exit(1)
}

async function debugLiveSales() {
    // 1. Determine "Business Today" in LA
    const now = new Date()
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    if (laTime.getHours() < 4) {
        laTime.setDate(laTime.getDate() - 1)
    }
    const yyyy = laTime.getFullYear()
    const mm = String(laTime.getMonth() + 1).padStart(2, '0')
    const dd = String(laTime.getDate()).padStart(2, '0')
    const todayStr = `${yyyy}-${mm}-${dd}`

    console.log(`🔍 DEBUG LIVE SALES for Date: ${todayStr}`)
    console.log(`🕒 Current LA Time: ${laTime.toLocaleString()}`)

    const LYNWOOD_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

    console.log(`\n📡 Fetching from Toast API (readOnly: true)...`)

    try {
        const result = await fetchToastData({
            storeIds: LYNWOOD_ID,
            startDate: todayStr,
            endDate: todayStr,
            groupBy: 'day',
            fastMode: true,
            skipCache: true,
            readOnly: true // THE NEW FLAG
        })

        if (result.connectionError) {
            console.error('❌ Connection Error:', result.connectionError)
        } else {
            console.log(`✅ Success! Rows returned: ${result.rows.length}`)
            if (result.rows.length > 0) {
                console.log('📊 DATA:', JSON.stringify(result.rows[0], null, 2))
            } else {
                console.log('⚠️ No rows returned. Is the store open?')
            }
        }

    } catch (e: any) {
        console.error('💥 Crash:', e.message)
    }
}

debugLiveSales()
