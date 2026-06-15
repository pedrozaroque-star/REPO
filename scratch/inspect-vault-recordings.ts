import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    const vaultId = '3669710633'
    
    // Fetch all recordings inside the bucket
    const url = `https://3.basecampapi.com/5052386/buckets/${projectId}/recordings.json`
    console.log('Fetching project recordings from:', url)
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    
    if (!res.ok) {
        console.log('Failed to fetch:', res.status, await res.text())
        return
    }
    
    const recordings = await res.json()
    console.log('Found', recordings.length, 'recordings in project:')
    const types = new Set()
    for (const r of recordings) {
        types.add(r.type)
        if (r.type === 'Vault' || r.type.includes('Doc') || r.type.includes('Google') || r.title?.includes('Orders') || r.filename?.includes('Orders')) {
            console.log(`- Title: "${r.title || r.filename || r.name}" (Type: ${r.type}, ID: ${r.id}, Parent ID: ${r.parent?.id})`)
        }
    }
    console.log('All recording types found:', Array.from(types))
    
    // Check if there are any GoogleDoc types in the entire project
    const projectRecordingsUrl = `https://3.basecampapi.com/5052386/projects/recordings.json?type=GoogleDoc`
    console.log('Fetching GoogleDoc type recordings from:', projectRecordingsUrl)
    const gdRes = await fetch(projectRecordingsUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    if (gdRes.ok) {
        const gd = await gdRes.json()
        console.log('Found', gd.length, 'GoogleDoc recordings in project:')
        for (const r of gd) {
            console.log(`- GoogleDoc: "${r.title}" (ID: ${r.id})`)
        }
    } else {
        console.log('GoogleDoc query failed:', gdRes.status, await gdRes.text())
    }
}

run()
