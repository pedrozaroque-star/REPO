import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: rows, error } = await supabase
        .from('pmix_daily_cache')
        .select('business_date, store_id, updated_at, items')
        .gte('updated_at', '2026-06-22T19:45:00.000Z')
        .lte('updated_at', '2026-06-22T19:48:00.000Z');

    if (error) {
        console.error('Error:', error);
        return;
    }

    const { data: stores } = await supabase.from('stores').select('id, name');
    const storeMap = new Map(stores?.map(s => [s.id, s.name]) || []);

    console.log(`=== PMIX DAILY CACHE ROWS UPDATED AROUND 2026-06-22T19:46:00 (Total: ${rows?.length}) ===`);
    for (const r of rows || []) {
        const storeName = storeMap.get(r.store_id) || r.store_id;
        const itemsArray = Array.isArray(r.items) ? r.items : [];
        console.log(`  Date: ${r.business_date} | Store: ${storeName.padEnd(25)} | Items: ${itemsArray.length} | Updated At: ${r.updated_at}`);
        if (itemsArray.length > 0) {
            console.log('  Items Sample:', itemsArray.slice(0, 3).map((i: any) => ({ name: i.name, qty: i.quantity })));
        }
    }
}
run();
