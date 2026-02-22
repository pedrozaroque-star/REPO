
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function debugPunches() {
    const { data: punches } = await supabase
        .from('punches')
        .select('store_id, business_date')
        .gte('business_date', '2026-02-09')
        .lte('business_date', '2026-02-15')
        .limit(10)

    console.log('Punches from 2026-02-09 to 2026-02-15:', punches)
}

debugPunches()
