
import { getSupabaseClient } from '@/lib/supabase'

async function checkEarlyMorningShifts() {
    const supabase = await getSupabaseClient()

    console.log("Fetching 2026 shifts to check for 4AM-6AM vulnerability...")

    // 1. Fetch Stores just for map
    const { data: stores } = await supabase.from('stores').select('id, name, external_id')
    const storeMap = new Map<string, string>()
    if (stores) {
        stores.forEach(s => {
            if (s.external_id) storeMap.set(s.external_id, s.name)
        })
    }

    // 2. Fetch Punches with Pagination
    let allPunches: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
        const { data: chunk, error } = await supabase
            .from('punches')
            .select('*')
            .gte('business_date', '2026-02-01')
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error(error)
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

    let count = 0
    let affectedStores = new Set<string>()

    console.log(`\nScanning local time logic for ${allPunches.length} records...`)

    if (allPunches) {
        allPunches.forEach(p => {
            if (!p.clock_in) return

            const clockIn = new Date(p.clock_in)
            // Convert to LA
            const timeString = clockIn.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const laTime = new Date(timeString)
            const hour = laTime.getHours()

            // If shift starts between 4 AM and 5:59 AM
            if (hour >= 4 && hour < 6) {
                count++
                // Using store guid as key if name not found
                const storeName = storeMap.get(p.store_id) || `GUID:${p.store_id}`
                affectedStores.add(storeName)
            }
        })
    }

    console.log(`\n🔍 Found ${count} shifts starting between 4:00 AM - 6:00 AM since Feb 1st.`)
    console.log("These shifts were potentially assigned to the WRONG Business Day under the old 4AM rule.")

    if (affectedStores.size > 0) {
        console.log("\nAFFECTED STORES (NEED RE-SYNC):")
        const sortedStores = Array.from(affectedStores).sort()
        sortedStores.forEach(s => console.log(`- ${s}`))

        console.log("\nRECOMMENDATION: Force re-sync ALL affected stores for Feb 1 - Feb today to correct daily totals.")
    } else {
        console.log("No 4AM-6AM shifts found. Seems okay.")
    }
}

checkEarlyMorningShifts()
