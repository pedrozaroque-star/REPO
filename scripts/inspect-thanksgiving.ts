
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function checkThanksgiving() {
    const date = '2025-11-27';

    console.log(`\n🦃 INSPECCIONANDO THANKSGIVING (${date})...\n`);

    // 1. Check Sales Cache
    const { data: sales } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .eq('business_date', date)
        .maybeSingle();

    if (sales) {
        console.log(`✅ SALES CACHE ENCONTRADO:`);
        console.log(`- Ventas Netas: $${sales.net_sales}`);
        console.log(`- Tickets: ${sales.total_tickets}`);
        console.log(`- Última Actualización: ${sales.last_updated}`);
    } else {
        console.log(`❌ NO HAY SALES CACHE para esta fecha.`);
    }

    // 2. Check Punches (Labor)
    const { count } = await supabase
        .from('punches')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', STORE_ID)
        .eq('business_date', date);

    console.log(`- Registros de Personal (Punches): ${count || 0}`);
}

checkThanksgiving();
