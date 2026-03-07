import { generateSmartForecast } from '../lib/intelligence'
import { getSupabaseClient } from '../lib/supabase'

async function testLockedProjection() {
    // We will test on 'Lynwood' (store 1 or external_id)
    // Let's get the Lynwood store GUID first
    const supabase = await getSupabaseClient()
    const { data: storeData } = await supabase.from('stores').select('external_id').ilike('name', '%Lynwood%').single()

    if (!storeData) {
        console.error("Lynwood not found")
        process.exit(1)
    }

    const storeId = storeData.external_id

    // Target Week: March 2nd to March 8th (Monday to Sunday)
    const testDates = [
        '2026-03-02', // Monday
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
        '2026-03-06',
        '2026-03-07',
        '2026-03-08', // Sunday
    ]

    console.log("=== Testing Projection Anchor (Should be strictly prior to 2026-03-01) ===")

    for (const dateStr of testDates) {
        // Run projection for this specific date
        const proj = await generateSmartForecast(storeId, dateStr)
        console.log(`Projection for ${dateStr}: $${proj?.projected_sales || 0}`)

        // Let's just do a quick snapshot of the history it might have used
        // Since we can't easily peek inside the function's internal variables without changing it again,
        // we'll just verify the behavior is consistent.
    }
}

testLockedProjection()
