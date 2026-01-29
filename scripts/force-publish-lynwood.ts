
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-19'

async function forcePublish() {
    console.log(`🚀 FORCE PUBLISHING (Silent Mode) for Lynwood Week ${TARGET_WEEK}...`)

    const endDate = new Date(TARGET_WEEK); endDate.setDate(endDate.getDate() + 6)
    const endStr = endDate.toISOString().split('T')[0]

    // 1. Update ALL shifts to 'published' (ignoring emails)
    // Note: The DB triggers might send emails if not careful, but Supabase triggers usually require edge functions.
    // We are just updating the 'status' column.

    const { data, error, count } = await supabase
        .from('shifts')
        .update({ status: 'published' }) // FORCE PUBLISHED
        .eq('store_id', LYNWOOD_GUID)
        .gte('shift_date', TARGET_WEEK)
        .lte('shift_date', endStr)
        .select('*', { count: 'exact' })

    if (error) {
        console.error("❌ Error publishing:", error.message)
    } else {
        console.log(`✅ Successfully updated ${count} shifts to 'published'.`)
    }

    // 2. Also patch the Budget Projections to match the Image (Blue numbers)
    // Values derived from user image
    const projections = {
        '2026-01-19': '11778',
        '2026-01-20': '12029',
        '2026-01-21': '13136',
        '2026-01-22': '13832', // Corrected from 14677 to match image
        '2026-01-23': '17924',
        '2026-01-24': '19561',
        '2026-01-25': '17694'
    }

    const { error: budgetErr } = await supabase
        .from('weekly_budgets')
        .upsert({
            store_id: LYNWOOD_GUID,
            week_start: TARGET_WEEK,
            sales_projections: projections,
            updated_at: new Date().toISOString()
        }, { onConflict: 'store_id,week_start' })

    if (budgetErr) console.error("❌ Budget Patch Error:", budgetErr.message)
    else console.log("✅ Budget Projections Patched to match Planificador.")
}

forcePublish()
