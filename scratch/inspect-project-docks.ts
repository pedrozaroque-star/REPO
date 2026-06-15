import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        
        const url = `https://3.basecampapi.com/5052386/projects/${projectId}.json`
        console.log('Fetching project details from:', url)
        
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })
        
        console.log('Status:', res.status)
        if (res.ok) {
            const data = await res.json()
            console.log('Project Dock Tools:')
            if (data.dock) {
                for (const tool of data.dock) {
                    console.log(`- Name: "${tool.name}", Title: "${tool.title}", Enabled: ${tool.enabled}, URL: ${tool.url}`)
                }
            } else {
                console.log('No docks found in project json')
            }
        } else {
            console.log('Error:', await res.text())
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
