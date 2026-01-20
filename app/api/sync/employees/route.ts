import { NextResponse } from 'next/server'
import { syncToastJobs, syncToastEmployees } from '@/lib/toast-labor'

// List of Active Stores to Sync
// Ideally this comes from DB or Config. For now hardcode the main ones or fetch dynamic.
// Using the same overrides logic from toast-api if needed, but for now we need just IDs.
const STORE_IDS = [
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

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const type = searchParams.get('type') || 'all' // 'jobs' or 'employees' or 'all'

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
            // Employees definitely need to be fetched per store if they are siloed, 
            // BUT often in Toast they are enterprise level.
            // Documentation says: /labor/v1/employees returns "employees of a restaurant".
            // So we loop.

            for (const storeId of STORE_IDS) {
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
