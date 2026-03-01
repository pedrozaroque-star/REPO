import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function clear() {
    console.log('Clearing all punch violations...')
    const { data, error } = await supabase
        .from('punch_violations')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Deletes all using realistic uuid format

    if (error) {
        console.error('Error clearing data:', error)
    } else {
        console.log('✅ Violations cleared successfully. Data length affected:', data?.length ?? 'All')
    }
}
clear()
