import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = 21853276
        
        // Fetch all recordings in the bucket
        const url = `https://3.basecampapi.com/5052386/search/metadata.json`
        console.log('Fetching search metadata from:', url)

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })

        if (res.ok) {
            const data = await res.json()
            console.log('Search Metadata:', JSON.stringify(data, null, 2))
        } else {
            console.log('Failed:', res.status, await res.text())
        }
        return;
        
        // Let's print all unique types and some records
        const uniqueTypes = new Set(recordings.map((r: any) => r.type))
        console.log('Unique types:', Array.from(uniqueTypes))
        
        // Find recordings with Google Docs names
        const targetNames = ['Santa Ana', 'Bell', 'Downey', 'Azusa', 'Norwalk', 'Lynwood', 'La Puente', 'Broadway', 'Central']
        const matches = recordings.filter((r: any) => 
            targetNames.some(name => r.title?.includes(name) || r.filename?.includes(name))
        )

        console.log('Matches:', matches.length)
        if (matches.length > 0) {
            console.log('Sample Matches:', JSON.stringify(matches.slice(0, 10), null, 2))
        }
    } catch (err) {
        console.error('Error:', err)
    }
}

run()
