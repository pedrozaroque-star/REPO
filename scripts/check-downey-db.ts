
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkStores() {
    const { data: stores } = await supabase
        .from('stores')
        .select('*')
        .ilike('name', '%Downey%')

    console.log('Downey Stores:', stores)
}

checkStores()
