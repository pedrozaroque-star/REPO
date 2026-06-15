import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    console.log('--- ALL UPLOADS IN DB ---')
    const { data: uploads } = await supabaseAdmin
        .from('bc_uploads')
        .select('id, filename, content_type, vault_id, created_at')
        .order('filename')
    
    if (uploads) {
        for (const u of uploads) {
            console.log(`- Upload: "${u.filename}" (Type: ${u.content_type}, Vault ID: ${u.vault_id})`)
        }
    }

    console.log('--- ALL DOCUMENTS IN DB ---')
    const { data: docs } = await supabaseAdmin
        .from('bc_documents')
        .select('id, title, vault_id, created_at')
        .order('title')
    
    if (docs) {
        for (const d of docs) {
            console.log(`- Doc: "${d.title}" (Vault ID: ${d.vault_id})`)
        }
    }
}

run()
