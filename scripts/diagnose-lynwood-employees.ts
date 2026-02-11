
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function diagnose() {
    console.log('🔍 Diagnosing Lynwood Employees...')

    // 1. Get Lynwood Store ID
    const { data: stores, error: storeError } = await supabase
        .from('stores')
        .select('name, external_id')
        .ilike('name', '%Lynwood%')

    if (storeError) {
        console.error('❌ Error fetching stores:', storeError)
        return
    }

    if (!stores || stores.length === 0) {
        console.error('❌ Store Lynwood not found in "stores" table')
        return
    }

    console.log('✅ Found Lynwood Store(s):', stores)
    const lynwoodId = stores[0].external_id

    // 2. Check Employees with this Store ID
    // Check raw employees first to see format of store_ids
    const { data: sampleEmps } = await supabase
        .from('toast_employees')
        .select('first_name, store_ids')
        .not('store_ids', 'is', null)
        .limit(5)

    console.log('👀 Sample Employee store_ids format:', JSON.stringify(sampleEmps, null, 2))

    // 3. Try Exact Match Query used in API
    const { data: employees, error: empError } = await supabase
        .from('toast_employees')
        .select('id, first_name, email')
        .contains('store_ids', [lynwoodId])
        .not('email', 'is', null)

    if (empError) {
        console.error('❌ Error in .contains query:', empError)
    } else {
        console.log(`📊 Query result: Found ${employees?.length} employees for Lynwood ID ${lynwoodId}`)
    }

    // 4. Try Text Search Fallback if contains fails (sometimes store_ids is text not array)
    // Check if store_ids column type is compatible
    // We can't check schema easily, but we can try simple ILIKE if store_ids is stored as string

    // 5. Count total employees
    const { count } = await supabase.from('toast_employees').select('*', { count: 'exact', head: true })
    console.log('🔢 Total employees in DB:', count)
}

diagnose()
