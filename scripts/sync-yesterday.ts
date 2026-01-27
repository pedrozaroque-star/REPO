
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const KNOWN_STORES = [
    'acf15327-54c8-4da4-8d0d-3ac0544dc422', // Rialto
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8', // Azusa
    '42ed15a6-106b-466a-9076-1e8f72451f6b', // Norwalk
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a', // Downey
    '475bc112-187d-4b9c-884d-1f6a041698ce', // LA Broadway
    'a83901db-2431-4283-834e-9502a2ba4b3b', // Bell
    '5fbb58f5-283c-4ea4-9415-04100ee6978b', // Hollywood
    '47256ade-2cd4-4073-9632-84567ad9e2c8', // Huntington Park
    '8685e942-3f07-403a-afb6-faec697cd2cb', // LA Central
    '3a803939-eb13-4def-a1a4-462df8e90623', // La Puente
    '80a1ec95-bc73-402e-8884-e5abbe9343e6', // Lynwood
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2', // Santa Ana
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd', // Slauson
    '95866cfc-eeb8-4af9-9586-f78931e1ea04', // South Gate
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'  // West Covina
]

async function syncYesterday() {
    // 1. Calculate Yesterday (local logic, assuming script runs in user's timezone context or we force PST if needed)
    // Using simple logic: Now - 1 day
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)

    // Format YYYY-MM-DD
    const dateStr = yesterday.toISOString().split('T')[0]

    console.log(`🚀 Forcing Sync for YESTERDAY: ${dateStr}`)

    // 2. Process all stores
    for (const storeId of KNOWN_STORES) {
        const prefix = `[${storeId.slice(0, 6)}...]`
        process.stdout.write(`${prefix} Syncing... `)

        try {
            // A. Sales (Skip Cache = TRUE)
            await fetchToastData({
                storeIds: storeId,
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day',
                skipCache: true // <--- THE KEY FIX
            })
            process.stdout.write(`✅ Sales `)

            // B. Labor
            // Labor usually needs a full day ISO range
            const startIso = `${dateStr}T00:00:00.000+0000` // approximate UTC window, toast-labor handles it
            const endIso = `${dateStr}T23:59:59.999+0000`

            await syncToastPunches(storeId, startIso, endIso)
            process.stdout.write(`✅ Labor\n`)

        } catch (error: any) {
            console.error(`\n❌ Error syncing ${storeId}:`, error.message)
        }
    }

    console.log(`\n✨ Sync for ${dateStr} Complete!`)
}

syncYesterday()
