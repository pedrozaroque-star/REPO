import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        
        // Let's test a bunch of type variations for google drive/docs
        const types = [
            'GoogleDoc', 
            'GoogleDocument', 
            'GoogleDrive', 
            'CloudFile', 
            'CloudDocument',
            'Vault'
        ]
        
        for (const type of types) {
            const url = `https://3.basecampapi.com/5052386/projects/recordings.json?type=${type}&bucket=${projectId}`
            console.log(`Testing type "${type}" from: ${url}`)
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
                }
            })
            console.log(`  Status: ${res.status}`)
            if (res.ok) {
                const data = await res.json()
                console.log(`  SUCCESS! Count: ${data.length}`)
                if (data.length > 0) {
                    console.log(`  First item:`, JSON.stringify(data[0], null, 2))
                }
            } else {
                console.log(`  Error:`, await res.text().then(t => t.slice(0, 200)))
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
