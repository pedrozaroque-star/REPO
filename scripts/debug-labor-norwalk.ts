
const { getSupabaseClient } = require('../lib/supabase');

async function monitorLabor() {
    const supabase = await getSupabaseClient();

    // Norwalk ID
    const STORE_ID = '42ed15a6-106b-466a-9076-1e8f72451f6b';
    const DATE = '2026-02-16';

    console.log(`🔍 Auditing Labor for Norwalk on ${DATE}...`);

    // 1. Fetch sales_daily_cache summary
    const { data: summary, error: summaryError } = await supabase
        .from('sales_daily_cache')
        .select('labor_hours, labor_cost')
        .eq('store_id', STORE_ID)
        .eq('business_date', DATE)
        .single();

    if (summaryError) console.error('Error fetching summary:', summaryError);
    if (!summary) {
        console.log('❌ No summary found in sales_daily_cache');
    } else {
        console.log('📊 [CACHE TABLE] Summary:', summary);
    }

    // 2. Fetch raw time entries (punches or employees table?)
    // In this system, granular punches might be in 'toast_time_entries' or similar if they exist, 
    // BUT usually we sync to `employees` table (shifts). Let's check `shifts` or `schedule_shifts`?
    // Wait, the user mentioned "employees sum". This likely refers to the "employees" shifts in the planner or the synced data.
    // The previous context mentions `toast-labor.ts` syncing to... where?
    // The knowledge item says "Data is synced to Supabase".
    // Let's check `raw_time_entries` table if it exists, or look into `employee_shifts`.

    // Let's list tables first to be sure where to look for raw punches.
    // Assuming typical schema: `time_entries` or `shifts`.

    // Actually, let's look at `toast_sync_log` to see what happened.
    const { data: logs } = await supabase
        .from('system_logs')
        .select('*')
        .eq('type', 'CRON_LABOR')
        .order('created_at', { ascending: false })
        .limit(5);

    console.log('📜 Recent Sync Logs:', logs?.map((l: any) => l.message));

    // 3. Let's try to sum up individual employee shifts if we have them in `time_entries`
    const { data: entries, error: entriesError } = await supabase
        .from('time_entries')
        .select('*')
        .eq('store_id', STORE_ID)
        .eq('business_date', DATE);

    if (entriesError || !entries) {
        console.log('⚠️ Could not fetch details from time_entries (Table might not exist or empty). checking other tables...');
        // Try `employee_shifts` ?
    } else {
        const totalHours = entries.reduce((acc: number, e: any) => acc + (Number(e.regular_hours) + Number(e.overtime_hours)), 0);
        console.log(`∑ [RAW ENTRIES] Sum of ${entries.length} punches: ${totalHours.toFixed(2)} hours`);

        // Find outliers (> 15 hours?)
        const outliers = entries.filter((e: any) => (Number(e.regular_hours) + Number(e.overtime_hours)) > 15);
        if (outliers.length > 0) {
            console.warn('🚨 FOUND OUTLIERS (Potential stuck clock-ins):');
            outliers.forEach((o: any) => console.log(`   - Employee ${o.employee_id}: ${Number(o.regular_hours) + Number(o.overtime_hours)} hrs`));
        }
    }

}

monitorLabor();
