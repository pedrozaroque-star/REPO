import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    const token = await getValidToken()
    const vaultId = '3669710633'
    const projectId = '21853276'
    
    // Fetch Vaults (subfolders)
    const vaultsUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/vaults.json`
    console.log('Fetching sub-vaults from:', vaultsUrl)
    const vaultsRes = await fetch(vaultsUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    const vaults = await vaultsRes.json()
    console.log('Sub-vaults count:', vaults.length)
    if (vaults.length > 0) {
        console.log('First sub-vault:', JSON.stringify(vaults[0], null, 2))
    }

    // Fetch Uploads (files)
    const uploadsUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/uploads.json`
    console.log('Fetching uploads from:', uploadsUrl)
    const uploadsRes = await fetch(uploadsUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    const uploads = await uploadsRes.json()
    console.log('Uploads count:', uploads.length)
    if (uploads.length > 0) {
        console.log('First 3 uploads:', JSON.stringify(uploads.slice(0, 3), null, 2))
    }

    // Fetch Documents
    const docsUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/documents.json`
    console.log('Fetching documents from:', docsUrl)
    const docsRes = await fetch(docsUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    const docs = await docsRes.json()
    console.log('Documents count:', docs.length)
    if (docs.length > 0) {
        console.log('First document:', JSON.stringify(docs[0], null, 2))
    }
}

run()
