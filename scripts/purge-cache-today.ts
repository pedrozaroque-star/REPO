
import { getSupabaseClient } from '../lib/supabase';

async function purgeCache() {
    const supabase = await getSupabaseClient();

    // Business Logic: If < 6 AM, purge Yesterday too
    const now = new Date();
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

    const datesToPurge: string[] = [];

    // Today
    const todayStr = `${laTime.getFullYear()}-${String(laTime.getMonth() + 1).padStart(2, '0')}-${String(laTime.getDate()).padStart(2, '0')}`;
    datesToPurge.push(todayStr);

    // Yesterday (if early morning)
    if (laTime.getHours() < 6) {
        const y = new Date(laTime);
        y.setDate(y.getDate() - 1);
        const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
        datesToPurge.push(yStr);
    }

    console.log('--- PURGING CACHE FOR DATES:', datesToPurge, '---');

    for (const date of datesToPurge) {
        const { error, count } = await supabase
            .from('sales_daily_cache')
            .delete({ count: 'exact' })
            .eq('business_date', date);

        if (error) console.error(`Error purging ${date}:`, error.message);
        else console.log(`Deleted ${count} corrupted cache entries for ${date}`);
    }

    console.log('--- DONE. PLEASE REFRESH IN APP ---');
}

purgeCache();
