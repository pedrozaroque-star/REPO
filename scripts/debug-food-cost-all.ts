
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getProductMix } from '@/lib/toast-pmix'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function debugAllStores() {
    console.log("Starting Debug Script for All Stores...")

    try {
        const supabase = await getSupabaseAdminClient()
        const { data: stores, error } = await supabase
            .from('stores')
            .select('*')
            .eq('is_active', true)

        if (error) {
            console.error("Supabase Error:", error)
            return
        }

        console.log(`Found ${stores?.length} active stores.`)

        const validStores = stores?.filter(s => s.external_id) || []
        console.log(`Found ${validStores.length} stores with external_id.`)

        if (validStores.length === 0) return

        // Pick the first 3 stores to test (to save time)
        const sampleStores = validStores.slice(0, 3)
        console.log(`Testing with first 3 stores: ${sampleStores.map(s => s.name).join(', ')}`)

        // Use dates from screenshot: Feb 18 2026
        // Wait, current date is Feb 19 2026. Yesterday was Feb 18.
        const startDate = '2026-02-18'
        const endDate = '2026-02-18'

        for (const store of sampleStores) {
            console.log(`\nFetching PMIX for ${store.name} (${store.external_id})...`)
            try {
                const items = await getProductMix({
                    storeId: store.external_id,
                    startDate,
                    endDate,
                    bundleModifiers: true
                })
                console.log(`Success! Retrieved ${items.length} items.`)
                if (items.length > 0) {
                    console.log(`Sample Item: ${items[0].name} - Qty: ${items[0].quantity} - Sales: ${items[0].net_sales}`)
                }
            } catch (e: any) {
                console.error(`Failed for ${store.name}: ${e.message}`)
            }
        }

    } catch (err) {
        console.error("Script Error:", err)
    }
}

debugAllStores()
