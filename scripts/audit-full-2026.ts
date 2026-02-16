
import { fetchToastData } from '../lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
// Add strict null check bypass or handle error if env missing (though we checked before)
const supabase = createClient(supabaseUrl!, supabaseServiceKey!)

async function auditFull() {
    // West Covina as reference store
    const STORE_ID = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'
    const START = '2026-01-01'
    const END = '2026-02-15'

    console.log(`🕵️ DEEP AUDIT 2026: DB Cache vs Live API (via toast-api.ts)`)
    console.log(`Target: West Covina | Range: ${START} to ${END}`)

    // 1. Fetch DB
    const { data: dbRows, error } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .gte('business_date', START)
        .lte('business_date', END)
        .order('business_date')

    if (error) { console.error(error); return; }

    // 2. Fetch Live (processed by lib)
    // We do it in chunks to avoid timeout
    const chunkStats = {
        matches: 0,
        mismatches: 0,
        missingInDB: 0
    }

    console.log(`\n--- STARTING COMPARISON ---`)
    console.log(`(Showing only MISMATCHES to keep log clean. If empty, everything matches.)`)

    // We can fetch month by month to be efficient
    // Chunk 1: Jan
    await processChunk(STORE_ID, '2026-01-01', '2026-01-31', dbRows, chunkStats)
    // Chunk 2: Feb 1-15
    await processChunk(STORE_ID, '2026-02-01', '2026-02-15', dbRows, chunkStats)

    console.log(`\n--- AUDIT RESULTS ---`)
    console.log(`✅ Matches: ${chunkStats.matches}`)
    console.log(`❌ Mismatches: ${chunkStats.mismatches}`)
    console.log(`⚠️ Missing in DB: ${chunkStats.missingInDB}`)
}

async function processChunk(storeId: string, start: string, end: string, dbRows: any[], stats: any) {
    console.log(`Scanning ${start} -> ${end}...`)
    try {
        const res = await fetchToastData({
            storeIds: storeId,
            startDate: start,
            endDate: end,
            groupBy: 'day',
            skipCache: true // FORCE LIVE
        })

        const liveMap = new Map()
        res.rows.forEach(r => liveMap.set(r.periodStart, r))

        // Iterate dates in range
        let curr = new Date(start)
        const e = new Date(end)

        while (curr <= e) {
            const dateStr = curr.toISOString().split('T')[0]
            const live = liveMap.get(dateStr)
            const db = dbRows.find(r => r.business_date === dateStr)

            if (!live) {
                // No data in Live? Likely simulation future
                curr.setDate(curr.getDate() + 1)
                continue
            }

            if (!db) {
                console.warn(`⚠️ [${dateStr}] Missing in DB Cache!`)
                stats.missingInDB++
            } else {
                // Compare Fields
                const diffs = []
                if (Math.abs(db.net_sales - live.netSales) > 1) diffs.push(`Sales: DB=${db.net_sales} vs API=${live.netSales}`)
                if (Math.abs(db.gross_sales - live.grossSales) > 1) diffs.push(`Gross: DB=${db.gross_sales} vs API=${live.grossSales}`)
                if (Math.abs(db.labor_cost - live.laborCost) > 1) diffs.push(`Labor: DB=${db.labor_cost} vs API=${live.laborCost}`)
                if (Math.abs(db.tips - live.tips) > 1) diffs.push(`Tips: DB=${db.tips} vs API=${live.tips}`)
                if (Math.abs(db.discounts - live.discounts) > 1) diffs.push(`Disc: DB=${db.discounts} vs API=${live.discounts}`)

                if (diffs.length > 0) {
                    console.error(`❌ [${dateStr}] MISMATCH:\n   ` + diffs.join('\n   '))
                    stats.mismatches++
                } else {
                    stats.matches++
                }
            }

            curr.setDate(curr.getDate() + 1)
        }

    } catch (e) {
        console.error(`Error processing chunk ${start}-${end}:`, e)
    }
}

auditFull()
