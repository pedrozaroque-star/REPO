
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function checkJobGuids() {
    console.log('🕵️‍♂️ Checking Job GUIDs in Punches for 2025...')

    // Fetch distinct samples from different stores to see if GUIDs are universal
    const { data: punches, error } = await supabase
        .from('punches')
        .select('store_id, job_toast_guid')
        .gte('business_date', '2025-06-01')
        .limit(100)

    if (error) { console.error(error); return }

    const map: Record<string, Set<string>> = {}

    punches?.forEach((p: any) => {
        const id = p.store_id
        if (!map[id]) map[id] = new Set()
        if (p.job_toast_guid) map[id].add(p.job_toast_guid)
    })

    console.log('\nSample GUIDs found per Store:')
    Object.keys(map).forEach(storeId => {
        console.log(`Store [${storeId.slice(0, 8)}]:`, Array.from(map[storeId]))
    })
}

checkJobGuids()
