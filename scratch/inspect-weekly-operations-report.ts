import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        // The Weekly Operations Report vault ID is 4942652625
        const vaultId = 4942652625
        const projectId = 21853276
        
        // Let's fetch vault details directly
        const url = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}.json`
        console.log('Fetching vault details from:', url)
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })
        console.log('Vault details status:', res.status)
        if (res.ok) {
            const data = await res.json()
            console.log('Vault details:', JSON.stringify(data, null, 2))
        } else {
            console.log('Vault details error body:', await res.text())
        }
    } catch (err) {
        console.error('Error:', err)
    }
}

run()
