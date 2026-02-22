
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkPunches() {
    const { data: punches } = await supabase
        .from('punches')
        .select('store_id, business_date')
        .limit(5)

    console.log('Sample Store IDs in punches:', punches)
}

checkPunches()
