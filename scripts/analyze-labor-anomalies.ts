
import { getSupabaseClient } from '@/lib/supabase'

async function analyzeLaborAnomalies() {
    const supabase = await getSupabaseClient()

    console.log("🔍 Fetching 2026 punches...")

    // 1. Fetch Punches with Pagination
    let allPunches: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
        const { data: chunk, error } = await supabase
            .from('punches')
            .select('*')
            .gte('business_date', '2026-01-01')
            .order('business_date', { ascending: true })
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error("Error fetching page " + page, error)
            break
        }

        if (chunk && chunk.length > 0) {
            allPunches = [...allPunches, ...chunk]
            process.stdout.write(`Fetching... ${allPunches.length} records\r`)
            if (chunk.length < pageSize) hasMore = false
            page++
        } else {
            hasMore = false
        }
    }
    console.log(`\n📦 Analyzed ${allPunches.length} shifts (Total).`)

    // Group by Store -> Date -> Employee
    const punches = allPunches


    // 2. Fetch Stores (Toast Global GUID map)
    const { data: stores } = await supabase.from('stores').select('id, name, external_id')
    const storeMap = new Map<string, string>()
    stores?.forEach(s => {
        if (s.external_id) storeMap.set(s.external_id, s.name)
    })

    console.log(`📦 Analyzed ${punches.length} shifts across ${storeMap.size} stores. Detecting anomalies...`)

    // Group by Store -> Date -> Employee
    const grouped: Record<string, Record<string, Record<string, any[]>>> = {}

    punches.forEach(p => {
        if (!p.store_id || !p.business_date || !p.employee_toast_guid) return

        const storeName = storeMap.get(p.store_id) || `GUID:${p.store_id}`
        const date = p.business_date
        const empId = p.employee_toast_guid

        if (!grouped[storeName]) grouped[storeName] = {}
        if (!grouped[storeName][date]) grouped[storeName][date] = {}
        if (!grouped[storeName][date][empId]) grouped[storeName][date][empId] = []

        grouped[storeName][date][empId].push(p)
    })

    const suspiciousDays: any[] = []

    // Analyze overlaps
    Object.entries(grouped).forEach(([storeName, dates]) => {
        Object.entries(dates).forEach(([date, employees]) => {
            let dailyOverlaps = 0
            let dailyOverlapHours = 0

            Object.entries(employees).forEach(([empId, shifts]) => {
                if (shifts.length < 2) return

                // Sort by clock in
                shifts.sort((a: any, b: any) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime())

                for (let i = 0; i < shifts.length; i++) {
                    for (let j = i + 1; j < shifts.length; j++) {
                        const s1 = shifts[i]
                        const s2 = shifts[j]
                        if (!s1.clock_in || !s1.clock_out || !s2.clock_in || !s2.clock_out) continue

                        const start1 = new Date(s1.clock_in).getTime()
                        const end1 = new Date(s1.clock_out).getTime()
                        const start2 = new Date(s2.clock_in).getTime()
                        const end2 = new Date(s2.clock_out).getTime()

                        // Check Overlap
                        // (Start1 < End2) && (Start2 < End1)
                        if (start1 < end2 && start2 < end1) {
                            // Calculate overlap duration in hours
                            const overlapStart = Math.max(start1, start2)
                            const overlapEnd = Math.min(end1, end2)
                            const hours = (overlapEnd - overlapStart) / (1000 * 3600)

                            // Ignore tiny overlaps (< 5 mins)
                            // Often quick close/open: e.g. Close 12:00, Open 12:00:01
                            if (hours > 0.08) {
                                dailyOverlaps++
                                dailyOverlapHours += hours
                            }
                        }
                    }
                }
            })

            if (dailyOverlaps > 0) {
                suspiciousDays.push({
                    store: storeName,
                    date: date,
                    overlaps: dailyOverlaps,
                    wastedHours: parseFloat(dailyOverlapHours.toFixed(2))
                })
            }
        })
    })

    // Sort by most wasted hours
    suspiciousDays.sort((a, b) => b.wastedHours - a.wastedHours)

    if (suspiciousDays.length === 0) {
        console.log("✅ No anomalies detected! Data looks clean.")
    } else {
        console.log(`⚠️  Found ${suspiciousDays.length} suspicious days with Overlapping Shifts (Ghost Shifts):`)
        console.table(suspiciousDays) // Show ALL

        console.log("\nRECOMMENDATION:")
        console.log("These days have duplicated labor costs due to Ghost Shifts.")
        console.log("Run a manual sync for these date ranges immediately.")
    }
}

analyzeLaborAnomalies()
