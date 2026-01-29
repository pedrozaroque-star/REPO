
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-26'

// DATA FROM USER IMAGE (Week of Jan 26)
const SNAPSHOT_DATA = {
    total_sales: 103606,
    total_labor_cost: 23902,
    total_hours: 1207.8,
    labor_pct: 23.1,
    breakdown: {
        '2026-01-26': { day: 'Monday', Sales: '$11,636', Labor_Plan: '$2,504', Hours: '132.0', Pct: '21.5%' },
        '2026-01-27': { day: 'Tuesday', Sales: '$11,414', Labor_Plan: '$2,665', Hours: '145.5', Pct: '23.4%' },
        '2026-01-28': { day: 'Wednesday', Sales: '$13,212', Labor_Plan: '$2,564', Hours: '138.5', Pct: '19.4%' },
        '2026-01-29': { day: 'Thursday', Sales: '$13,165', Labor_Plan: '$3,213', Hours: '168.0', Pct: '24.4%' },
        '2026-01-30': { day: 'Friday', Sales: '$17,749', Labor_Plan: '$4,150', Hours: '215.8', Pct: '23.4%' },
        '2026-01-31': { day: 'Saturday', Sales: '$19,073', Labor_Plan: '$4,191', Hours: '217.5', Pct: '22.0%' },
        '2026-02-01': { day: 'Sunday', Sales: '$17,357', Labor_Plan: '$4,615', Hours: '190.5', Pct: '26.6%' }
    }
}

async function simulate() {
    console.log(`💾 SAVING SNAPSHOT DATA for Week ${TARGET_WEEK} (Matching User Image)...`)

    // 1. Fetch current
    const { data: budget, error: fetchErr } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .eq('week_start', TARGET_WEEK)
        .single()

    if (fetchErr) {
        // If not exists, create it
        console.log("Budget not found, creating new one...")
        const { error: insertErr } = await supabase.from('weekly_budgets').insert({
            store_id: LYNWOOD_GUID,
            week_start: TARGET_WEEK,
            sales_projections: { _snapshot: SNAPSHOT_DATA, ...getSalesMap(SNAPSHOT_DATA) },
            updated_at: new Date().toISOString()
        })
        if (insertErr) console.error("Insert Err:", insertErr.message)
        else console.log("✅ Created and Saved.")
        return
    }

    // 2. Prepare new projections object
    const currentProjections = budget.sales_projections || {}
    const newProjections = {
        ...currentProjections,
        ...getSalesMap(SNAPSHOT_DATA),
        _snapshot: SNAPSHOT_DATA
    }

    // 3. Update
    const { error: upsertErr } = await supabase
        .from('weekly_budgets')
        .update({ sales_projections: newProjections })
        .eq('id', budget.id)

    if (upsertErr) console.error("Update Err:", upsertErr.message)
    else console.log("✅ SNAPSHOT SAVED.")
}

function getSalesMap(snap: any) {
    const map: any = {}
    Object.keys(snap.breakdown).forEach(k => {
        map[k] = snap.breakdown[k].Sales.replace('$', '').replace(',', '')
    })
    return map
}

simulate()
