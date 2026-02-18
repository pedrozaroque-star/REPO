
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

    // Get Store
    const { data: stores } = await supabase.from('stores').select('*').ilike('name', `%${storeName}%`)
    const store = stores?.[0]
    const storeGuid = store.external_id
    console.log(`Store GUID: ${storeGuid}`)

    // Get 1 Employee
    const { data: emps } = await supabase.from('toast_employees').select('*').limit(1)
    console.log('Employee Sample:', { id: emps?.[0].id, toast_guid: emps?.[0].toast_guid })

    // Get 1 Shift
    const { data: shifts } = await supabase.from('shifts').select('*').eq('store_id', storeGuid).limit(1)
    console.log('Shift Sample:', {
        id: shifts?.[0]?.id,
        employee_id: shifts?.[0]?.employee_id,
        guid_col: shifts?.[0]?.employee_toast_guid // Check if this exists
    })

    // Get 1 Punch
    const { data: punches } = await supabase.from('punches').select('*').eq('store_id', storeGuid).limit(1)
    console.log('Punch Sample:', {
        id: punches?.[0]?.id,
        employee_toast_guid: punches?.[0]?.employee_toast_guid
    })
}

run()
