import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { POST } from '../app/api/basecamp/sync/route'

async function run() {
    console.log('Executing Basecamp Sync Handler directly...')
    try {
        const req = new Request('http://localhost:3000/api/basecamp/sync', {
            method: 'POST'
        })
        const response = await POST(req)
        console.log('Response Status:', response.status)
        const json = await response.json()
        console.log('Sync Result:', JSON.stringify(json, null, 2))
    } catch (e: any) {
        console.error('Error running sync handler:', e)
    }
}

run()
