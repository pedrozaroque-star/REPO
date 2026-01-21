
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkSchema() {
    console.log('Checking schemas...')

    // Check users table
    const { data: usersCols, error: usersError } = await supabase
        .rpc('get_column_type', { t_name: 'users', c_name: 'store_id' }) // This RPC might not exist, trying raw query via rpc if possible or assumption

    // Since we can't run arbitrary SQL easily without the custom RPC I usually add, 
    // let's try to fetch one user and one store and see the types.

    const { data: user } = await supabase.from('users').select('store_id').limit(1).single()
    const { data: store } = await supabase.from('stores').select('id').limit(1).single()

    console.log('Sample User store_id:', user?.store_id, 'Type:', typeof user?.store_id)
    console.log('Sample Store id:', store?.id, 'Type:', typeof store?.id)
}

checkSchema()
