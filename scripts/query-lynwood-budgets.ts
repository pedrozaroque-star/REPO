
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-19'

async function run() {
    console.log(`🔍 Consulting BUDGET for Lynwood (Week of ${TARGET_WEEK})...`)

    // 1. Fetch Budget Only (We rely on Snapshot first)
    const { data: budget } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .eq('week_start', TARGET_WEEK)
        .single()

    if (!budget) { console.log("No Budget Found"); return }

    const projections = budget.sales_projections || {}
    const snapshot = projections._snapshot

    if (snapshot) {
        console.log("✅ FOUND OFFICIAL SNAPSHOT (Simulating User View):")
        const rows = []
        const bd = snapshot.breakdown
        // Order by date
        const dates = Object.keys(bd).sort()
        for (const d of dates) {
            const row = bd[d]
            rows.push({
                Day: row.day,
                Date: d,
                Sales: row.Sales,
                Labor_Plan: row.Labor_Plan,
                Hours: row.Hours,
                Pct: row.Pct
            })
        }
        console.table(rows)
        console.log(`TOTALS: Sales $${snapshot.total_sales.toLocaleString()} | Labor $${snapshot.total_labor_cost.toLocaleString()} | Hours ${snapshot.total_hours} | Pct ${snapshot.labor_pct}%`)
        return
    }

    // Fallback to calculation if no snapshot (legacy code removed for clarity as requested "match view")
    console.log("⚠️ No Snapshot found in DB. Please run simulate-frontend-data.ts first.")
}

run()
