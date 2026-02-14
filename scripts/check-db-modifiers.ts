import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkModifiers() {
    console.log('--- CHECKING MODIFIERS IN DB ---')

    // Try to select is_modifier column explicitly
    const { data, error } = await supabase
        .from('toast_menu_items')
        .select('*')
        .is('is_modifier', true)
        .limit(5)

    if (error) {
        console.error('Error fetching modifiers:', error)
        // Check if error is "column is_modifier does not exist"
    } else {
        console.log(`Found ${data.length} modifiers:`)
        data.forEach(m => console.log(`- ${m.name} (${m.group_name}) [Active: ${m.active}]`))
    }
}

checkModifiers()
