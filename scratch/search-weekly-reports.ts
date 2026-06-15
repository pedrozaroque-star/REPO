import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        
        // Search queries
        const queries = ['Weekly', 'Operations', 'Report', 'Slauson', 'Lynwood', 'Downey']
        
        for (const q of queries) {
            const url = `https://3.basecampapi.com/5052386/search.json?q=${encodeURIComponent(q)}&bucket_id=${projectId}`
            console.log(`Searching for "${q}" in project ${projectId}: ${url}`)
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
                const matches = data.filter((item: any) => 
                    item.type.includes('Google') || 
                    item.type.includes('Cloud') || 
                    item.type.includes('Attachment') || 
                    item.type.includes('Upload') ||
                    item.type.includes('Document') ||
                    item.type === 'Vault'
                )
                console.log(`  Filtered (non-Todo/Comment/Message) Count: ${matches.length}`)
                for (const item of matches.slice(0, 10)) {
                    console.log(`    - [${item.type}] "${item.title || item.filename}" (ID: ${item.id}, Parent ID: ${item.parent?.id}, URL: ${item.app_url || item.url})`)
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
