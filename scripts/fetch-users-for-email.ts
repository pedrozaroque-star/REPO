
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
    // Fetch users from the 'users' table (our custom table, not auth.users which is restricted)
    // Assuming there is a 'users' table that mirrors auth or contains app-specific roles
    const { data: appUsers, error } = await supabase
        .from('users')
        .select('email, role, full_name, password, store_scope')
        .in('role', ['manager', 'supervisor', 'admin', 'gerente', 'area_manager'])
        .order('role')

    if (error) {
        console.error('Error fetching users:', error)
        return
    }

    console.log('--- USERS FOUND ---')
    console.log(JSON.stringify(appUsers, null, 2))
}

main()
