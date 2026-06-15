import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const { data: vault } = await supabaseAdmin
        .from('bc_vaults')
        .select('id, name, bc_id, project_id')
        .eq('bc_id', 4942652625)
        .single()
    
    if (vault) {
        console.log('Vault:', vault)
        const { data: project } = await supabaseAdmin
            .from('bc_projects')
            .select('id, name, bc_id')
            .eq('id', vault.project_id)
            .single()
        console.log('Project:', project)
    } else {
        console.log('No vault found with bc_id 4942652625')
    }
}
run()
