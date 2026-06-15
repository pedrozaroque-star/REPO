import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

async function findVaults(token: string, projectId: string, vaultId: string, depth = 0) {
    const spaces = '  '.repeat(depth)
    const vaultsUrl = `https://3.basecampapi.com/5052386/buckets/${projectId}/vaults/${vaultId}/vaults.json`
    const res = await fetch(vaultsUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)' }
    })
    if (!res.ok) return
    const vaults = await res.json()
    for (const v of vaults) {
        console.log(`${spaces}- Found Vault: "${v.title}" (ID: ${v.id})`)
        await findVaults(token, projectId, v.id, depth + 1)
    }
}

async function run() {
    const token = await getValidToken()
    const projectId = '21853276'
    
    // First list the root vaults or find the main vault
    console.log('Searching all vaults recursively...')
    // We know the main vault ID is 3669710633
    await findVaults(token, projectId, '3669710633')
}

run()
