import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { getValidToken } from '../lib/basecamp-api';

async function main() {
    console.log('Fetching files and docs...');
    const projectId = 21853276; // All Locations
    const accountId = '5052386'; // Basecamp account ID
    const docsVaultId = 3669710633;
    
    const token = await getValidToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
    };
    
    // 1. Fetch documents
    try {
        console.log('Fetching documents...');
        const res = await fetch(`https://3.basecampapi.com/${accountId}/buckets/${projectId}/vaults/${docsVaultId}/documents.json`, { headers });
        const docs = await res.json();
        console.log('Documents list:', JSON.stringify(docs, null, 2));
    } catch (e: any) {
        console.error('Error documents:', e.message);
    }

    // 2. Fetch uploads
    try {
        console.log('Fetching uploads...');
        const res = await fetch(`https://3.basecampapi.com/${accountId}/buckets/${projectId}/vaults/${docsVaultId}/uploads.json`, { headers });
        const uploads = await res.json();
        console.log('Uploads list:', JSON.stringify(uploads, null, 2));
    } catch (e: any) {
        console.error('Error uploads:', e.message);
    }
}

main().catch(console.error);
