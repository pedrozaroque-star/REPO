
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

// LIST OF KNOWN STORES (From toast-api.ts)
const KNOWN_STORES = [
    'acf15327-54c8-4da4-8d0d-3ac0544dc422', // Rialto
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8', // Azusa
    '42ed15a6-106b-466a-9076-1e8f72451f6b', // Norwalk
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a', // Downey
    '475bc112-187d-4b9c-884d-1f6a041698ce', // LA Broadway
    'a83901db-2431-4283-834e-9502a2ba4b3b', // Bell
    '5fbb58f5-283c-4ea4-9415-04100ee6978b', // Hollywood
    '47256ade-2cd4-4073-9632-84567ad9e2c8', // Huntington Park
    '8685e942-3f07-403a-afb6-faec697cd2cb', // LA Central
    '3a803939-eb13-4def-a1a4-462df8e90623', // La Puente
    '80a1ec95-bc73-402e-8884-e5abbe9343e6', // Lynwood
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2', // Santa Ana
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd', // Slauson
    '95866cfc-eeb8-4af9-9586-f78931e1ea04', // South Gate
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'  // West Covina
]

async function runHeavyRetry() {
    // REVERSE: Dec 31 2022 -> Jan 01 2020
    const startStr = '2022-12-31'
    const endStr = '2020-01-01'

    console.log(`🐢 Starting GRANULAR RETRY Backfill (Sequential Store Fetch)`)
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
            // 1. GRANULAR CHECK: Which stores are already done?
            const { data: existingRows } = await supabase
                .from('sales_daily_cache')
                .select('store_id')
                .eq('business_date', dayStr)

            const doneStoreIds = new Set(existingRows?.map(r => r.store_id) || [])

            // Identify Missing Stores
            const missingStores = KNOWN_STORES.filter(id => !doneStoreIds.has(id))

            if (missingStores.length === 0) {
                process.stdout.write(`⏭️  ${dayStr} Complete (15/15). \r`)
            } else {
                console.log(`\nProcessing ${dayStr}: Missing ${missingStores.length} stores...`)

                for (const storeId of missingStores) {
                    process.stdout.write(`   > Store ${storeId.slice(0, 8)}: `)

                    // A. SALES (Sequential)
                    let success = false
                    try {
                        const result = await withTimeout(
                            fetchToastData({
                                storeIds: storeId, // Fetch SINGLE store
                                startDate: dayStr,
                                endDate: dayStr,
                                groupBy: 'day'
                            }),
                            180000, // 3 Minutes
                            'FetchSales'
                        )
                        if (result.rows.length > 0) {
                            process.stdout.write(`Sales OK. `)
                            success = true
                        } else {
                            process.stdout.write(`No Data. `)
                        }
                    } catch (err: any) {
                        process.stdout.write(`❌ Sales Fail: ${err.message}. `)
                    }

                    // B. PUNCHES (Sequential) with explicit storeId
                    // Even if sales failed, try labor? No, labor needs store context usually?
                    // Yes, try labor regardless as requested by gap-fill logic
                    try {
                        const startIso = `${dayStr}T00:00:00.000+0000`
                        const endIso = `${dayStr}T23:59:59.999+0000`
                        const res = await withTimeout(
                            syncToastPunches(storeId, startIso, endIso),
                            180000,
                            `PunchSync`
                        )
                        if (res.error) process.stdout.write(`Punch Fail. `)
                        else process.stdout.write(`Punch OK.`)
                    } catch (e) { process.stdout.write(`Punch Timeout.`) }

                    process.stdout.write(`\n`)
                }
            }

        } catch (err) {
            console.error(`\n❌ Failed Day ${dayStr}:`, err)
        }

        current.setDate(current.getDate() + step)
        await new Promise(r => setTimeout(r, 10))
    }
    console.log(`\n✅ Granular Retry Complete.`)
}

runHeavyRetry()
