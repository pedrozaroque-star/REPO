
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkPunchesSchema() {
    const { data, error } = await supabase
        .from('punches')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error:', error)
        return
    }
    console.log('Columns in punches:', Object.keys(data[0] || {}))
}

checkPunchesSchema()
