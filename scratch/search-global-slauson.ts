import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        
        // Search endpoint in Basecamp
        const url = `https://3.basecampapi.com/5052386/search.json?q=Slauson`
        console.log('Searching globally for Slauson from:', url)
        
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })
        
        console.log('Status:', res.status)
        if (res.ok) {
            const data = await res.json()
            console.log('Results count:', data.length)
            if (data.length > 0) {
                console.log('Search Results:', JSON.stringify(data, null, 2))
            }
        } else {
            console.log('Error:', await res.text())
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
