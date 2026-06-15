import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    const vaultId = '4942652625' // Weekly Operations Report
    
    const url = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}.json`
    console.log('Fetching Weekly Operations Report vault from:', url)
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    
    if (res.ok) {
        const data = await res.json()
        console.log('Vault details:', JSON.stringify(data, null, 2))
    } else {
        console.log('Error:', res.status, await res.text())
    }
}
run()
