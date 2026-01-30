
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function showHourlyLoad() {
    const { data } = await supabase
        .from('sales_daily_cache')
        .select('hourly_data')
        .eq('store_id', '80a1ec95-bc73-402e-8884-e5abbe9343e6')
        .eq('business_date', '2026-01-10')
        .single();

    if (!data) return;

    console.log('--- CARGA DE TRABAJO (10 ENE) ---');
    const hours = data.hourly_data;
    // Mostrar solo la tarde
    for (let h = 16; h <= 21; h++) {
        const sales = hours[h] || 0;
        const cooksNeeded = Math.round(sales / 211);
        console.log(`Hora ${h}:00 | Venta: $${sales} | Cocineros Necesarios: ${cooksNeeded}`);
    }
}

showHourlyLoad();
