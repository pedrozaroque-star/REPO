
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function checkChristmas() {
    const dates = ['2023-12-24', '2024-12-24', '2025-12-24'];

    console.log('\n🎄 HISTORIAL DE NOCHEBUENA (Lynwood)\n');

    for (const date of dates) {
        const { data } = await supabase
            .from('sales_daily_cache')
            .select('net_sales')
            .eq('store_id', STORE_ID)
            .eq('business_date', date)
            .maybeSingle();

        const sales = data?.net_sales || 0;
        console.log(`- ${date}: $${sales.toFixed(2)}`);
    }
}

checkChristmas();
