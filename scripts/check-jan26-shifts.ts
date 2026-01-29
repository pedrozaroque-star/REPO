
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const START_DATE = '2026-01-26'
const END_DATE = '2026-02-01'

async function check() {
    console.log(`🔎 Checking shifts for Lynwood (${START_DATE} to ${END_DATE})...`)

    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .gte('shift_date', START_DATE)
        .lte('shift_date', END_DATE)

    if (error) {
        console.error("Error:", error.message)
        return
    }

    console.log(`\n📋 Found ${shifts.length} shifts in 'shifts' table.`)

    if (shifts.length > 0) {
        console.log("Sample Shift:")
        console.log(shifts[0])
    } else {
        console.log("⚠️ No shifts found match these criteria in the backend.")
    }
}

check()
