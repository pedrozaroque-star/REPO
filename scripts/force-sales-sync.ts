
import { fetchToastData } from '../lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const STORE_GUID = '95866cfc-eeb8-4af9-9586-f78931e1ea04' // South Gate
const DATE_TARGET = '2026-02-06'

async function main() {
    console.log(`🔄 Force Syncing Sales for ${DATE_TARGET}...`)

    try {
        // 1. Fetch from Toast (This function internally caches to Supabase for past dates!)
        const result = await fetchToastData({
            storeIds: STORE_GUID,
            startDate: DATE_TARGET,
            endDate: DATE_TARGET,
            groupBy: 'day',
            skipCache: true // FORCE API FETCH
        })

        if (result.rows.length > 0) {
            console.log('✅ Sales Fetched & Cached:', result.rows[0])
        } else {
            console.error('❌ No rows returned from Toast API.')
        }

    } catch (e: any) {
        console.error('CRASH:', e.message)
    }
}

main()
