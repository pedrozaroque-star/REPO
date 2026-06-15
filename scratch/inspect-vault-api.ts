import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'
import { getValidToken } from '../lib/basecamp-api'

async function run() {
    console.log('Querying vaults from DB...')
    try {
        const { data: vaults, error } = await supabaseAdmin
            .from('bc_vaults')
            .select('*')

        if (error || !vaults || vaults.length === 0) {
            console.error('DB Error or no vaults:', error)
            return
        }

        const vault = vaults[0]
        console.log('Vault DB ID:', vault.id)
        console.log('Vault BC ID:', vault.bc_id)

        // Get project bc_id
        const { data: project } = await supabaseAdmin
            .from('bc_projects')
            .select('bc_id')
            .eq('id', vault.project_id)
            .single()

        if (!project) {
            console.log('No project found')
            return
        }

        const projectBcId = project.bc_id
        console.log('Project BC ID:', projectBcId)

        const token = await getValidToken()
        const url = `https://3.basecampapi.com/5052386/buckets/${projectBcId}/vaults/${vault.bc_id}.json`
        console.log('Fetching Vault details from Basecamp API:', url)

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })

        if (!res.ok) {
            console.log('Failed:', res.status, await res.text())
            return
        }

        const vaultJson = await res.json()
        console.log('Vault JSON Keys:', Object.keys(vaultJson))
        console.log('Vault Title:', vaultJson.title)
        console.log('Vaults count inside:', vaultJson.vaults_count)
        console.log('Uploads count inside:', vaultJson.uploads_count)
        console.log('Documents count inside:', vaultJson.documents_count)
        
        // Wait, does it have a list of contents or sub-elements?
        // Let's print the entire JSON keys and metadata
        console.log('Vault JSON:', JSON.stringify(vaultJson, null, 2))
    } catch (err) {
        console.error('Catch error:', err)
    }
}

run()
