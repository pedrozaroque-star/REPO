import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const url = `https://3.basecampapi.com/5052386/search.json?q=Santa+Ana`
    console.log('Searching for "Santa Ana" from:', url)
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    
    if (res.ok) {
        const data = await res.json()
        console.log('Search results count:', data.length)
        for (const item of data) {
            console.log(`- Title: "${item.title || item.filename}" (Type: ${item.type}, ID: ${item.id}, Vault ID: ${item.parent?.id || item.vault_id})`)
        }
    } else {
        console.log('Failed:', res.status, await res.text())
    }
}
run()
