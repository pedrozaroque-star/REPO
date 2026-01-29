
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-19'

// DATA FROM USER IMAGE
const SNAPSHOT_DATA = {
    total_sales: 105954,
    total_labor_cost: 24054,
    total_hours: 1215.5,
    labor_pct: 22.7,
    breakdown: {
        '2026-01-19': { day: 'Monday', Sales: '$11,778', Labor_Plan: '$2,501', Hours: '132.3', Pct: '21.2%' },
        '2026-01-20': { day: 'Tuesday', Sales: '$12,029', Labor_Plan: '$2,670', Hours: '145.8', Pct: '22.2%' },
        '2026-01-21': { day: 'Wednesday', Sales: '$13,136', Labor_Plan: '$2,569', Hours: '138.8', Pct: '19.6%' },
        '2026-01-22': { day: 'Thursday', Sales: '$13,832', Labor_Plan: '$3,218', Hours: '168.3', Pct: '23.3%' },
        '2026-01-23': { day: 'Friday', Sales: '$17,924', Labor_Plan: '$4,271', Hours: '222.5', Pct: '23.8%' },
        '2026-01-24': { day: 'Saturday', Sales: '$19,561', Labor_Plan: '$4,191', Hours: '217.5', Pct: '21.4%' },
        '2026-01-25': { day: 'Sunday', Sales: '$17,694', Labor_Plan: '$4,634', Hours: '190.5', Pct: '26.2%' }
    }
}

async function simulate() {
    console.log(`💾 SAVING SNAPSHOT DATA into sales_projections._snapshot ...`)

    // 1. Fetch current
    const { data: budget, error: fetchErr } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .eq('week_start', TARGET_WEEK)
        .single()

    if (fetchErr) return console.error("Fetch Err:", fetchErr.message)

    // 2. Prepare new projections object
    // Keep existing daily keys, add _snapshot key
    const currentProjections = budget.sales_projections || {}
    const newProjections = {
        ...currentProjections,
        _snapshot: SNAPSHOT_DATA
    }

    // 3. Update
    const { error: upsertErr } = await supabase
        .from('weekly_budgets')
        .update({ sales_projections: newProjections })
        .eq('id', budget.id)

    if (upsertErr) console.error("Update Err:", upsertErr.message)
    else console.log("✅ SNAPSHOT SAVED in '_snapshot' key.")
}

simulate()
