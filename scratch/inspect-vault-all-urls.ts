import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        const vaultId = '3669710633' // Docs & Files (contains 5 Google Docs)
        
        const paths = [
            `buckets/${projectId}/vaults/${vaultId}/google_documents.json`,
            `buckets/${projectId}/vaults/${vaultId}/google_docs.json`,
            `buckets/${projectId}/vaults/${vaultId}/google_document.json`,
            `buckets/${projectId}/vaults/${vaultId}/google_doc.json`,
            `buckets/${projectId}/vaults/${vaultId}/cloud_files.json`,
            `buckets/${projectId}/vaults/${vaultId}/cloud_file.json`,
            `buckets/${projectId}/vaults/${vaultId}/cloud/files.json`,
            `buckets/${projectId}/vaults/${vaultId}/cloud_documents.json`,
            `buckets/${projectId}/vaults/${vaultId}/cloud_document.json`,
            
            // Without buckets prefix
            `vaults/${vaultId}/google_documents.json`,
            `vaults/${vaultId}/google_docs.json`,
            `vaults/${vaultId}/google_document.json`,
            `vaults/${vaultId}/google_doc.json`,
            `vaults/${vaultId}/cloud_files.json`,
            `vaults/${vaultId}/cloud_file.json`,
            `vaults/${vaultId}/cloud_documents.json`,
            
            // Other potential endpoints
            `buckets/${projectId}/google_documents.json`,
            `buckets/${projectId}/cloud_files.json`,
            `buckets/${projectId}/google_docs.json`,
            
            // Try different capitalization
            `buckets/${projectId}/vaults/${vaultId}/googleDocuments.json`,
            `buckets/${projectId}/vaults/${vaultId}/cloudFiles.json`,
        ]
        
        for (const p of paths) {
            const url = `https://3.basecampapi.com/5052386/${p}`
            console.log(`Testing: ${p}`)
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
                }
            })
            console.log(`  Status: ${res.status}`)
            if (res.ok) {
                const text = await res.text()
                try {
                    const data = JSON.parse(text)
                    console.log(`  SUCCESS! Count: ${Array.isArray(data) ? data.length : 'object'}`)
                    if (Array.isArray(data) && data.length > 0) {
                        console.log(`  First item sample:`, JSON.stringify(data[0], null, 2))
                    }
                } catch {
                    console.log(`  Succeeded but response not JSON:`, text.slice(0, 100))
                }
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
