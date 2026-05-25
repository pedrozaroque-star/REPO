import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testProjectionsCache() {
    console.log('🔍 Testing sales_projections_cache table access...')

    // Attempt to select from the newly created table
    const { data, error } = await supabase
        .from('sales_projections_cache')
        .select('*')
        .limit(1)

    if (error) {
        console.error('❌ Error accessing sales_projections_cache:', error.message)
    } else {
        console.log('✅ Success! The table exists and is accessible. Found rows:', data.length)
        if (data.length > 0) {
             console.log(data[0])
        }
    }
}

testProjectionsCache()
