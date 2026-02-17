
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function listStores() {
    console.log('Fetching stores...')
    const { data: stores, error } = await supabase.from('stores').select('id, name, address')

    if (error) {
        console.error('Error:', error.message)
        return
    }

    console.log(`Found ${stores.length} stores:`)
    stores.forEach((s: any) => {
        console.log(`- [${s.id}] "${s.name}" (Addr: ${s.address || 'N/A'})`)
    })
}

listStores()
