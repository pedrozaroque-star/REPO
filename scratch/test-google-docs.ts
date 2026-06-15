import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { getValidToken } from '../lib/basecamp-api';

async function main() {
    console.log('Testing google_documents.json endpoint...');
    const projectId = 21853276; // All Locations
    const accountId = '5052386'; // Basecamp account ID
    const docsVaultId = 3669710633;
    
    const token = await getValidToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
    };
    
    try {
        console.log(`Fetching google_documents.json for Vault ${docsVaultId}...`);
        const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/vaults/${docsVaultId}/google_documents.json`;
        const res = await fetch(url, { headers });
        console.log('Google documents status:', res.status);
        const data = await res.json();
        console.log('Google Documents:', JSON.stringify(data, null, 2));
    } catch (e: any) {
        console.error('Error fetching google_documents:', e.message);
    }
}

main().catch(console.error);
