import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const { data } = await supabaseAdmin
        .from('bc_todos')
        .select('*')
        .ilike('title', '%Norwalk-Accidente%')
        .limit(1)

    if (data && data.length > 0) {
        console.log('Todo ID:', data[0].id)
        console.log('BC ID:', data[0].bc_id)
        console.log('Title:', data[0].title)
        console.log('Description Length:', data[0].description?.length)
    } else {
        console.log('No todo found')
    }
}
run()
