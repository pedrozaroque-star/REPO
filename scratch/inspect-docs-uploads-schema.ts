import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const { data: docs } = await supabaseAdmin.from('bc_documents').select('*').limit(1)
    console.log('bc_documents keys:', docs && docs.length > 0 ? Object.keys(docs[0]) : 'no row')
    
    const { data: uploads } = await supabaseAdmin.from('bc_uploads').select('*').limit(1)
    console.log('bc_uploads keys:', uploads && uploads.length > 0 ? Object.keys(uploads[0]) : 'no row')
}
run()
