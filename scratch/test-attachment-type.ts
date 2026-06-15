import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        
        const url = `https://3.basecampapi.com/5052386/projects/recordings.json?type=Attachment&bucket=${projectId}`
        console.log(`Querying: ${url}`)
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
            for (const item of data) {
                console.log(`- [${item.type}] "${item.title || item.filename}" (ID: ${item.id}, Parent: ${item.parent?.title} [${item.parent?.type}], URL: ${item.app_url || item.url})`)
            }
        } else {
            console.log(`Error:`, await res.text())
        }
    } catch (e: any) {
        console.error(e)
    }
}
run()
