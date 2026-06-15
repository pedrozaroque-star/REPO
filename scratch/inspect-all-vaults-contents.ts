import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        
        // Vaults list from DB
        const vaults = [
            { id: '3669710633', name: 'Docs & Files' },
            { id: '4689406731', name: 'Recursos Humanos' },
            { id: '4479349299', name: 'Daily Order Forms' },
            { id: '4484124402', name: 'Checklists' },
            { id: '3673722410', name: 'Toast Tutorials' },
            { id: '4182980856', name: 'Daily Use Forms' },
            { id: '3784564251', name: 'Misc. Files' },
            { id: '4942652625', name: 'Weekly Operations Report' }
        ]
        
        for (const v of vaults) {
            console.log(`\n==================================================`)
            console.log(`Vault: "${v.name}" (BC ID: ${v.id})`)
            
            // 1. Vault details
            const detUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${v.id}.json`
            const detRes = await fetch(detUrl, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
            })
            if (detRes.ok) {
                const det = await detRes.json()
                console.log(`  Details: docs_count=${det.documents_count}, uploads_count=${det.uploads_count}, vaults_count=${det.vaults_count}`)
            } else {
                console.log(`  Details Error: ${detRes.status}`)
            }
            
            // 2. Documents
            const docUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${v.id}/documents.json`
            const docRes = await fetch(docUrl, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
            })
            if (docRes.ok) {
                const docs = await docRes.json()
                console.log(`  Documents (${docs.length}):`)
                for (const d of docs) {
                    console.log(`    - "${d.title}" (ID: ${d.id}, type: ${d.type})`)
                }
            } else {
                console.log(`  Docs Error: ${docRes.status}`)
            }

            // 3. Uploads
            const upUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${v.id}/uploads.json`
            const upRes = await fetch(upUrl, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
            })
            if (upRes.ok) {
                const ups = await upRes.json()
                console.log(`  Uploads (${ups.length}):`)
                for (const u of ups) {
                    console.log(`    - "${u.filename}" (ID: ${u.id}, type: ${u.type}, contentType: ${u.content_type})`)
                }
            } else {
                console.log(`  Uploads Error: ${upRes.status}`)
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
