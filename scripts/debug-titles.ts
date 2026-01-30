
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkPunches() {
    console.log('Consultando punches...');
    const { data, error } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', '80a1ec95-bc73-402e-8884-e5abbe9343e6')
        .eq('business_date', '2026-01-28');

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No data found via select *');
    } else {
        console.log(`Found ${data.length} records!`);
        console.log(JSON.stringify(data[0], null, 2));
    }
}

checkPunches();
