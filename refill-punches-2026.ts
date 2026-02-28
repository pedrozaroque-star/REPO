import dotenv from 'dotenv';
import { getSupabaseClient } from './lib/supabase';
import { syncToastPunches } from './lib/toast-labor';

dotenv.config({ path: '.env.local' });

async function run() {
    const supabase = await getSupabaseClient();
    const { data: stores, error } = await supabase.from('stores').select('*').not('external_id', 'is', null);

    if (error || !stores) {
        console.error('Error fetching stores:', error);
        return;
    }

    const startDate = '2026-01-01T00:00:00.000+0000';
    // Use an end date that spans up to the end of March to be safe, or just "now"
    const finalEnd = new Date();

    console.log(`Starting 2026 sync for ${stores.length} stores from ${startDate}...`);

    for (const store of stores) {
        if (!store.external_id) continue;
        console.log(`\n\n--- Syncing Refill for: ${store.name} ---`);

        try {
            let currentStart = new Date('2026-01-01T00:00:00Z');

            while (currentStart <= finalEnd) {
                let chunkEnd = new Date(currentStart);
                chunkEnd.setDate(chunkEnd.getDate() + 14); // 14 day chunks

                if (chunkEnd > finalEnd) chunkEnd = finalEnd;

                const chunkStartIso = currentStart.toISOString().split('T')[0] + 'T00:00:00.000+0000';
                const chunkEndIso = chunkEnd.toISOString().split('T')[0] + 'T23:59:59.999+0000';

                console.log(`  Chunk: ${chunkStartIso}  ➔  ${chunkEndIso}`);
                const result = await syncToastPunches(store.external_id, chunkStartIso, chunkEndIso);
                console.log(`  Result: ${JSON.stringify(result)}`);

                // Move to next chunk
                currentStart = new Date(chunkEnd.getTime() + 86400000); // Add 1 day
            }
        } catch (e: any) {
            console.error(`Error syncing ${store.name}:`, e.message);
        }
    }

    console.log('✅ REFILL COMPLETE');
}

run();
