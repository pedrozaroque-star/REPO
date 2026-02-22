
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function listStoreIds() {
    const { data: stores } = await supabase
        .from('punches')
        .select('store_id')
        .gte('business_date', '2026-02-09')
        .lte('business_date', '2026-02-15')

    const uniqueIds = [...new Set(stores?.map(s => s.store_id))]

    const { data: storeNames } = await supabase
        .from('stores')
        .select('name, external_id')
        .in('external_id', uniqueIds)

    console.log('Stores with punches in that range:', storeNames)
}

listStoreIds()
