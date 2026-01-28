
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
const KEYWORDS = {
    FOH: ['cashier', 'shift', 'manager'],
    BOH: ['cook', 'taquero', 'dish', 'prep']
}

async function mineEfficiency() {
    console.log("⛏️ Mining REAL Efficiency (SPLH) for Lynwood (Last 3 Months)...")

    // 1. Get Job GUIDs & Map
    const { data: allJobs } = await supabase.from('toast_jobs').select('title, guid')
    const roleMap = { FOH: [] as string[], BOH: [] as string[] }
    allJobs?.forEach(j => {
        const title = j.title.toLowerCase()
        if (KEYWORDS.FOH.some(k => title.includes(k))) roleMap.FOH.push(j.guid)
        else if (KEYWORDS.BOH.some(k => title.includes(k))) roleMap.BOH.push(j.guid)
    })
    console.log(`   Mapped ${roleMap.FOH.length} FOH and ${roleMap.BOH.length} BOH roles.`)

    // 2. Fetch Data
    const startDate = '2025-11-01'
    const endDate = '2026-02-01' // Feb 1st (exclusive)

    // SALES
    const { data: salesData } = await supabase
        .from('sales_daily_cache')
        .select('business_date, hourly_data, hourly_tickets')
        .eq('store_id', STORE_ID)
        .gte('business_date', startDate)
        .lt('business_date', endDate)

    const salesByDate: any = {}
    salesData?.forEach(r => salesByDate[r.business_date] = r)

    // PUNCHES
    let allPunches: any[] = []
    const chunks = [['2025-11-01', '2025-12-01'], ['2025-12-01', '2026-01-01'], ['2026-01-01', '2026-02-01']]
    for (const [s, e] of chunks) {
        process.stdout.write('.')
        const { data: p } = await supabase.from('punches').select('business_date, clock_in, clock_out, job_toast_guid').eq('store_id', STORE_ID).gte('business_date', s).lt('business_date', e).limit(15000)
        if (p) allPunches = [...allPunches, ...p]
    }
    console.log(`\n   Loaded ${allPunches.length} shifts.`)

    // Group punches by date for speed O(1)
    const punchesByDate: Record<string, any[]> = {}
    allPunches.forEach(p => {
        if (!punchesByDate[p.business_date]) punchesByDate[p.business_date] = []
        punchesByDate[p.business_date].push(p)
    })

    // 3. Calculate Efficiency Hour by Hour
    let totalDollars = 0
    let totalBohHours = 0
    let salesSamples = 0

    let totalTickets = 0
    let totalFohHours = 0
    let ticketSamples = 0

    // Helper for Timezone
    const toLocalHour = (dStr: string) => {
        const d = new Date(dStr)
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).formatToParts(d)
        const hPart = parts.find(p => p.type === 'hour')
        return hPart ? parseInt(hPart.value) : -1
    }

    // Loop Days
    for (const dStr of Object.keys(salesByDate)) {
        const dayPunches = punchesByDate[dStr] || []
        const daySales = salesByDate[dStr]

        // Loop Hours 11am - 10pm
        for (let h = 11; h <= 22; h++) {
            const dollars = Number(daySales.hourly_data[h] || 0)
            const tickets = Number(daySales.hourly_tickets[h] || 0)

            if (dollars < 100) continue // Skip low volume hours (skew data)

            // Count Staff Active at H:30
            let cooks = 0
            let cashiers = 0

            dayPunches.forEach((p: any) => {
                if (!p.clock_out) return
                const inH = toLocalHour(p.clock_in)
                const outH = toLocalHour(p.clock_out)

                let isWorking = false
                if (outH < inH) {
                    if (h >= inH || h < outH) isWorking = true
                } else {
                    if (h >= inH && h < outH) isWorking = true
                }

                if (isWorking) {
                    if (roleMap.FOH.includes(p.job_toast_guid)) cashiers++
                    if (roleMap.BOH.includes(p.job_toast_guid)) cooks++
                }
            })

            // Aggregate
            if (cooks > 0) {
                totalDollars += dollars
                totalBohHours += cooks // e.g. 5 cooks worked 1 hour = 5 labor hours
                salesSamples++
            }
            if (cashiers > 0) {
                totalTickets += tickets
                totalFohHours += cashiers
                ticketSamples++
            }
        }
    }

    // RESULTS
    const splh = totalBohHours > 0 ? (totalDollars / totalBohHours) : 0
    const tplh = totalFohHours > 0 ? (totalTickets / totalFohHours) : 0

    const report = {
        meta: { range: 'Nov 2025 - Jan 2026', store: 'Lynwood (80a1...)' },
        kitchen: {
            real_splh: Math.round(splh),
            note: `Generan $${Math.round(splh)} por hora-hombre.`,
            sample_hours: salesSamples
        },
        foh: {
            real_tplh: tplh.toFixed(1),
            note: `Procesan ${tplh.toFixed(1)} tickets por hora-hombre.`,
            sample_hours: ticketSamples
        }
    }

    console.log("\n--- 📊 REALITY CHECK ---")
    console.log(`Kitchen SPLH: $${report.kitchen.real_splh}`)
    console.log(`Cashier TPLH: ${report.foh.real_tplh}`)

    fs.writeFileSync('scripts/mining/efficiency-report.json', JSON.stringify(report, null, 2))
}

mineEfficiency()
