import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    console.log('Querying vaults...')
    const { data: vaults, error: vErr } = await supabaseAdmin
        .from('bc_vaults')
        .select('id, bc_id, name, parent_vault_id')
    console.log('Vaults count:', vaults?.length)
    console.log('Vaults list:', vaults)
    if (vErr) console.error(vErr)

    console.log('Querying documents...')
    const { data: docs, error: dErr } = await supabaseAdmin
        .from('bc_documents')
        .select('id, bc_id, title, content, created_at')
    console.log('Documents count:', docs?.length)
    if (docs && docs.length > 0) {
        console.log('Sample documents:', docs.slice(0, 10))
    }

    console.log('Querying uploads...')
    const { data: uploads, error: uErr } = await supabaseAdmin
        .from('bc_uploads')
        .select('id, bc_id, filename, content_type, byte_size, created_at')
    console.log('Uploads count:', uploads?.length)
    if (uploads && uploads.length > 0) {
        console.log('Sample uploads:', uploads.slice(0, 10))
    }
}

run()
