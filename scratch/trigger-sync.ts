import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    console.log('Triggering POST /api/basecamp/sync...')
    const port = process.env.PORT || '3000'
    const url = `http://localhost:${port}/api/basecamp/sync`
    try {
        const res = await fetch(url, {
            method: 'POST'
        })
        console.log('Status:', res.status)
        const json = await res.json()
        console.log('Result:', JSON.stringify(json, null, 2))
    } catch (e: any) {
        console.error('Error triggering sync:', e.message)
    }
}

run()
