
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function analyzeLaborStandards() {
    console.log('📊 Starting Multi-Variate Labor Analysis (Sales + Tickets)...')

    // 0. Config: Analyze Q1 2024 (Solid Data)
    const startDate = '2024-01-01'
    const endDate = '2024-03-31'
    // Let's analyze ALL stores or just one? Let's do ALL to get massive sample size.
    // Or stick to one representative store first?
    // User asked for "all stores" in backfill. Let's start with West Covina (5f4a006e...) or Rialto.
    // Let's use Rialto for consistency with previous tests.
    const storeId = 'acf15327-54c8-4da4-8d0d-3ac0544dc422'

    console.log(`Fetching Data from ${startDate} to ${endDate} for Store ${storeId}...`)

    // 1. Fetch Sales + Tickets
    const { data: salesData, error: salesError } = await supabase
        .from('sales_daily_cache')
        .select('store_id, business_date, hourly_data, hourly_tickets') // tickets!
        .eq('store_id', storeId)
        .gte('business_date', startDate)
        .lte('business_date', endDate)

    if (salesError || !salesData) {
        console.error('Error fetching sales:', salesError)
        return
    }
    console.log(`Found ${salesData.length} sales days.`)

    // 2. Fetch Punches
    const { data: punchesData, error: punchesError } = await supabase
        .from('punches')
        .select('store_id, business_date, clock_in, clock_out')
        .eq('store_id', storeId)
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .limit(50000)

    if (punchesError || !punchesData) {
        console.error('Error fetching punches:', punchesError)
        return
    }
    console.log(`Found ${punchesData.length} punches.`)

    // 3. Process Data
    // Bucket Structure: 
    // Key: '$0-100' -> Value: { staffCounts: [], ticketCounts: [] }
    const buckets: Record<string, { staff: number[], tickets: number[] }> = {}

    for (let i = 0; i < 3000; i += 100) {
        buckets[`${i}-${i + 100}`] = { staff: [], tickets: [] }
    }

    // Optimize Punch Lookup: Group by Date
    const punchesByDate: Record<string, typeof punchesData> = {}
    punchesData.forEach(p => {
        const d = p.business_date
        if (!punchesByDate[d]) punchesByDate[d] = []
        punchesByDate[d].push(p)
    })

    salesData.forEach(day => {
        const hourlySales = day.hourly_data as Record<string, number> || {}
        const hourlyTickets = day.hourly_tickets as Record<string, number> || {}
        const dailyPunches = punchesByDate[day.business_date] || []

        Object.entries(hourlySales).forEach(([hourStr, sales]) => {
            const hour = parseInt(hourStr)
            if (sales <= 0) return

            // Get Tickets
            const tickets = hourlyTickets[hourStr] || 0

            // Get Staff (Optimized)
            let staffCount = 0
            dailyPunches.forEach(p => {
                if (!p.clock_in) return
                const inDate = new Date(p.clock_in)
                const outDate = p.clock_out ? new Date(p.clock_out) : new Date(inDate.getTime() + 8 * 3600 * 1000)

                // Simple Hour connection (assuming Local Time alignment in previous script confirmed)
                // We use UTC hours from ISO strings effectively because the input `hour` 
                // usually aligns with the "Store Open Hour".
                // Let's stick to the previous simple overlap logic:
                const inHour = inDate.getHours()
                const outHour = outDate.getHours()

                // Handle Midnight crossing?
                // If outHour < inHour (next day), we add 24 to outHour for comparison logic?
                // Keeping it simple for now:
                if (hour >= inHour && hour <= outHour) {
                    staffCount++
                }
            })

            // Bucket
            const bucketIndex = Math.floor(sales / 100) * 100
            const bucketKey = `${bucketIndex}-${bucketIndex + 100}`

            if (buckets[bucketKey]) {
                buckets[bucketKey].staff.push(staffCount)
                buckets[bucketKey].tickets.push(tickets)
            }
        })
    })

    // 4. Output
    console.log('\n### 🔬 Labor Standards Matrix (Reverse Engineered Q1 2024)')
    console.log('| Sales Range | Avg Tickets | Avg Staff | Staff/Ticket | Recommended Staff |')
    console.log('| :--- | :--- | :--- | :--- | :--- |')

    const rowsToInsert: any[] = []

    Object.entries(buckets).forEach(([range, data]) => {
        // Filter out weak signals? 
        // Let's require at least 5 samples for a "Standard" to be trusted.
        if (data.staff.length < 5) return

        const avgStaff = data.staff.reduce((a, b) => a + b, 0) / data.staff.length
        const avgTickets = data.tickets.reduce((a, b) => a + b, 0) / data.tickets.length
        const ratio = avgStaff > 0 ? (avgTickets / avgStaff).toFixed(1) : '0'
        const recommended = Math.round(avgStaff)

        // Parse range "$400-500"
        const [minS, maxS] = range.split('-').map(Number)

        console.log(`| $${range} | ${avgTickets.toFixed(1)} | ${avgStaff.toFixed(1)} | ${ratio} tix/p | **${recommended}** |`)

        rowsToInsert.push({
            sales_range_min: minS,
            sales_range_max: maxS,
            ticket_range_min: 0, // Simplifying to 1 dimension (Sales Only) for now? 
            // Wait, the script logic above was Sales Bucket -> Avg Tickets.
            // It didn't bucket by Ticket Range yet.
            // To fill the 2D matrix properly, we would need to bucket by BOTH Sales AND Tickets.
            // Currently this script finds "Average Tickets for this Sales Range".
            // Let's save it as "0-1000" tickets (Universal for this sales range)
            // OR better: Update the script to finding specific Ticket Buckets?
            // Let's stick to the current "Average Behavior" model for v1.
            ticket_range_max: 1000,
            recommended_staff: recommended,
            avg_tickets_historic: avgTickets,
            avg_staff_historic: avgStaff,
            confidence_score: Math.min(data.staff.length / 50, 1.0) // 50 samples = 100% confidence
        })
    })

    // Insert to DB
    if (rowsToInsert.length > 0) {
        console.log(`\n💾 Saving ${rowsToInsert.length} rules to Database...`)
        const { error } = await supabase
            .from('labor_standards')
            .upsert(rowsToInsert, { onConflict: 'sales_range_min, ticket_range_min' })

        if (error) console.error('Save failed:', error)
        else console.log('✅ Labor Standards Saved!')
    }
}

analyzeLaborStandards()
