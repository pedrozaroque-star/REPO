import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const terms = ['Puente', 'Broadway', 'Central']
    
    for (const term of terms) {
        const url = `https://3.basecampapi.com/5052386/search.json?q=${encodeURIComponent(term)}`
        console.log(`Searching for "${term}" from:`, url)
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
        })
        
        if (res.ok) {
            const data = await res.json()
            console.log(`Search results count for "${term}":`, data.length)
            for (const item of data.slice(0, 10)) {
                console.log(`- Title: "${item.title || item.filename}" (Type: ${item.type}, ID: ${item.id}, Parent ID: ${item.parent?.id})`)
                console.log(`  Details:`, JSON.stringify(item, null, 2))
            }
        } else {
            console.log('Failed:', res.status, await res.text())
        }
    }
}
run()
