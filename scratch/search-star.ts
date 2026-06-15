import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        
        const url = `https://3.basecampapi.com/5052386/search.json?q=*&bucket_id=${projectId}`
        console.log(`Searching for "*" in project ${projectId}: ${url}`)
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })
        console.log(`Status: ${res.status}`)
        if (res.ok) {
            const data = await res.json()
            console.log(`SUCCESS! Count: ${data.length}`)
            const types = new Set()
            for (const item of data) {
                types.add(item.type)
                if (item.type.includes('Google') || item.type.includes('Cloud') || item.type.includes('File') || item.type === 'Vault' || item.type === 'Document') {
                    console.log(`- [${item.type}] "${item.title || item.filename}" (ID: ${item.id}, Parent ID: ${item.parent?.id}, URL: ${item.app_url || item.url})`)
                }
            }
            console.log('All types in results:', Array.from(types))
        } else {
            console.log('Error:', await res.text())
        }
    } catch (e: any) {
        console.error(e)
    }
}
run()
