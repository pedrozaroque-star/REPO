import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    
    const url = `https://3.basecampapi.com/5052386/projects/${projectId}/timeline.json`
    console.log('Fetching project timeline from:', url)
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    
    if (res.ok) {
        const data = await res.json()
        console.log('Timeline count:', data.length)
        if (data.length > 0) {
            console.log('Sample timeline items:')
            for (const item of data.slice(0, 10)) {
                console.log(`- Type: ${item.kind}, Title: "${item.title}", Recording Type: ${item.recording?.type}, ID: ${item.recording?.id}`)
            }
        }
    } else {
        console.log('Error:', res.status, await res.text())
    }
}
run()
