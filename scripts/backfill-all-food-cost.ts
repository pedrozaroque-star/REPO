/**
 * ═══════════════════════════════════════════════════════════
 * BACKFILL ALL FOOD COST DAILY CACHE
 * ═══════════════════════════════════════════════════════════
 * 
 * Populates food_cost_daily_cache for EVERY date present in pmix_daily_cache.
 * Uses DB RPC to retrieve the distinct dates, bypassing any pagination limits.
 * 
 * Strategy:
 *   - Fetches distinct dates from pmix_daily_cache.
 *   - Checks which dates are already cached.
 *   - Calls /api/inventory/food-cost for each missing date.
 * 
 * Usage:
 *   npx tsx scripts/backfill-all-food-cost.ts
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`⏰ Timeout: ${label} took longer than ${ms / 1000}s`)), ms)
        )
    ])
}

async function backfillAll() {
    console.log('═══════════════════════════════════════════════════════')
    console.log('  🍽️  FOOD COST DAILY CACHE — MASTER BACKFILL')
    console.log('═══════════════════════════════════════════════════════')
    console.log(`  API Base: ${BASE_URL}`)
    console.log('═══════════════════════════════════════════════════════\n')

    // 1. Get all distinct dates from pmix_daily_cache
    console.log('🔍 Fetching all distinct dates with sales data (PMIX)...')
    const { data: dbDates, error: datesError } = await supabase.rpc('execute_sql', {
        query_text: 'SELECT DISTINCT business_date::text FROM pmix_daily_cache ORDER BY business_date DESC'
    })

    if (datesError) {
        console.error('❌ Error fetching dates from pmix_daily_cache:', datesError.message)
        process.exit(1)
    }

    const allDates: string[] = dbDates?.map((row: any) => row.business_date) || []
    console.log(`📊 Found ${allDates.length} unique dates with sales data in DB.`)

    if (allDates.length === 0) {
        console.log('No dates found. Exiting.')
        return
    }

    console.log(`   Date range: ${allDates[allDates.length - 1]} to ${allDates[0]}\n`)

    // 2. Fetch already cached dates
    console.log('🔍 Checking existing food cost cache...')
    const { data: cachedRows, error: cacheError } = await supabase.rpc('execute_sql', {
        query_text: 'SELECT DISTINCT business_date::text FROM food_cost_daily_cache'
    })

    if (cacheError) {
        console.error('❌ Error checking cache:', cacheError.message)
        process.exit(1)
    }

    const cachedDates = new Set<string>(cachedRows?.map((row: any) => row.business_date) || [])
    console.log(`📦 Already cached: ${cachedDates.size} dates\n`)

    // Filter down to dates we actually need to calculate
    const missingDates = allDates.filter(d => !cachedDates.has(d))
    console.log(`🔄 Dates to process: ${missingDates.length} dates\n`)

    if (missingDates.length === 0) {
        console.log('🎉 Everything is already cached! Done.')
        return
    }

    let processed = 0
    let errors = 0

    // Process from oldest to newest to reconstruct history in order
    const datesToProcess = [...missingDates].reverse()

    for (let i = 0; i < datesToProcess.length; i++) {
        const dayStr = datesToProcess[i]
        console.log(`[${i + 1}/${datesToProcess.length}] 🔄 ${dayStr} ... `)

        try {
            const url = `${BASE_URL}/api/inventory/food-cost?storeId=all&startDate=${dayStr}&endDate=${dayStr}`

            const res = await withTimeout(
                fetch(url),
                120000, // 2 minute timeout per day
                `FoodCost ${dayStr}`
            )

            if (!res.ok) {
                const errText = await res.text().catch(() => '')
                console.log(`❌ HTTP ${res.status}: ${errText.slice(0, 100)}`)
                errors++
            } else {
                const json = await res.json()
                const itemCount = json.data?.length || 0
                
                // Calculate aggregate for logging
                let totalCost = 0
                let totalSales = 0
                json.data?.forEach((item: any) => {
                    totalCost += item.total_cost || 0
                    totalSales += item.net_sales || 0
                })
                const pct = totalSales > 0 ? ((totalCost / totalSales) * 100).toFixed(1) : '0.0'

                console.log(`✅ ${itemCount} items | $${totalCost.toFixed(0)} cost / $${totalSales.toFixed(0)} sales = ${pct}% FC`)
                processed++
            }
        } catch (err: any) {
            console.log(`❌ ${err.message || 'Unknown error'}`)
            errors++
        }

        // Small delay to avoid overwhelming the server
        await new Promise(r => setTimeout(r, 200))
    }

    console.log('\n═══════════════════════════════════════════════════════')
    console.log('  📊 MASTER BACKFILL COMPLETE')
    console.log('═══════════════════════════════════════════════════════')
    console.log(`  Processed: ${processed}`)
    console.log(`  Errors:    ${errors}`)
    console.log('═══════════════════════════════════════════════════════')
}

backfillAll()
    .then(() => {
        console.log('\n🎉 Done!')
        process.exit(0)
    })
    .catch(err => {
        console.error('\n💥 Fatal error:', err)
        process.exit(1)
    })
