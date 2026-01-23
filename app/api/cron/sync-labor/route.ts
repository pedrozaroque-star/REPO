
import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { syncToastPunches, syncToastEmployees, syncToastJobs } from '@/lib/toast-labor'

export const dynamic = 'force-dynamic' // No caching
export const maxDuration = 300 // 5 minutes max (Vercel Pro)

export async function GET(request: Request) {
    console.log('[CRON] Starting Labor Sync...')
    const supabase = await getSupabaseClient()

    // 1. Get Active Stores
    const { data: stores, error } = await supabase
        .from('stores')
        .select('*')
        .not('external_id', 'is', null) // Only stores with Toast GUID

    if (error || !stores) {
        return NextResponse.json({ error: 'Failed to fetch stores' }, { status: 500 })
    }

    console.log(`[CRON] Found ${stores.length} stores to sync.`)

    // 2. Determine Date Range (Last 3 days to cover edits/delays) - UTC Optimized
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 3)

    // Format ISO for Toast (YYYY-MM-DDThh:mm:ss.000+0000)
    const startIso = start.toISOString().split('T')[0] + 'T00:00:00.000+0000'
    const endIso = end.toISOString().split('T')[0] + 'T23:59:59.999+0000'

    const results = []

    interface Store {
        name: string
        external_id: string
    }

    // 3. Sync Each Store
    // Explicit cast to avoid implicit any errors
    const storesList = (stores || []) as Store[]

    for (const store of storesList) {
        if (!store.external_id) continue
        console.log(`[CRON] Syncing Labor for ${store.name}...`)

        try {
            // A. Sync Employees & Jobs (Metadata)
            const empRes = await syncToastEmployees(store.external_id)
            const jobRes = await syncToastJobs(store.external_id)

            // B. Sync Punches (Time Entries)
            const punchRes = await syncToastPunches(store.external_id, startIso, endIso)

            results.push({
                store: store.name,
                employees: empRes.count,
                jobs: jobRes.count,
                punches: punchRes.count,
                success: true
            })
        } catch (e: any) {
            console.error(`[CRON] Error syncing ${store.name}:`, e)
            results.push({
                store: store.name,
                error: e.message,
                success: false
            })
        }
    }

    console.log('[CRON] Labor Sync Complete.')
    return NextResponse.json({
        message: 'Labor Sync Executed',
        range: { start: startIso, end: endIso },
        results
    })
}
