
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function checkHours() {
    const { data: stores } = await supabase.from('stores').select('name, opening_time, closing_time').order('name')
    console.log('Name | Open | Close')
    stores?.forEach(s => {
        console.log(`${s.name} | ${s.opening_time} | ${s.closing_time}`)
    })
}

checkHours()
