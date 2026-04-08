import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
    const { data } = await supabase.from('pmix_daily_cache').select('*').limit(1)
    if (data && data.length > 0) {
        console.log('Columns:', Object.keys(data[0]))
    } else {
        console.log('Table is empty')
    }
}

main().then(() => process.exit(0))
