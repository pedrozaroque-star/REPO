import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    if (!supabaseUrl || !supabaseKey) { console.error('Missing Supabase keys'); return; }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Check what is inside the 'punches' table or if 'toast_punches' exists
    const { data, error } = await supabase
        .from('punches')
        .select('*')
        .order('business_date', { ascending: false })
        .limit(5)

    if (error) {
        console.error('Error fetching punches:', error.message)
    } else {
        console.log('Punches sample:')
        console.log(JSON.stringify(data[0], null, 2))
    }

    // Check if there is anything indicating breaks
    const { data: breakPunches, error: bError } = await supabase
        .from('punches')
        .select('*')
        .not('breaks', 'is', null)
        .limit(1)

    if (bError) console.error(bError)
    else console.log('Punches with breaks field:', breakPunches?.length)
}

run()
