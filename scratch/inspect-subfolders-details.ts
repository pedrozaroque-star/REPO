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
    console.log('Fetching sub-vaults...')
    const vaultsRes = await fetch(vaultsUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    const vaults = await vaultsRes.json()
    console.log('Found', vaults.length, 'subfolders:')
    for (const v of vaults) {
        console.log(`- Folder: "${v.title}" (ID: ${v.id})`)
        
        // Let's fetch the contents of this folder!
        const subVaultsUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${v.id}/vaults.json`
        const subUploadsUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${v.id}/uploads.json`
        const subDocsUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${v.id}/documents.json`
        
        const [svRes, suRes, sdRes] = await Promise.all([
            fetch(subVaultsUrl, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' } }),
            fetch(subUploadsUrl, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' } }),
            fetch(subDocsUrl, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' } })
        ])
        
        const sv = await svRes.json()
        const su = await suRes.json()
        const sd = await sdRes.json()
        
        console.log(`  Subfolders: ${sv.length}, Uploads: ${su.length}, Documents: ${sd.length}`)
        if (su.length > 0) {
            console.log(`  Sample Uploads in "${v.title}":`, su.slice(0, 3).map((u: any) => `${u.filename} (${u.content_type || 'no content-type'})`))
        }
        if (sd.length > 0) {
            console.log(`  Sample Documents in "${v.title}":`, sd.slice(0, 3).map((d: any) => `${d.title}`))
        }

        // Recursively inspect subfolders if Checklists
        if (v.title === 'Checklists' && sv.length > 0) {
            console.log(`--- Inspecting subfolders inside "${v.title}":`)
            for (const subV of sv) {
                console.log(`  - Sub-folder: "${subV.title}" (ID: ${subV.id})`)
                const ssvUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${subV.id}/vaults.json`
                const ssuUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${subV.id}/uploads.json`
                const ssdUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${subV.id}/documents.json`
                
                const [ssvRes, ssuRes, ssdRes] = await Promise.all([
                    fetch(ssvUrl, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' } }),
                    fetch(ssuUrl, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' } }),
                    fetch(ssdUrl, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' } })
                ])
                
                const ssv = await ssvRes.json()
                const ssu = await ssuRes.json()
                const ssd = await ssdRes.json()
                
                console.log(`    Subfolders: ${ssv.length}, Uploads: ${ssu.length}, Documents: ${ssd.length}`)
                if (ssu.length > 0) {
                    console.log(`    Uploads:`, ssu.map((u: any) => `${u.filename} (${u.content_type || 'no content-type'})`))
                }
                if (ssd.length > 0) {
                    console.log(`    Documents:`, ssd.map((d: any) => d.title))
                }
            }
        }
    }
}

run()
