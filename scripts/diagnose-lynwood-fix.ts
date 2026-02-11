
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function testFix() {
    const lynwoodId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

    // Attempt 2: Explicit Filter 'cs' with JSON String Array
    console.log('--- Attempt 2: filter("store_ids", "cs", JSON String) ---')
    const jsonStr = JSON.stringify([lynwoodId])
    console.log('Searching for:', jsonStr)

    const { data: emps2, error: err2 } = await supabase
        .from('toast_employees')
        .select('first_name')
        .filter('store_ids', 'cs', jsonStr)
        .limit(1)

    if (err2) console.error('Attempt 2 Failed:', err2)
    else console.log(`Attempt 2 Success! Found:`, emps2?.[0]?.first_name)

    // Attempt 3: Filter 'cs' with formatted string manually
    console.log('--- Attempt 3: filter("store_ids", "cs", `["..."]`) ---')
    const manualStr = `["${lynwoodId}"]`
    const { data: emps3, error: err3 } = await supabase
        .from('toast_employees')
        .select('first_name')
        .filter('store_ids', 'cs', manualStr)
        .limit(1)

    if (err3) console.error('Attempt 3 Failed:', err3)
    else console.log(`Attempt 3 Success! Found:`, emps3?.[0]?.first_name)
}

testFix()
