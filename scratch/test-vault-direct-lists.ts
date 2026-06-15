import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        const vaultId = '4942652625' // Weekly Operations Report
        
        const endpoints = [
            `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/uploads.json`,
            `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/documents.json`,
            `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/vaults.json`,
        ]
        
        for (const url of endpoints) {
            console.log(`Fetching: ${url}`)
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
                }
            })
            console.log(`  Status: ${res.status}`)
            if (res.ok) {
                const data = await res.json()
                console.log(`  Count: ${data.length}`)
                if (data.length > 0) {
                    console.log(`  Sample (first item):`, JSON.stringify(data[0], null, 2))
                }
            } else {
                console.log(`  Error:`, await res.text())
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
