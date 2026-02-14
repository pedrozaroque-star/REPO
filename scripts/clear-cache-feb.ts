
import { getSupabaseClient } from '../lib/supabase'

async function clearCache() {
    const supabase = await getSupabaseClient()

    console.log("🧹 Clearing Sales Cache for Feb 10 - Feb 15 to force refresh...")

    const { error } = await supabase
        .from('sales_daily_cache')
        .delete()
        .gte('business_date', '2026-02-10')
        .lte('business_date', '2026-02-15')

    if (error) console.error("Error:", error)
    else console.log("✅ Cache cleared. Dashboard will fetch fresh data with new logic.")
}

clearCache()
