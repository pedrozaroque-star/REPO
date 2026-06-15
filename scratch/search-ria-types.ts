import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const url = `https://3.basecampapi.com/5052386/search.json?q=Rialto`
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })
        
        if (res.ok) {
            const data = await res.json()
            console.log(`Found ${data.length} results:`)
            for (const r of data) {
                console.log(`- "${r.title}" (Type: ${r.type}, ID: ${r.id}, Parent: ${r.parent?.title} [${r.parent?.type}])`)
            }
        } else {
            console.log('Error:', res.status)
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
