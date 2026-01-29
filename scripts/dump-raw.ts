
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const WEEK = '2026-01-26'

async function rawDump() {
    const { data } = await supabase
        .from('weekly_budgets')
        .select('sales_projections')
        .eq('store_id', LYNWOOD_GUID)
        .eq('week_start', WEEK)
        .single()

    console.log("💾 CONTENIDO CRUDO (DB): weekly_budgets")
    console.log(JSON.stringify(data?.sales_projections, null, 2))
}

rawDump()
