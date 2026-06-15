import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const { data } = await supabaseAdmin.from('bc_vaults').select('*').limit(1)
    console.log('bc_vaults keys:', data && data.length > 0 ? Object.keys(data[0]) : 'no row')
}
run()
