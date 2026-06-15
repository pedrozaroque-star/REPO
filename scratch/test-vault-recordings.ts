import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    // Let's test both root vaults:
    // 1. Docs & Files: 3669710633
    // 2. Weekly Operations Report: 4942652625
    
    for (const vaultId of ['3669710633', '4942652625']) {
        const url = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/recordings.json`
        console.log(`Testing recordings for vault ${vaultId}: ${url}`)
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
        })
        console.log(`  Status: ${res.status}`)
        if (res.ok) {
            const data = await res.json()
            console.log(`  Count: ${data.length}`)
            if (data.length > 0) {
                console.log(`  First item type: ${data[0].type}, title: ${data[0].title || data[0].filename}`)
                console.log(`  First item details:`, JSON.stringify(data[0], null, 2))
            }
        } else {
            console.log(`  Error:`, await res.text())
        }
    }
}

run()
