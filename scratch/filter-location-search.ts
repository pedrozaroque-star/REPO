import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const terms = ['Puente', 'Broadway', 'Central']
    
    for (const term of terms) {
        const url = `https://3.basecampapi.com/5052386/search.json?q=${encodeURIComponent(term)}`
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync' }
        })
        
        if (res.ok) {
            const data = await res.json()
            const filtered = data.filter((item: any) => 
                item.type.includes('Google') || 
                item.type.includes('Cloud') || 
                item.type.includes('Doc') ||
                item.type.includes('File') ||
                item.type.includes('Upload') ||
                item.title?.toLowerCase().includes('report')
            )
            console.log(`\nFiltered results for "${term}" (${filtered.length} matches out of ${data.length}):`)
            for (const item of filtered) {
                console.log(`- [${item.type}] "${item.title || item.filename}" (ID: ${item.id}, Parent: ${item.parent?.title} [${item.parent?.type}])`)
            }
        }
    }
}
run()
