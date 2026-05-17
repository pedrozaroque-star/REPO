/**
 * ═══════════════════════════════════════════════════════════
 * BACKFILL FOOD COST DAILY CACHE — 2026
 * ═══════════════════════════════════════════════════════════
 * 
 * Populates food_cost_daily_cache for every day in 2026 (excluding today).
 * 
 * Strategy:
 *   - Calls /api/inventory/food-cost for each day (single-day = triggers write-through cache)
 *   - The food cost API uses pmix_daily_cache for past days (no Toast API calls needed!)
 *   - The write-through at the end of the API upserts into food_cost_daily_cache
 * 
 * Idempotent: Skips days that already have cached data in food_cost_daily_cache.
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-food-cost-2026.ts
 *   — OR —
 *   npx tsx scripts/backfill-food-cost-2026.ts
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

// ═══ HELPERS ═══

function formatDate(d: Date): string {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function getTodayLA(): string {
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
    const [mm, dd, yyyy] = nowStr.split('/')
    return `${yyyy}-${mm}-${dd}`
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`⏰ Timeout: ${label} took longer than ${ms / 1000}s`)), ms)
        )
    ])
}

// ═══ MAIN BACKFILL ═══

async function backfillFoodCost2026() {
    const startDate = new Date('2026-01-01T12:00:00')
    const todayStr = getTodayLA()
    const endDate = new Date(todayStr + 'T12:00:00')
    endDate.setDate(endDate.getDate() - 1) // Exclude today

    console.log('═══════════════════════════════════════════════════════')
    console.log('  🍽️  FOOD COST DAILY CACHE — BACKFILL 2026')
    console.log('═══════════════════════════════════════════════════════')
    console.log(`  Range: ${formatDate(startDate)} → ${formatDate(endDate)}`)
    console.log(`  Today (excluded): ${todayStr}`)
    console.log(`  API Base: ${BASE_URL}`)
    console.log('═══════════════════════════════════════════════════════\n')

    // Pre-fetch which days are already cached (idempotency check)
    const { data: existingCache } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date')
        .gte('business_date', '2026-01-01')
        .lte('business_date', formatDate(endDate))

    const cachedDates = new Set<string>()
    existingCache?.forEach(row => {
        cachedDates.add(row.business_date)
    })
    console.log(`📦 Already cached: ${cachedDates.size} days\n`)

    let current = new Date(startDate)
    let processed = 0
    let skipped = 0
    let errors = 0
    let totalDays = 0

    while (current <= endDate) {
        const dayStr = formatDate(current)
        totalDays++

        // Skip if already cached
        if (cachedDates.has(dayStr)) {
            process.stdout.write(`  ⏭️  ${dayStr} (cached)\n`)
            skipped++
            current.setDate(current.getDate() + 1)
            continue
        }

        process.stdout.write(`  🔄 ${dayStr} ... `)

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
        current.setDate(current.getDate() + 1)
    }

    // ═══ SUMMARY ═══
    console.log('\n═══════════════════════════════════════════════════════')
    console.log('  📊 BACKFILL COMPLETE')
    console.log('═══════════════════════════════════════════════════════')
    console.log(`  Total days in range: ${totalDays}`)
    console.log(`  ✅ Processed:        ${processed}`)
    console.log(`  ⏭️  Skipped (cached): ${skipped}`)
    console.log(`  ❌ Errors:           ${errors}`)
    console.log('═══════════════════════════════════════════════════════')
}

backfillFoodCost2026()
    .then(() => {
        console.log('\n🎉 Done!')
        process.exit(0)
    })
    .catch(err => {
        console.error('\n💥 Fatal error:', err)
        process.exit(1)
    })
