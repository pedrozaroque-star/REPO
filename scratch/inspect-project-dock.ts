import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    
    const url = `https://3.basecampapi.com/5052386/projects/${projectId}.json`
    console.log('Fetching project details from:', url)
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    const project = await res.json()
    console.log('Project Dock Items:')
    for (const item of project.dock || []) {
        console.log(`- Title: "${item.title}" (Name: ${item.name}, URL: ${item.url})`)
    }
}

run()
