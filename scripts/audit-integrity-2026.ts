
import { createClient } from '@supabase/supabase-js'
import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// --- CONFIG ---
const TARGET_STORE_NAME = 'West Covina'
const TARGET_STORE_ID = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'

const START_DATE = '2026-01-01'
const END_DATE = '2026-01-05'

// --- SUPABASE SETUP ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// --- TOAST API HELPERS ---
async function fetchToastDayRaw(token: string, storeId: string, date: string) {
    const url = `https://ws-api.toasttab.com/partners/v1/sales/v2?businessDate=${date}&restaurantGuid=${storeId}`
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId
        }
    })
    if (!res.ok) {
        console.warn(`Toast Sales API Warning for ${date}: ${res.status}`)
        return [] // Return empty if 404 or fails
    }
    return await res.json()
}

async function fetchLaborRaw(token: string, storeId: string, startDate: string, endDate: string) {
    const url = `https://ws-api.toasttab.com/partners/v1/labor/timeEntries?startDate=${startDate}&endDate=${endDate}&restaurantGuid=${storeId}`
    // NOTE: Labor API uses startDate/endDate (ISO8601), not businessDate? 
    // Wait, lib uses getLaborForRange which iterates?
    // Let's look at lib/toast-api.ts -> getLaborForRange logic.
    // It uses `timeEntries?businessDate=${date}` iteratively usually.
    // Let's try iterating businessDate for labor too to be safe.

    return [] // Placeholder, we will iterate in loop
}

async function fetchLaborDayRaw(token: string, storeId: string, date: string) {
    const url = `https://ws-api.toasttab.com/partners/v1/labor/timeEntries?businessDate=${date}&restaurantGuid=${storeId}`
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId
        }
    })
    if (!res.ok) return []
    return await res.json()
}

// --- MAIN AUDIT FUNCTION ---
async function audit() {
    console.log(`🕵️ AUDIT STARTED: Comparing DB vs LIVE TOAST for ${TARGET_STORE_NAME} (${START_DATE} to ${END_DATE})`)

    const token = await getAuthToken()
    if (!token) return

    // Fetch DB Data
    const { data: dbRows } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', TARGET_STORE_ID)
        .gte('business_date', START_DATE)
        .lte('business_date', END_DATE)
        .order('business_date', { ascending: true })

    const table: any[] = []

    // Verify day by day
    let currentDate = new Date(START_DATE)
    const end = new Date(END_DATE)

    while (currentDate <= end) {
        const dateStr = currentDate.toISOString().split('T')[0]

        // 1. Live Fetch
        const salesData = await fetchToastDayRaw(token, TARGET_STORE_ID, dateStr)
        const laborData = await fetchLaborDayRaw(token, TARGET_STORE_ID, dateStr)

        // 2. Aggregate Live
        let liveSales = 0
        let liveLabor = 0

        if (Array.isArray(salesData)) {
            salesData.forEach((s: any) => liveSales += (s.netAmount || 0))
        }

        if (Array.isArray(laborData)) {
            laborData.forEach((l: any) => {
                const pay = (l.hourlyWage || 0) * ((l.regularHours || 0) + (l.overtimeHours || 0))
                liveLabor += pay
            })
        }

        // 3. Compare with DB
        const dbRow = dbRows?.find(r => r.business_date === dateStr)

        const dbSales = dbRow ? dbRow.net_sales : 0
        const dbLabor = dbRow ? dbRow.labor_cost : 0

        table.push({
            Date: dateStr,
            'DB Sales': dbSales.toFixed(2),
            'API Sales': liveSales.toFixed(2),
            'Sales Match': Math.abs(dbSales - liveSales) < 1 ? '✅' : '❌',
            'DB Labor': dbLabor.toFixed(2),
            'API Labor': liveLabor.toFixed(2),
            'Labor Match': Math.abs(dbLabor - liveLabor) < 1 ? '✅' : '❌'
        })

        currentDate.setDate(currentDate.getDate() + 1)
        // Rate limit nice
        await new Promise(r => setTimeout(r, 200))
    }

    console.table(table)
}

audit()
