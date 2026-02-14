
import { syncToastPunches } from '../lib/toast-labor'
import { getSupabaseClient } from '../lib/supabase'

async function main() {
    const supabase = await getSupabaseClient()

    // Period: Jan 1 2026 to Today
    const start = '2026-01-01T00:00:00.000+0000'
    const today = new Date().toISOString().replace('Z', '+0000') // Rough ISO
    const end = '2026-02-14T23:59:59.999+0000'

    console.log(`Starting MASSIVE CLEANUP for all stores (Jan 1 - Feb 14)...`)

    // 1. Get All Stores
    const { data: stores } = await supabase.from('stores').select('id, name, external_id')
    const activeStores = stores?.filter(s => s.external_id) || []

    console.log(`Found ${activeStores.length} stores to sync.`)

    for (const store of activeStores) {
        console.log(`\n---------------------------------`)
        console.log(`🔄 Syncing: ${store.name}`)
        try {
            // Using the NEW logic which deletes old data first
            const res = await syncToastPunches(store.external_id!, start, end)
            if (res.success) {
                console.log(`✅ Success! Synced ${res.count} shifts.`)
            } else {
                console.error(`❌ Failed: ${res.error}`)
            }
        } catch (e: any) {
            console.error(`❌ CRITICAL ERROR for ${store.name}: ${e.message}`)
        }
    }

    console.log("\n✨ MASSIVE CLEANUP COMPLETE.")
    console.log("All ghost shifts and 4AM-misalignments should be gone.")
}

main()
