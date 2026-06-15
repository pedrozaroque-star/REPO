import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    try {
        const { data: uploads } = await supabaseAdmin
            .from('bc_uploads')
            .select('id, bc_id, filename, content_type, byte_size, vault_id, created_at')
            .order('created_at', { ascending: false })
            
        console.log(`Total uploads in DB: ${uploads?.length}`)
        if (uploads) {
            for (let i = 0; i < uploads.length; i++) {
                const u = uploads[i]
                console.log(`${i+1}. Filename: "${u.filename}" (Type: ${u.content_type}, Vault ID: ${u.vault_id}, BC ID: ${u.bc_id})`)
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
