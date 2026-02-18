
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function auditAllStores() {
    console.log(`\n🔍 AUDITING LABOR FOR ALL STORES (Monday Lunes 16)\n`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) { return; }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get Active Store GUIDs from Punches on that Day (Guaranteed to be correct IDs)
    const { data: activeStores } = await supabase
        .from('punches')
        .select('store_id')
        .eq('business_date', '2026-02-16');

    if (!activeStores || activeStores.length === 0) {
        console.log("No punches found for any store on 2026-02-16.");
        return;
    }

    // Unique Store GUIDs
    const storeGuids = [...new Set(activeStores.map(s => s.store_id))];

    // Get Store Names for display
    const { data: storeDetails } = await supabase
        .from('stores')
        .select('name, id') // Trying to match by some foreign key? 
        // Actually, stores table might not have the GUID column exposed clearly or I don't know name.
        // Let's just use the GUID as name if we can't find it, or try to enable a lookup map if I have one.
        // I will try to fetch `toast_id` or `guid` from stores.
        .in('id', storeGuids); // This assumes stores.id IS the guid? No 12 != GUID.

    // Let's fetch all stores and try to match? 
    // Or better, let's just proceed with GUIDs and worry about names later or use a known map.
    // I know Norwalk is '42ed...'.

    // BETTER STRATEGY: Fetch all stores, check if they have a `toast_guid` column.
    // If not, I can't easily map Name -> ID without `toast_restaurants` table?
    // If stores table only has int IDs, we have a problem mapping punches (GUID) to Store Name.
    // But `sales_daily_cache` has `store_id` as GUID? No, check debug-labor-norwalk.
    // In debug-labor timestamp 1224: `STORE_ID = '42ed...'`. We queried `sales_daily_cache` with it.
    // So `sales_daily_cache` uses GUID. 
    // `stores` table returned internal IDs (1, 2, 3...) in step 1392.
    // So `stores` table is NOT what ties to punches directly.
    // There must be a `toast_restaurants` table or `stores` has a `toast_guid` column.

    const storeMap = {};
    // 42ed15a6 = Norwalk
    // 5fbb58f5 = ?
    // acf15327 = ?
    // b7f63b01 = ?

    // Try to get Name from `stores` table assuming `toast_guid` or `external_id` matches.
    // If not, I'll just print GUID.
    const { data: storeRef } = await supabase.from('stores').select('*');
    if (storeRef) {
        storeRef.forEach(s => {
            // Check all columns that look like GUIDs
            const possibleGuid = s.toast_guid || s.guid || s.external_id || s.toast_ref;
            if (possibleGuid) storeMap[possibleGuid] = s.name;
        });
    }

    console.log(`Scan Date: 2026-02-16`);
    console.log(`Found ${storeGuids.length} active stores with punches.`);

    // Pre-Fetch all employees to be faster? No, store by store is fine but lets debug.

    let totalLost = 0;

    console.log(`-----------------------------------------------------------------------------------------------------------------`);
    console.log(`| STORE               | EMPLOYEE               | HRS     | RATE ($0) | EST LOSS | ISSUE TYPE                  |`);
    console.log(`-----------------------------------------------------------------------------------------------------------------`);

    for (const guid of storeGuids) {
        const storeName = storeMap[guid] || guid.substring(0, 8) + '...';
        console.log(`Checking ${storeName}`);

        // Get Punches for Date
        const { data: punches, error: pErr } = await supabase
            .from('punches')
            .select('*')
            .eq('store_id', guid)
            .eq('business_date', '2026-02-16');

        if (pErr) console.error(`Error for ${storeName}:`, pErr);

        if (!punches || punches.length === 0) continue;

        // Get Guids
        const guids = [...new Set(punches.map(p => p.employee_toast_guid))];
        const { data: emps } = await supabase
            .from('toast_employees')
            .select('toast_guid, first_name, last_name, wage_data')
            .in('toast_guid', guids);

        const empMap = {};
        if (emps) emps.forEach(e => empMap[e.toast_guid] = e);

        punches.forEach(p => {
            const reg = Number(p.regular_hours) || 0;
            const ot = Number(p.overtime_hours) || 0;
            let rate = Number(p.hourly_wage) || 0;
            const totalHrs = reg + ot;

            // Only care if Rate is 0 AND Hours > 0
            if (totalHrs > 0.1 && rate < 0.1) {
                const emp = empMap[p.employee_toast_guid] || {};
                const name = `${emp.first_name || 'Unknown'} ${emp.last_name || ''}`;

                // Determine plausible wage
                let estimatedRate = 16.00;
                let wageSource = 'Default $16';
                if (emp.wage_data && Array.isArray(emp.wage_data) && emp.wage_data.length > 0 && emp.wage_data[0].wage) {
                    estimatedRate = Number(emp.wage_data[0].wage);
                    wageSource = `Profile ($${estimatedRate})`;
                }

                const lost = (reg * estimatedRate) + (ot * estimatedRate * 1.5);
                totalLost += lost;

                const reason = (wageSource === 'Default $16') ? 'NO WAGE PROFILE' : 'BAD JOB CODE';

                console.log(`| ${storeName.padEnd(19).slice(0, 19)} | ${name.padEnd(22).slice(0, 22)} | ${totalHrs.toFixed(2).padStart(7)} | $0.00     | $${lost.toFixed(0).padStart(6)} | ${reason.padEnd(27)} |`);
            }
        });
    }

    console.log(`-----------------------------------------------------------------------------------------------------------------`);
    console.log(`\n💰 TOTAL ESTIMATED MISSING LABOR COST: $${totalLost.toFixed(2)}`);
    console.log(`(This explains why your charts are lower than reality!)\n`);
}

auditAllStores();
