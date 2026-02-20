
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getProductMix } from '@/lib/toast-pmix'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function debugKioskPrices() {
    console.log("Starting Debug Script for Kiosk Prices (All Stores)...")

    // We want to fetch all Active Stores
    const supabase = await getSupabaseAdminClient()
    const { data: stores } = await supabase.from('stores').select('*').eq('is_active', true)

    if (!stores) return

    const startDate = '2026-02-18'
    const endDate = '2026-02-18'

    for (const store of stores) {
        if (!store.external_id) continue

        // console.log(`Checking ${store.name}...`)

        try {
            const items = await getProductMix({
                storeId: store.external_id,
                startDate,
                endDate,
                bundleModifiers: true,
                mergeDiningOptions: false // IMPORTANT: False to see groups
            })

            // Look for group names containing 'kiosk'
            const kioskItems = items.filter(i =>
                (i.group_name && i.group_name.toLowerCase().includes('kiosk')) ||
                (i.group_name && i.group_name.toLowerCase().includes('kiosco'))
            )

            if (kioskItems.length > 0) {
                console.log(`\n!!! FOUND KIOSK ITEMS IN: ${store.name} !!!`)

                // Show Tacos specifically
                const tacos = kioskItems.filter(i => i.name.toLowerCase().includes('taco'))

                if (tacos.length === 0) {
                    console.log("   (No tacos found in Kiosk group)")
                } else {
                    tacos.forEach(item => {
                        const unitP = item.quantity > 0 ? item.net_sales / item.quantity : 0
                        console.log(`[${item.group_name}] ${item.name}`)
                        console.log(`   Qty: ${item.quantity}`)
                        console.log(`   Net Sales: $${item.net_sales.toFixed(2)}`)
                        console.log(`   Unit Price: $${unitP.toFixed(2)}`)
                        console.log('---')
                    })
                }
            } else {
                // console.log(`   No Kiosk group found in ${store.name}`)
            }

        } catch (err) {
            console.error(`Error checking ${store.name}: ${err}`)
        }
    }
}

debugKioskPrices()
