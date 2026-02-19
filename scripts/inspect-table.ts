
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    const { data, error } = await supabase
        .from('toast_menu_items')
        .select('*')
        .limit(1)

    if (error) {
        console.error(error)
    } else {
        console.log('Columns:', data && data.length > 0 ? Object.keys(data[0]) : 'No data or empty')
        if (data && data.length > 0) console.log('Sample:', data[0])
    }
}

run()
