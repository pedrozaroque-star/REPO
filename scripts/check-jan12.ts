
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const WEEK_START = '2026-01-12'

async function check() {
    console.log(`🔎 Checking shifts for Jan 12 week...`)
    const { count } = await supabase.from('shifts')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', LYNWOOD_GUID)
        .gte('shift_date', WEEK_START)
        .lt('shift_date', '2026-01-19')

    console.log(`Found ${count} shifts.`)
}

check()
