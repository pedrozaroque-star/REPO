import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    const vaultId = '3669710633'
    
    const endpoints = [
        `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/google_documents.json`,
        `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/google_docs.json`,
        `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/cloud_files.json`,
        `https://3.basecampapi.com/5052386/vaults/${vaultId}/google_documents.json`,
        `https://3.basecampapi.com/5052386/vaults/${vaultId}/google_docs.json`,
        `https://3.basecampapi.com/5052386/vaults/${vaultId}/cloud_files.json`,
    ]
    
    for (const url of endpoints) {
        console.log(`Testing: ${url}`)
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
        })
        console.log(`  Status: ${res.status}`)
        if (res.ok) {
            const data = await res.json()
            console.log(`  Count: ${data.length}`)
            if (data.length > 0) {
                console.log(`  Sample:`, data.slice(0, 2))
            }
        }
    }
}

run()
