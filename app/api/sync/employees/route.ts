import { NextResponse } from 'next/server'
import { syncToastJobs, syncToastEmployees } from '@/lib/toast-labor'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const type = searchParams.get('type') || 'all' // 'jobs' or 'employees' or 'all'

        // Fetch active stores from database dynamically
        const { data: dbStores, error: dbError } = await supabaseAdmin
            .from('stores')
            .select('external_id')
            .eq('is_active', true)

        if (dbError) throw dbError

        const STORE_IDS = (dbStores || [])
            .map(s => s.external_id)
            .filter(Boolean) as string[]

        if (STORE_IDS.length === 0) {
            return NextResponse.json({ success: true, message: 'No active stores found to sync.' })
        }

        // Check for specific store target in body
        let targetStoreId: string | null = null
        try {
            // Clone req because reading body consumes it
            const clone = req.clone()
            const body = await clone.json()
            if (body.storeId) targetStoreId = body.storeId
        } catch {
            // Ignore non-JSON body
        }

        let jobStats = { count: 0, errors: [] as string[] }
        let empStats = { count: 0, errors: [] as string[] }

        // 1. Sync Jobs (Roles)
        if (type === 'jobs' || type === 'all') {
            console.log('--- SYNCING JOBS ---')
            // Jobs are usually shared across enterprise group, but we fetch per store to be safe
            // Optimization: Fetch just from one master store (e.g., Rialto) if definitions are global?
            // Let's fetch from the first one for definition.
            const masterStoreId = STORE_IDS[0]
            const res = await syncToastJobs(masterStoreId)
            jobStats.count = res.count
            if (res.error) jobStats.errors.push(res.error)
        }

        // 2. Sync Employees (and their wages)
        if (type === 'employees' || type === 'all') {
            console.log('--- SYNCING EMPLOYEES ---')

            const storesToSync = targetStoreId ? [targetStoreId] : STORE_IDS
            console.log(`Syncing employees for ${storesToSync.length} stores (Target: ${targetStoreId || 'ALL'})`)

            for (const storeId of storesToSync) {
                const res = await syncToastEmployees(storeId)
                empStats.count += res.count
                if (res.error) empStats.errors.push(`${storeId}: ${res.error}`)
            }
        }

        return NextResponse.json({
            success: true,
            jobs: jobStats,
            employees: empStats
        })

    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 })
    }
}
