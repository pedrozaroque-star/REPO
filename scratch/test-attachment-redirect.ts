import { getValidToken } from '../lib/basecamp-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    try {
        const token = await getValidToken()
        console.log('Valid token obtained:', token.slice(0, 10) + '...')
        
        const targetUrl = 'https://3.basecampapi.com/5052386/blobs/afddbd48-28bf-11f1-a44e-0242ac120004/previews/full'
        const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'
        
        console.log('Fetching:', targetUrl)
        const res = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': userAgent,
            },
            redirect: 'manual',
        })
        
        console.log('Response Status:', res.status)
        console.log('Response Headers:', Object.fromEntries(res.headers.entries()))
        const bodyText = await res.text()
        console.log('Response Body snippet:', bodyText.slice(0, 200))
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}

run()
