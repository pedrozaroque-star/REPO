/**
 * @module app/api/sync/employees/route
 * @description API endpoint to sync jobs (roles) and employees from Toast POS into Supabase.
 * Supports targeting a specific single store or all active stores in Tacos Gavilan.
 * 
 * @businessRules
 * - Workday in Tacos Gavilan runs 6:00 AM to 5:59 AM next day.
 * - Jobs are enterprise-level roles shared across stores.
 * - Employees belong to specific stores identified by Toast external IDs (storeGuid).
 * - When targetStoreId is provided, ONLY that store is synced, preventing multi-store API spam.
 * 
 * @dataFlow
 * Toast POS API (/labor/v1/employees, /labor/v1/jobs) -> toast-labor.ts -> Supabase (toast_employees, toast_jobs)
 * 
 * @notes
 * - Fixed critical bug where missing Content-Type caused silent fallback to all 15 stores.
 * - Added support for target store via searchParams (?storeId=...) and body ({ storeId }).
 */

import { NextResponse } from 'next/server'
import { syncToastJobs, syncToastEmployees } from '@/lib/toast-labor'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const urlStoreId = searchParams.get('storeId')
        const urlType = searchParams.get('type')

        // Check for specific store target in body or searchParams
        let targetStoreId: string | null = urlStoreId || null
        try {
            const clone = req.clone()
            const body = await clone.json()
            if (body && typeof body.storeId === 'string' && body.storeId.trim()) {
                targetStoreId = body.storeId.trim()
            }
        } catch {
            // Non-JSON body or empty body, fall back to urlStoreId
        }

        // When a single store is targeted, default type to 'employees' unless explicitly requested otherwise
        const type = urlType || (targetStoreId ? 'employees' : 'all')

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

        // Validate targetStoreId if provided
        if (targetStoreId && !STORE_IDS.includes(targetStoreId)) {
            // Check if it exists as an active store anyway
            const { data: storeCheck } = await supabaseAdmin
                .from('stores')
                .select('external_id')
                .eq('external_id', targetStoreId)
                .single()

            if (!storeCheck) {
                return NextResponse.json({
                    success: false,
                    error: `Store ID '${targetStoreId}' is not recognized as a valid active store.`
                }, { status: 400 })
            }
        }

        let jobStats = { count: 0, errors: [] as string[] }
        let empStats = { count: 0, errors: [] as string[] }

        // 1. Sync Jobs (Roles)
        if (type === 'jobs' || type === 'all') {
            console.log('--- SYNCING JOBS ---')
            const masterStoreId = STORE_IDS[0]
            const res = await syncToastJobs(masterStoreId)
            jobStats.count = res.count
            if (res.error) jobStats.errors.push(res.error)
        }

        // 2. Sync Employees (and their wages)
        if (type === 'employees' || type === 'all') {
            const storesToSync = targetStoreId ? [targetStoreId] : STORE_IDS
            console.log(`Syncing employees for ${storesToSync.length} store(s) (Target: ${targetStoreId || 'ALL'})`)

            for (const storeId of storesToSync) {
                const res = await syncToastEmployees(storeId)
                empStats.count += res.count
                if (res.error) empStats.errors.push(`${storeId}: ${res.error}`)
            }
        }

        return NextResponse.json({
            success: true,
            targetStore: targetStoreId || 'ALL',
            jobs: jobStats,
            employees: empStats
        })

    } catch (e: any) {
        console.error('Error in /api/sync/employees:', e)
        return NextResponse.json({ success: false, error: e.message }, { status: 500 })
    }
}
