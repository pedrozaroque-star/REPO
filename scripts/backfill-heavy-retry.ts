
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Helper to enforce timeouts (Extended to 3 mins)
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms}ms`)), ms)
        )
    ])
}

async function runHeavyRetry() {
    // REVERSE: Jan 23 2026 -> Nov 1 2020
    const startStr = '2026-01-23'
    const endStr = '2020-11-01'

    console.log(`🐢 Starting HEAVY RETRY Backfill (3min Timeout)`)
    console.log(`📅 Range: ${startStr} -> ${endStr} (Reverse)`)

    const startDate = new Date(startStr + 'T12:00:00')
    const endDate = new Date(endStr + 'T12:00:00')
    let current = new Date(startDate)

    // Direction check
    const isReverse = startDate > endDate
    const step = isReverse ? -1 : 1
    const shouldContinue = () => isReverse ? current >= endDate : current <= endDate

    while (shouldContinue()) {
        const dayStr = current.toISOString().split('T')[0]

        try {
            // 1. STRICT CHECK: Do we have Sales AND Punches?
            const { count: salesCount } = await supabase
                .from('sales_daily_cache')
                .select('*', { count: 'exact', head: true })
                .eq('business_date', dayStr)

            // If Sales exist, check punches too. If user wants to skip "everything done", 
            // we assume "done" means Sales + Punches present.
            // Efficient check: Just check sales first. If missing, definitely run. 
            // If sales present, check punches.

            let skip = false
            if (salesCount && salesCount > 0) {
                // Check punches
                const { count: punchCount } = await supabase
                    .from('punches')
                    .select('*', { count: 'exact', head: true })
                    .eq('business_date', dayStr)
                    .limit(1)

                // If we have at least 1 punch (or if store was closed but handled), we consider it done?
                // Some days truly have 0 punches. But usually 2024 issue had 0.
                // If punchCount > 0, we are safe.
                if (punchCount && punchCount > 0) {
                    skip = true
                } else {
                    // Check if it was a "Zero Sales" day?
                    // If Sales cached but row has net_sales = 0, maybe punches should be 0.
                    // But we want to be safe. If 0 punches, we retry labor logic.
                    process.stdout.write(`Partial Data ${dayStr} (Sales OK, Punches Missing). Retrying... `)
                }
            }

            if (skip) {
                process.stdout.write(`⏭️ Correct ${dayStr} \r`) // Overwrite line to be clean/fast
            } else {
                console.log(`\n🔄 Retrying ${dayStr}...`)

                // --- EXECUTION (With 3m Timeout) ---

                // A. SALES
                let activeStores: string[] = []
                let salesDone = false

                if (!salesCount || salesCount === 0) {
                    const result = await withTimeout(
                        fetchToastData({
                            storeIds: 'all',
                            startDate: dayStr,
                            endDate: dayStr,
                            groupBy: 'day'
                        }),
                        180000, // 3 Minutes
                        'FetchSales'
                    )
                    activeStores = result.rows.map(r => r.storeId)
                    console.log(`   Sales: Recovered ${result.rows.length} stores.`)
                    salesDone = true
                } else {
                    // Fetch stores from cache for Punch sync
                    const { data: cachedStores } = await supabase
                        .from('sales_daily_cache')
                        .select('store_id')
                        .eq('business_date', dayStr)
                    activeStores = cachedStores?.map(c => c.store_id) || []
                    console.log(`   Sales: already cached.`)
                }

                // B. PUNCHES
                if (activeStores.length > 0) {
                    let punchSuccess = 0
                    let punchFail = 0
                    for (const storeId of activeStores) {
                        try {
                            const startIso = `${dayStr}T00:00:00.000+0000`
                            const endIso = `${dayStr}T23:59:59.999+0000`
                            const res = await withTimeout(
                                syncToastPunches(storeId, startIso, endIso),
                                180000, // 3 Minutes per store
                                `PunchSync`
                            )
                            if (res.error) punchFail++
                            else punchSuccess++
                        } catch (e) { punchFail++ }
                    }
                    console.log(`   Punches: ${punchSuccess} OK, ${punchFail} Fail`)
                }
            }

        } catch (err) {
            console.error(`\n❌ Failed ${dayStr}:`, err)
        }

        current.setDate(current.getDate() + step)
        await new Promise(r => setTimeout(r, 10)) // Super fast iteration
    }
    console.log(`\n✅ Heavy Retry Complete.`)
}

runHeavyRetry()
