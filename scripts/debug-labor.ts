
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Missing Supabase URL or Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLaborData() {
    console.log('Checking labor for LA Central on Feb 18, 2026...');

    try {
        // 1. Get Store ID
        const { data: store, error: storeError } = await supabase
            .from('stores')
            .select('id, name, external_id') // external_id is toast guid
            .ilike('name', '%Central%') // LA Central
            .maybeSingle();

        if (storeError) throw storeError;
        if (!store) {
            console.log('Store "LA Central" not found.');
            return;
        }

        console.log(`Store Found: ${store.name} (ID: ${store.id}, GUI: ${store.external_id})`);

        // 2. Get Sales Cache Labor Stats
        const { data: salesCache } = await supabase
            .from('sales_daily_cache')
            .select('labor_hours, labor_cost, updated_at')
            .eq('store_id', store.external_id)
            .eq('business_date', '2026-02-18')
            .maybeSingle();

        console.log('\n--- Sales Cache (Old Logic) ---');
        if (salesCache) {
            console.log(`Hours: ${salesCache.labor_hours}`);
            console.log(`Cost: ${salesCache.labor_cost}`);
            console.log(`Updated At: ${salesCache.updated_at}`);
        } else {
            console.log('No sales cache found for this date.');
        }

        // 3. Get Punches (New Logic)
        const { data: punches } = await supabase
            .from('punches')
            .select('regular_hours, overtime_hours, clock_in, clock_out, employee_toast_guid')
            .eq('store_id', store.external_id)
            .eq('business_date', '2026-02-18');

        console.log('\n--- Punches (New Logic) ---');
        if (punches && punches.length > 0) {
            let totalHours = 0;
            let punchCount = 0;

            punches.forEach((p: any) => {
                let h = 0;
                if (p.regular_hours || p.overtime_hours) {
                    h = (Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0);
                } else if (p.clock_in && p.clock_out) {
                    const start = new Date(p.clock_in).getTime();
                    const end = new Date(p.clock_out).getTime();
                    h = (end - start) / (1000 * 60 * 60);
                }
                totalHours += h;
                punchCount++;
            });
            console.log(`Total Punches Found: ${punchCount}`);
            console.log(`Calculated Total Hours from Punches: ${totalHours.toFixed(2)}`);
        } else {
            console.log('No punches found for Feb 18.');
        }

    } catch (err: any) {
        console.error('Error:', err.message);
    }
}

checkLaborData();
