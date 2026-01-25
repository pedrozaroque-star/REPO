
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

// Helper to enforce timeouts
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms}ms`)), ms)
        )
    ])
}

// Main reusable function for a range
export async function runBackfillRange(startStr: string, endStr: string) {
    console.log(`🚀 Starting Backfill Range: ${startStr} to ${endStr}`)

    const startDate = new Date(startStr + 'T12:00:00')
    const endDate = new Date(endStr + 'T12:00:00')
    let current = new Date(startDate)

    // Direction check
    const isReverse = startDate > endDate
    const step = isReverse ? -1 : 1

    // Condition helper
    const shouldContinue = () => isReverse ? current >= endDate : current <= endDate

    while (shouldContinue()) {
        const dayStr = current.toISOString().split('T')[0]

        let runSales = true
        // CHECK IDEMPOTENCY
        const { count } = await supabase
            .from('sales_daily_cache')
            .select('*', { count: 'exact', head: true })
            .eq('business_date', dayStr)

        if (count && count > 0) {
            runSales = false
            process.stdout.write(`Skipping ${dayStr} (Cached) `)
            // Even if cached, we might want to check for Punches?
            // User requested "solo rellene los dias que no se pudieron hacer" (fill gaps).
            // Current hybrid logic: If Sales cached -> Skip Sales Fetch -> Check/Sync Punches.
            // This is perfect for "FILLING GAPS" in both tables.
        } else {
            process.stdout.write(`Processing ${dayStr} [Fetching...] `)
        }

        // ... (rest of logic matches previous implementation, just moving inside this function)
        // Copying the improved Try/Catch block with Timeouts from previous step

        try {
            let activeStores: string[] = []

            // A. SALES SYNC
            if (runSales) {
                const result = await withTimeout(
                    fetchToastData({
                        storeIds: 'all',
                        startDate: dayStr,
                        endDate: dayStr,
                        groupBy: 'day'
                    }),
                    60000,
                    'FetchSales'
                )
                activeStores = result.rows.map(r => r.storeId)
                process.stdout.write(`Done. `)
            } else {
                const { data: cachedStores } = await supabase
                    .from('sales_daily_cache')
                    .select('store_id')
                    .eq('business_date', dayStr)
                activeStores = cachedStores?.map(c => c.store_id) || []
            }

            // B. SYNC PUNCHES
            // If we have active stores (either fetched or cached), we MUST check punches
            // But if 'runSales' was false, we might want to skip punches if they also exist?
            // User said "fill gaps". 
            // If we want to be super fast, we should check if punches exist too.
            // But previous logic (Sync Always) is safer for the 2024 issue. 
            // Let's stick to "Sync Punches Always if Stores Known" for safety.

            if (activeStores.length > 0) {
                let punchSuccess = 0
                let punchFail = 0
                for (const storeId of activeStores) {
                    try {
                        const startIso = `${dayStr}T00:00:00.000+0000`
                        const endIso = `${dayStr}T23:59:59.999+0000`
                        const res = await withTimeout(
                            syncToastPunches(storeId, startIso, endIso),
                            30000,
                            `PunchSync`
                        )
                        if (res.error) punchFail++
                        else punchSuccess++
                    } catch (e) { punchFail++ }
                }
                // console.log(`[Punches: ${punchSuccess} OK]`) 
                // Minimal log to keep timeline clean
            }

            process.stdout.write(`\n`) // Newline after day line

        } catch (err) {
            console.error(`\n❌ Error ${dayStr}:`, err)
        }

        current.setDate(current.getDate() + step)
        await new Promise(r => setTimeout(r, 50)) // 50ms is enough
    }
    console.log(`✅ Range Complete: ${startStr} to ${endStr}`)
}

export async function runBackfill(currentYear: number) {
    const startStr = `${currentYear}-01-01`
    const endStr = `${currentYear}-12-31`
    await runBackfillRange(startStr, endStr)
}
