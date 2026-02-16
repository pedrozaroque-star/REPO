
import { fetchToastData } from '../lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl!, supabaseServiceKey!)

async function auditWithLib() {
    const STORE_ID = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02' // West Covina
    const START = '2026-01-01'
    const END = '2026-01-05'

    console.log(`🕵️ AUDIT (Lib-Based): Checking West Covina for ${START} to ${END}...`)

    // 1. Fetch from DB
    const { data: dbRows } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .gte('business_date', START)
        .lte('business_date', END)
        .order('business_date', { ascending: true })

    // 2. Fetch from Toast Live (Skip Cache)
    // Note: This WILL apply the 24% patch if it's currently active in lib/toast-api.ts
    // We want to know what the API returns RAW, but we can't easily strip the patch logic without modifying the file again.
    // However, we can infer.

    const res = await fetchToastData({
        storeIds: STORE_ID,
        startDate: START,
        endDate: END,
        groupBy: 'day',
        skipCache: true
    })

    const liveRows = res.rows

    // 3. Compare
    const table: any[] = []

    // We iterate the date range to match
    const dateMap = new Map()
    liveRows.forEach(r => dateMap.set(r.periodStart, r))

    dbRows?.forEach(db => {
        const live = dateMap.get(db.business_date)

        if (!live) {
            table.push({ Date: db.business_date, Status: 'MISSING IN LIVE FETCH' })
            return
        }

        table.push({
            Date: db.business_date,
            'DB Sales': db.net_sales,
            'Live Sales': live.netSales,
            'DB Labor': db.labor_cost,
            'Live Labor': live.laborCost, // This includes 24% patch if active
            'Match': (db.net_sales === live.netSales && Math.abs(db.labor_cost - live.laborCost) < 0.1) ? '✅' : '❌'
        })
    })

    console.table(table)
}

auditWithLib()
