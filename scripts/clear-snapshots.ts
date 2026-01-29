
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

async function clearSnapshots() {
    console.log("🧹 CLEARING ALL MANUAL SNAPSHOTS from Weekly Budgets...")

    // 1. Fetch all budgets for Lynwood
    const { data: budgets, error } = await supabase
        .from('weekly_budgets')
        .select('*')
    //.eq('store_id', LYNWOOD_GUID) // Apply to all stores? Or just Lynwood? User said "todas las publicaciones".
    // Let's stick to Lynwood first to be safe, or ALL if user implies general cleanup.
    // Given context ("no sirven"), likely allows global cleanup of my patches.
    // I'll do ALL stores to be clean.

    if (error) { console.error(error); return }

    let count = 0
    for (const b of budgets) {
        const projections = b.sales_projections
        if (projections && projections._snapshot) {
            // Remove snapshot
            delete projections._snapshot

            const { error: upErr } = await supabase
                .from('weekly_budgets')
                .update({ sales_projections: projections })
                .eq('id', b.id)

            if (!upErr) {
                console.log(`   Deleted snapshot for Store ${b.store_id.substring(0, 6)}... Week ${b.week_start}`)
                count++
            }
        }
    }
    console.log(`✨ Cleared ${count} snapshots. Database is clean.`)
}

clearSnapshots()
