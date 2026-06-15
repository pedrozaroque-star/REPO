import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { getValidToken } from '../lib/basecamp-api';

async function main() {
    console.log('Recursive Vault Listing for Weekly Operations Report...');
    const projectId = 21853276; // All Locations
    const accountId = '5052386'; // Basecamp account ID
    const weeklyVaultId = 4942652625;
    
    const token = await getValidToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
    };
    
    async function inspectVault(vaultId: number, depth: number = 0) {
        const indent = ' '.repeat(depth * 4);
        console.log(`${indent}📁 Vault ID: ${vaultId}`);
        
        let vaultsUrl = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/vaults/${vaultId}/vaults.json`;
        let docsUrl = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/vaults/${vaultId}/documents.json`;
        let uploadsUrl = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/vaults/${vaultId}/uploads.json`;
        
        try {
            // Folders
            const vRes = await fetch(vaultsUrl, { headers });
            const subVaults = await vRes.json();
            console.log(`${indent}  - Folders count: ${subVaults.length || 0}`);
            
            // Docs
            const dRes = await fetch(docsUrl, { headers });
            const docs = await dRes.json();
            console.log(`${indent}  - Docs count: ${docs.length || 0}`);
            if (docs.length > 0) {
                docs.forEach((d: any) => console.log(`${indent}    📄 Doc: ${d.title} (ID: ${d.id}, type: ${d.type})`));
            }
            
            // Uploads
            const uRes = await fetch(uploadsUrl, { headers });
            const uploads = await uRes.json();
            console.log(`${indent}  - Uploads count: ${uploads.length || 0}`);
            if (uploads.length > 0) {
                uploads.forEach((u: any) => console.log(`${indent}    📤 Upload: ${u.filename || u.title} (ID: ${u.id}, type: ${u.type}, content_type: ${u.content_type}, download_url: ${u.download_url})`));
            }
            
            // Recurse subfolders
            for (const sv of subVaults) {
                console.log(`${indent}  -> Inside folder "${sv.title || sv.name}"`);
                await inspectVault(sv.id, depth + 1);
            }
        } catch (err: any) {
            console.error(`${indent}  ❌ Error inspecting vault ${vaultId}:`, err.message);
        }
    }
    
    await inspectVault(weeklyVaultId);
}

main().catch(console.error);
