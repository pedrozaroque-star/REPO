import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        
        const q = 'Report'
        const url = `https://3.basecampapi.com/5052386/search.json?q=${encodeURIComponent(q)}&bucket_id=${projectId}`
        console.log(`Searching for "${q}"...`)
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync' }
        })
        if (res.ok) {
            const data = await res.json()
            console.log(`Found ${data.length} results. Details:`)
            for (const item of data) {
                console.log(`- [${item.type}] "${item.title || item.filename || item.name}" (ID: ${item.id}, Parent ID: ${item.parent?.id}, URL: ${item.app_url || item.url})`)
            }
        }
    } catch (e: any) {
        console.error(e)
    }
}
run()
