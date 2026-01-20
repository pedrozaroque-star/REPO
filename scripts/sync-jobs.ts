
require('dotenv').config({ path: '.env.local' });
import { syncToastJobs } from '../lib/toast-labor';
import { createClient } from '@supabase/supabase-js';

// Polyfill fetch if needed (Node 18+ has it native)
// import fetch from 'node-fetch';

async function main() {
    console.log('Starting Job Sync...');

    // We need at least one valid store GUID to fetch jobs (assuming jobs are enterprise-wide mostly, 
    // or we fetch for all stores to be safe).
    // Let's iterate all stores in DB.

    const supabaseStr = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // OR SERVICE_ROLE_KEY if needed for RLS bypass

    if (!supabaseStr || !supabaseKey) {
        console.error('Missing Supabase Env');
        return;
    }

    const supabase = createClient(supabaseStr, supabaseKey);

    // Get all stores with external_id
    const { data: stores } = await supabase.from('stores').select('name, external_id');

    if (!stores || stores.length === 0) {
        console.error('No stores found in DB to sync jobs from.');
        return;
    }

    // Use a Set to track synced stores? Or just sync from one? 
    // Toast jobs are often shared, but let's sync from the first valid store GUID found.
    // Better yet, let's try one store. If specific jobs are missing, maybe they are store-specific?
    // Let's try syncing from the store that had the issue: "e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8" (Azusa) 
    // or verify all.

    // For simplicity, let's sync from ALL stores to ensure we catch all unique jobs.

    const uniqueJobGuids = new Set();
    let totalSynced = 0;

    for (const store of stores) {
        if (!store.external_id) continue;
        console.log(`Syncing jobs for store: ${store.name} (${store.external_id})...`);
        const result = await syncToastJobs(store.external_id);
        console.log(`  > Result:`, result);
        if (result.success) totalSynced += result.count;
    }

    console.log(`Job Sync Complete. Total jobs processed/upserted: ${totalSynced}`);
}

main().catch(console.error);
