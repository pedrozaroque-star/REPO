import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function clear() {
    console.log('Clearing...')
    await supabase.from('meat_consumption_history').delete().in('business_date', ['2026-04-06', '2026-04-07'])
    console.log('Done.')
}
clear().then(() => process.exit(0))
