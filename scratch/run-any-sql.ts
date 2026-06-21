import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase
        .from('food_cost_daily_cache')
        .delete()
        .gte('business_date', '2026-06-02');
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Successfully deleted June cache entries:', data);
    }
}
run()
