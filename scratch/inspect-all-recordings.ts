import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    
    const types = [
        'Comment', 'Document', 'Message', 'Question::Answer', 
        'Schedule::Entry', 'Todo', 'Todolist', 'Upload', 'Vault'
    ]
    
    for (const type of types) {
        const url = `https://3.basecampapi.com/5052386/projects/recordings.json?type=${type}&bucket=${projectId}`
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync' }
        })
        
        if (res.ok) {
            const data = await res.json()
            console.log(`Type "${type}": Count = ${data.length}`)
            if (data.length > 0) {
                console.log(`  Sample titles:`, data.slice(0, 5).map((r: any) => r.title || r.filename))
            }
        } else {
            console.log(`Type "${type}": Error = ${res.status}`)
        }
    }
}
run()
