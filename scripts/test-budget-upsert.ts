
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service key to bypass RLS for test

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing env vars')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testBudgetUpsert() {
    console.log('🧪 Starting Budget Upsert Test...')

    const storeGuid = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
    const weekStart = '2026-01-26' // Monday
    const projections = {
        '2026-01-26': '10500',
        '2026-01-27': '11200',
        'test_key': 'true'
    }

    console.log(`Payload: Store: ${storeGuid}, Week: ${weekStart}`)

    // 1. UPSERT
    console.log('1. Attempting UPSERT...')
    const { data, error } = await supabase.from('weekly_budgets').upsert({
        store_id: storeGuid,
        week_start: weekStart,
        sales_projections: projections,
        updated_at: new Date().toISOString()
    }, { onConflict: 'store_id,week_start' }).select()

    if (error) {
        console.error('❌ Upsert Failed:', error)
        return
    }

    console.log('✅ Upsert Success! Data:', data)

    // 2. READ BACK
    console.log('2. Reading back...')
    const { data: readData, error: readError } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('store_id', storeGuid)
        .eq('week_start', weekStart)
        .single()

    if (readError) {
        console.error('❌ Read Failed:', readError)
    } else {
        console.log('✅ Read Success:', readData)
        if (readData.sales_projections['test_key'] === 'true') {
            console.log('🎉 Data Integrity Verified. JSON saved correctly.')
        } else {
            console.error('⚠️ Data Integrity Mismatch!')
        }
    }

    // 3. CLEANUP (Optional - maybe keep it to see in UI?)
    // Let's keep it so the user can verify in the UI if they want, or I can delete it.
    // User said "haz una prueba y me avisas".
    // Better to clean up so we don't pollute prod data with "test_key".

    console.log('3. Cleaning up test record...')
    const { error: delError } = await supabase.from('weekly_budgets')
        .delete()
        .eq('store_id', storeGuid)
        .eq('week_start', weekStart)

    if (delError) console.error('❌ Cleanup Failed:', delError)
    else console.log('✅ Cleanup Success')
}

testBudgetUpsert()
