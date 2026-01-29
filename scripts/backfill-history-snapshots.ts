
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_RATIO = 0.227 // 22.7%
const AVG_WAGE = 19.79 // $/hr

const WEEKS = [
    '2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29',
    '2026-01-05', '2026-01-12',
    // Skip 19 (Manual)
    '2026-01-26', '2026-02-02'
]

async function run() {
    console.log("🚀 Backfilling Estimated Hours & Labor for History...")

    for (const weekStart of WEEKS) {
        // 1. Get Budget (for Sales)
        const { data: budget } = await supabase.from('weekly_budgets')
            .select('*').eq('store_id', LYNWOOD_GUID).eq('week_start', weekStart).single()

        if (!budget || !budget.sales_projections) {
            console.log(`Skipping ${weekStart}: No sales data.`)
            continue
        }

        const projections = budget.sales_projections
        // If snapshot already exists (and isn't our manual 19th week), we overwrite to ensure hours are present?
        // User asked for hours. Best to overwrite calculated snapshots.

        const totalSales = Object.values(projections).reduce((a: any, b: any) => a + Number(b), 0)

        // Calculate Targets
        const targetLaborCost = totalSales * TARGET_RATIO
        const targetTotalHours = targetLaborCost / AVG_WAGE

        // Daily Breakdown
        const breakdown: Record<string, any> = {}
        const days = Object.keys(projections).filter(k => !k.startsWith('_')).sort()

        days.forEach(date => {
            const dailySales = Number(projections[date])
            const weight = totalSales > 0 ? dailySales / totalSales : 0

            const dailyCost = targetLaborCost * weight
            const dailyHours = targetTotalHours * weight
            const dObj = new Date(date + 'T12:00:00')
            const dayName = dObj.toLocaleDateString('en-US', { weekday: 'long' })

            breakdown[date] = {
                day: dayName,
                Sales: `$${dailySales.toLocaleString()}`,
                Labor_Plan: `$${Math.round(dailyCost).toLocaleString()}`,
                Hours: dailyHours.toFixed(1),
                Pct: `${(TARGET_RATIO * 100).toFixed(1)}%`
            }
        })

        // Construct Snapshot
        const snapshot = {
            total_sales: totalSales,
            total_labor_cost: Math.round(targetLaborCost),
            total_hours: Number(targetTotalHours.toFixed(1)),
            labor_pct: Number((TARGET_RATIO * 100).toFixed(1)),
            breakdown: breakdown
        }

        // Save
        const newProjections = { ...projections, _snapshot: snapshot }

        const { error } = await supabase.from('weekly_budgets')
            .update({ sales_projections: newProjections })
            .eq('id', budget.id)

        if (error) console.error(`❌ Error ${weekStart}:`, error.message)
        else console.log(`✅ ${weekStart}: Backfilled ${targetTotalHours.toFixed(1)}h (Simulated from Sales)`)
    }
}

run()
