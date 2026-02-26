import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: '.env.local' });
import { fetchToastData } from './lib/toast-api';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function repairTuesday() {
    const businessDate = '2026-02-24';

    // Explicitly delete the corrupt ones
    console.log(`🧹 Deleting corrupt cache for ${businessDate}`);
    const { error: delErr } = await supabase.from('sales_daily_cache')
        .delete()
        .eq('business_date', businessDate);

    if (delErr) {
        console.error('Delete Error:', delErr);
        return;
    }

    console.log(`✅ Deleted successfully. Refetching...`);

    // Fetch Toast Data (this will write back to cache inside the function)
    const storeMap = new Map();
    try {
        await fetchToastData(businessDate, storeMap);
        console.log(`✅ Fetch completed for ${businessDate}.`);
    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

repairTuesday();
