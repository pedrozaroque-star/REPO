
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    const storeName = 'Huntington Park'
    const dateStr = '2026-02-16'

    console.log(`🔍 DEBUG IDs (Deep Dive): ${storeName} on ${dateStr}\n`)

    // 1. Get Store
    const { data: stores } = await supabase.from('stores').select('*').ilike('name', `%${storeName}%`)
    const store = stores?.[0]
    const storeGuid = store.external_id

    // 2. Get Shifts
    const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', storeGuid)
        .eq('shift_date', dateStr)

    if (!shifts || shifts.length === 0) {
        console.log('No shifts found.')
        return
    }

    console.log(`Found ${shifts.length} shifts. IDs:`)
    const empIds = shifts.map(s => s.employee_id)
    empIds.forEach(id => console.log(`- Shift Emp ID: ${id}`))

    // 3. Get Employees
    // Fetch ALL toast_employees (limit 2000)
    const { data: emps, error } = await supabase
        .from('toast_employees')
        .select('id, toast_guid, name')
        .limit(2000)

    if (error) console.error("DB Error:", error)

    const empMapId = new Map(emps?.map(e => [e.id, e.name]))
    const empMapGuid = new Map(emps?.map(e => [e.toast_guid, e.name]))

    console.log(`Fetched ${emps?.length} employees. Checking matches...`)

    let matches = 0
    empIds.forEach(id => {
        const byId = empMapId.get(id)
        const byGuid = empMapGuid.get(id)

        if (byId) {
            console.log(`✅ MATCH by ID: ${id} -> ${byId}`)
            matches++
        } else if (byGuid) {
            console.log(`✅ MATCH by GUID: ${id} -> ${byGuid}`)
            matches++
        } else {
            console.log(`❌ NO MATCH: ${id}`)
        }
    })

    console.log(`\nMatch Rate: ${matches}/${empIds.length}`)
}

run()
