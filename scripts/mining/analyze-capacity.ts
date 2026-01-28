
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// LOAD ROLE MAP
const roleMapPath = path.join(process.cwd(), 'scripts', 'mining', 'role-map.json')
const ROLE_MAP = JSON.parse(fs.readFileSync(roleMapPath, 'utf-8'))

async function analyzeCapacity() {
    console.log('🔬 ANALYZING CAPACITY & DIAGNOSING ROLES...')

    // 1. Fetch Top 100 Days
    const { data: days } = await supabase
        .from('sales_daily_cache')
        .select('store_id, business_date, hourly_tickets, net_sales')
        .gte('business_date', '2025-06-01') // Recent data is better
        .limit(100)

    if (!days || days.length === 0) { console.log('No days found'); return }

    const targetDates = days.map(d => d.business_date)
    const storeIds = [...new Set(days.map(d => d.store_id))]

    const { data: punches } = await supabase
        .from('punches')
        .select('store_id, business_date, job_toast_guid, regular_hours, overtime_hours')
        .in('store_id', storeIds)
        .in('business_date', targetDates)

    if (!punches) { console.log('No punches.'); return }

    // --- DIAGNOSTIC BLOCK ---
    let matchedCashier = 0
    let matchedKitchen = 0
    const unmapped = new Set<string>()

    punches.forEach((p: any) => {
        const role = ROLE_MAP[p.job_toast_guid]
        if (role === 'CASHIER') matchedCashier++
        else if (role === 'KITCHEN') matchedKitchen++
        else unmapped.add(p.job_toast_guid || 'NULL')
    })

    console.log(`\n🕵️‍♂️ ROLE MATCHING REPORT:`)
    console.log(`   ✅ Cashier Punches: ${matchedCashier}`)
    console.log(`   ✅ Kitchen Punches: ${matchedKitchen}`)
    console.log(`   ⚠️ Unmapped GUIDs: ${unmapped.size}`)

    if (unmapped.size > 0) {
        console.log('   Sample Unmapped GUIDs:', Array.from(unmapped).slice(0, 5))
    }

    if (matchedCashier === 0) {
        console.log('❌ CRITICAL: No Cashier punches found in sample. Mapping is incomplete or roles are named differently.')
        return
    }

    // --- CALCULATION BLOCK ---
    const stats = { cashierTph: [] as number[], prepSph: [] as number[] }
    // Group Punches by Day
    const laborMap: any = {}
    punches.forEach((p: any) => {
        const k = `${p.store_id}_${p.business_date}`
        if (!laborMap[k]) laborMap[k] = { c: 0, k: 0 }
        const h = (p.regular_hours || 0) + (p.overtime_hours || 0)
        const role = ROLE_MAP[p.job_toast_guid]
        if (role === 'CASHIER') laborMap[k].c += h
        if (role === 'KITCHEN') laborMap[k].k += h
    })

    days.forEach(day => {
        const labor = laborMap[`${day.store_id}_${day.business_date}`]
        if (!labor) return

        // Sum tickets
        let tix = 0
        if (day.hourly_tickets) Object.values(day.hourly_tickets).forEach((v: any) => tix += Number(v))

        const sales = Number(day.net_sales || 0)

        // Lower thresholds to catch ANY valid data
        if (labor.c > 0.5 && tix > 0) {
            stats.cashierTph.push(tix / labor.c)
        }
        if (labor.k > 0.5 && sales > 0) {
            stats.prepSph.push(sales / labor.k)
        }
    })

    const median = (arr: number[]) => arr.length ? arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)] : 0

    console.log('\n📊 RESULTS:')
    console.log(`   Median Tickets/CashierHr: ${median(stats.cashierTph).toFixed(1)}`)
    console.log(`   Median Sales/KitchenHr: $${median(stats.prepSph).toFixed(0)}`)

    // Write config
    const config = {
        cashier_tickets_per_hour: Number(median(stats.cashierTph).toFixed(1)),
        prep_sales_per_hour: Number(median(stats.prepSph).toFixed(2))
    }
    fs.writeFileSync(path.join(process.cwd(), 'scripts', 'mining', 'capacity-config.json'), JSON.stringify(config, null, 2))
}

analyzeCapacity()
