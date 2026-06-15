import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const vaultId = '3669710633' // Docs & Files
        
        const paths = [
            `vaults/${vaultId}/recordings.json`,
            `vaults/${vaultId}/cloud_files.json`,
            `vaults/${vaultId}/google_documents.json`,
            `vaults/${vaultId}/google_docs.json`,
            
            // With buckets prefix just in case
            `buckets/21853276/vaults/${vaultId}/recordings.json`,
        ]
        
        for (const p of paths) {
            const url = `https://3.basecampapi.com/5052386/${p}`
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
                if (data.length > 0) {
                    console.log(`  Types found:`, Array.from(new Set(data.map((r: any) => r.type))))
                    console.log(`  Sample item:`, JSON.stringify(data[0], null, 2))
                }
            } else {
                console.log(`  Error:`, await res.text().then(t => t.slice(0, 100)))
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
