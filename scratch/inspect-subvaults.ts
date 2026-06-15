import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        // Let's fetch the vaults inside the main vault (3669710633)
        const url = `https://3.basecampapi.com/5052386/buckets/21853276/vaults/3669710633/vaults.json`
        console.log('Fetching subvaults from:', url)

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })

        if (!res.ok) {
            console.log('Failed:', res.status, await res.text())
            return
        }

        const subvaults = await res.json()
        console.log('Subvaults returned:', subvaults.length)
        console.log('Subvaults array sample:', JSON.stringify(subvaults.slice(0, 2), null, 2))

        // Let's fetch documents in vault 3669710633
        const docsUrl = `https://3.basecampapi.com/5052386/buckets/21853276/vaults/3669710633/documents.json`
        const docsRes = await fetch(docsUrl, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync' }
        })
        const docs = await docsRes.json()
        console.log('Documents inside main vault:', docs.length)

        // Let's fetch uploads in vault 3669710633
        const uploadsUrl = `https://3.basecampapi.com/5052386/buckets/21853276/vaults/3669710633/uploads.json`
        const uploadsRes = await fetch(uploadsUrl, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync' }
        })
        const uploads = await uploadsRes.json()
        console.log('Uploads inside main vault:', uploads.length)
        if (uploads.length > 0) {
            console.log('Upload sample:', JSON.stringify(uploads[0], null, 2))
        }

    } catch (err) {
        console.error('Error:', err)
    }
}

run()
