
import { generateSmartForecast } from '../lib/intelligence'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function debugLateNight() {
    // Store: Lynwood (matches debug-store-hours output)
    // We need to find Lynwood's ID. 
    // From previous logs, Lynwood might be hard to guess id, but "acf15327..." was used before (Rialto?).
    // Let's use getSupabase to find Lynwood ID first.

    // Using the ID from toast-api mock if possible, or fetch from DB.
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

    const { data: store } = await supabase.from('stores').select('id, external_id, name').ilike('name', '%Lynwood%').single()

    if (!store) {
        console.error('Could not find Lynwood store')
        return
    }

    console.log(`Debugging Store: ${store.name} (${store.external_id})`)
    const date = "2026-02-19" // Today

    try {
        const result = await generateSmartForecast(store.external_id, date)

        console.log('--- Hourly Projection (22:00 onwards) ---')
        result.hours.forEach(h => {
            if (h.hour >= 22) {
                console.log(`Hour ${h.hour}: Sales $${h.projected_sales.toFixed(2)} | Tickets ${h.projected_tickets.toFixed(2)} | Reasoning: ${h.reasoning}`)
            }
        })

    } catch (e: any) {
        console.error('FAILED:', e)
    }
}

debugLateNight()
