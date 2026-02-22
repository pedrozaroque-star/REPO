
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkShiftsSchema() {
    const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error:', error)
        return
    }
    console.log('Columns in shifts:', Object.keys(data[0] || {}))
}

checkShiftsSchema()
