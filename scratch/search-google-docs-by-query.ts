import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const queries = ['google', 'drive', 'spreadsheet', 'report', 'doc', 'sheet']
    
    for (const q of queries) {
        const url = `https://3.basecampapi.com/5052386/search.json?query=${encodeURIComponent(q)}`
        console.log(`Searching for "${q}"...`)
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync' }
        })
        if (res.ok) {
            const data = await res.json()
            console.log(`  Found ${data.length} results:`)
            for (const item of data.slice(0, 5)) {
                console.log(`    - [${item.type}] "${item.title}" (ID: ${item.id}, url: ${item.url})`)
            }
        } else {
            console.log(`  Error:`, res.status, await res.text())
        }
    }
}
run()
