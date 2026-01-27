
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '@/lib/toast-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Format timestamps to LA time
function toLA(isoString: string | null) {
    if (!isoString) return 'NEVER'
    return new Date(isoString).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        dateStyle: 'short',
        timeStyle: 'medium'
    })
}

async function auditYesterday() {
    // 1. Determine Yesterday
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const dateStr = yesterday.toISOString().split('T')[0] // '2026-01-26'

    console.log(`🔍 AUDITING CACHE FOR: ${dateStr}`)
    console.log(`🕒 Time Check: Current LA Time is ${toLA(now.toISOString())}`)

    // 2. Fetch from Supabase Cache
    const { data: cacheRows, error } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('business_date', dateStr)

    if (error) {
        console.error('Supabase Error:', error)
        return
    }

    if (!cacheRows || cacheRows.length === 0) {
        console.log(`❌ NO CACHE found for ${dateStr}. The sync definitely didn't run or failed to delete/insert.`)
        return
    }

    // 3. Analyze sync times
    console.log(`\n📊 CACHE STATUS (${cacheRows.length} stores found):`)

    // We'll pick a few key stores or avg them, but listing them is better
    // Let's just summary stats
    let oldCacheCount = 0
    let freshCacheCount = 0
    // "Fresh" means updated TODAY (Jan 27) after say 6 AM
    const todayMorning = new Date(now)
    todayMorning.setHours(6, 0, 0, 0) // 6 AM today

    // Also pick 1 store to do a Live Comparison
    const sampleStoreId = cacheRows[0].store_id
    const sampleStoreName = "Sample Store"

    cacheRows.forEach(row => {
        const createdAt = new Date(row.created_at)
        const isFresh = createdAt > todayMorning
        if (isFresh) freshCacheCount++
        else oldCacheCount++

        if (row.store_id === sampleStoreId) {
            console.log(`   Detailed Check Store [${row.store_id.slice(0, 6)}]:`)
            console.log(`   - Cache Net Sales: $${row.net_sales}`)
            console.log(`   - DB Created At:   ${toLA(row.created_at)} (LA Time)`)
            console.log(`   - DB Updated At:   ${toLA(row.updated_at || row.created_at)}`)
        }
    })

    console.log(`\n📉 SUMMARY:`)
    console.log(`   - Updated TODAY (after 6am): ${freshCacheCount} / ${cacheRows.length}`)
    console.log(`   - Stale (Yesterday/Night):   ${oldCacheCount} / ${cacheRows.length}`)

    if (oldCacheCount > 0) {
        console.log(`\n⚠️  WARNING: ${oldCacheCount} stores have STALE data from before today's morning sync.`)
        console.log(`   This explains why sales look "less". You are seeing partial data captured yesterday.`)
    } else {
        console.log(`\n✅ Timestamps look fresh. Checking values...`)
    }

    // 4. Live Comparison
    console.log(`\n📡 FETCHING LIVE TRUTH from Toast for Single Store...`)
    try {
        const liveData = await fetchToastData({
            storeIds: sampleStoreId,
            startDate: dateStr,
            endDate: dateStr,
            groupBy: 'day',
            skipCache: true
        })

        if (liveData.rows.length > 0) {
            const liveSales = liveData.rows[0].net_sales
            // Find cache row
            const cacheRow = cacheRows.find(r => r.store_id === sampleStoreId)
            const cacheSales = cacheRow ? cacheRow.net_sales : 0

            console.log(`   - LIVE Toast Net Sales: $${liveSales}`)
            console.log(`   - CACHE Supabase Sales: $${cacheSales}`)

            const diff = liveSales - cacheSales
            if (Math.abs(diff) > 1) {
                console.log(`❌ DISCREPANCY DETECTED: Cache is missing $${diff.toFixed(2)}`)
                console.log(`💡 CONCLUSION: The cache is outdated. Run 'npm run sync-yesterday' immediatley.`)
            } else {
                console.log(`✅ MATCH: Cache matches Live perfectly.`)
            }
        }
    } catch (e: any) {
        console.error("Live fetch failed:", e.message)
    }
}

auditYesterday()
