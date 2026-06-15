import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSlausonWeeklyShifts() {
    const slausonStoreExternalId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd';
    
    console.log('Querying shifts for Slauson from 2026-06-08 to 2026-06-14...');
    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', slausonStoreExternalId)
        .gte('shift_date', '2026-06-08')
        .lte('shift_date', '2026-06-14');
        
    if (error) {
        console.error('Error:', error.message);
        return;
    }
    
    console.log(`Found ${shifts?.length} shifts for Slauson this week.`);
    
    const counts: Record<string, number> = {};
    shifts?.forEach(s => {
        counts[s.shift_date] = (counts[s.shift_date] || 0) + 1;
    });
    
    const sortedDates = Object.keys(counts).sort();
    sortedDates.forEach(d => {
        console.log(`- Date ${d}: ${counts[d]} shifts`);
    });
}

checkSlausonWeeklyShifts();
