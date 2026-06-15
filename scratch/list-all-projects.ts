import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const url = `https://3.basecampapi.com/5052386/projects.json`
        console.log('Listing all projects from:', url)
        
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })
        
        console.log('Status:', res.status)
        if (res.ok) {
            const data = await res.json()
            console.log(`Found ${data.length} projects:`)
            for (const p of data) {
                console.log(`- Project: "${p.name}" (ID: ${p.id}, Status: ${p.status})`)
            }
        } else {
            console.log('Error:', await res.text())
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
