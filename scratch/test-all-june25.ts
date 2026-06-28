import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getProductMix } from '../lib/toast-pmix';
import { getSupabaseAdminClient } from '../lib/supabase';
import { calculateRecipeCost } from '../lib/inventory/costs';
import { Recipe } from '../types/inventory';

async function run() {
    const startDate = '2026-06-25';
    const endDate = '2026-06-25';

    const supabase = await getSupabaseAdminClient();
    const { data: storesData } = await supabase
        .from('stores')
        .select('name, external_id')
        .eq('is_active', true);

    const validStores = storesData?.filter(s => s.external_id) || [];
    console.log(`Valid stores: ${validStores.length}`);

    const results: any[] = [];
    for (const s of validStores) {
        console.log(`Fetching PMIX for store ${s.name} (${s.external_id})...`);
        const items = await getProductMix({ storeId: s.external_id, startDate, endDate, bundleModifiers: true });
        console.log(`  Got ${items.length} items`);
        results.push(...items.map(item => ({
            ...item,
            store_id: s.external_id,
            store_name: s.name || 'Unknown'
        })));
    }

    // Aggregate
    const aggMap = new Map<string, any>();
    results.forEach(item => {
        const key = `${item.store_name}_${item.guid}_${item.group_name || 'Uncategorized'}_${item.name}`;
        if (!aggMap.has(key)) {
            aggMap.set(key, { ...item });
        } else {
            const existing = aggMap.get(key);
            existing.quantity += item.quantity;
            existing.net_sales += item.net_sales;
        }
    });

    const pmixItems = Array.from(aggMap.values());
    console.log(`Total pmixItems after aggregation: ${pmixItems.length}`);

    // Print store counts in pmixItems
    const storeCounts: Record<string, number> = {};
    pmixItems.forEach(item => {
        storeCounts[item.store_name] = (storeCounts[item.store_name] || 0) + 1;
    });
    console.log('Store counts in aggregated pmixItems:', storeCounts);
}

run().catch(console.error);
