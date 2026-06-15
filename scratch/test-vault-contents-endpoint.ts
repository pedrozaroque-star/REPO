import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        const vaultId = '3669710633'
        
        const endpoints = [
            `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/records.json`,
            `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/items.json`,
            `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/contents.json`,
        ]
        
        for (const url of endpoints) {
            console.log(`Testing: ${url}`)
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
                }
            })
            console.log(`  Status: ${res.status}`)
            if (res.ok) {
                const data = await res.json()
                console.log(`  SUCCESS! Count: ${data.length}`)
            } else {
                console.log(`  Error:`, await res.text().then(t => t.slice(0, 100)))
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
