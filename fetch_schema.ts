
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env vars')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
    const { data, error } = await supabase
        .from('assistant_checklists')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error:', error)
    } else {
        // console.log('Columns:', Object.keys(data[0]))
        console.log('Sample Data:', data[0])
    }
}

test()
