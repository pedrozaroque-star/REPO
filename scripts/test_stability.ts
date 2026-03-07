require('dotenv').config({ path: '.env.local' })
import { generateSmartForecast } from '../lib/intelligence'
import { getSupabaseClient } from '../lib/supabase'

async function testStability() {
    const supabase = await getSupabaseClient()
    const { data: storeData } = await supabase.from('stores').select('external_id').ilike('name', '%West Covina%').single()
    const storeId = storeData?.external_id

    if (!storeId) {
        console.log("No store found")
        return
    }

    const testCases = [
        '2026-03-03', // Tuesday
        '2026-03-04', // Weds
        '2026-03-05', // Thurs (Target is anchored to 2026-03-01 prior sunday)
        '2026-03-06'  // Fri
    ]

    for (const d of testCases) {
        const res = await generateSmartForecast(storeId, d)
        console.log(`Forecast for ${d}: $${res?.total_sales} | Growth Factor applied: ${res?.growth_factor_applied}`)
    }
}

testStability()
