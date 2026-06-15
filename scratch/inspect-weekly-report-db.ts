import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const { data: uploads } = await supabaseAdmin
        .from('bc_uploads')
        .select('*')
        .eq('vault_id', '556ac0c2-0f65-4242-b8fa-142366980067')
    console.log('Uploads in Weekly Operations Report vault:', uploads?.length)
    if (uploads && uploads.length > 0) {
        console.log('Uploads:', uploads.map(u => ({
            id: u.id,
            filename: u.filename,
            content_type: u.content_type,
            download_url: u.download_url
        })))
    }
}
run()
