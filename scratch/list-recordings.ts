import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { getValidToken } from '../lib/basecamp-api';

async function main() {
    console.log('Listing all recordings in project 21853276...');
    const projectId = 21853276;
    const accountId = '5052386';
    
    const token = await getValidToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
    };
    
    // We can list recordings. It supports pagination.
    const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/recordings.json`;
    const res = await fetch(url, { headers });
    console.log('Recordings response status:', res.status);
    if (!res.ok) {
        console.error(await res.text());
        return;
    }
    const data = await res.json();
    console.log(`Found ${data.length} recordings.`);
    
    const types = new Set(data.map((r: any) => r.type));
    console.log('Recordings types present:', Array.from(types));
    
    // Print first 5 non-Comment/non-Todo recordings
    const interesting = data.filter((r: any) => r.type !== 'Comment' && r.type !== 'Todo' && r.type !== 'TodoList');
    console.log('Interesting recordings:', JSON.stringify(interesting.slice(0, 10), null, 2));
}

main().catch(console.error);
