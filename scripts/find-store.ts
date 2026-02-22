
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function debugStore() {
    const { data: store } = await supabase
        .from('stores')
        .select('external_id, name')
        .ilike('name', 'LA Central%')
        .single()

    console.log('Store:', store)
}

debugStore()
