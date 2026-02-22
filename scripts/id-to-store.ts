
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkStore() {
    const { data: store } = await supabase
        .from('stores')
        .select('name, external_id')
        .eq('external_id', '475bc112-187d-4b9c-884d-1f6a041698ce')
        .single()

    console.log('Store for 475bc...:', store)
}

checkStore()
