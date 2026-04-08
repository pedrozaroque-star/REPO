import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkRange() {
    const { count } = await supabase.from('pmix_daily_cache').select('*', { count: 'exact', head: true })
    console.log(`Filas totales en pmix_daily_cache: ${count}`)
    
    if (count && count > 0) {
        const { data: first } = await supabase.from('pmix_daily_cache').select('business_date').order('business_date', { ascending: true }).limit(1)
        const { data: last } = await supabase.from('pmix_daily_cache').select('business_date').order('business_date', { ascending: false }).limit(1)
        console.log(`Desde: ${first?.[0]?.business_date} hasta: ${last?.[0]?.business_date}`)
    }
}

checkRange().catch(console.error).finally(() => process.exit(0))
