
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function auditNovemberIntegrity() {
    const startDate = '2025-11-01';
    const endDate = '2025-11-30';

    console.log(`\n🕵️ AUDITORÍA DE INTEGRIDAD DE DATOS (Noviembre 2025)...\n`);

    // Fetch Sales
    const { data: sales } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('business_date');

    if (!sales) return;

    console.log('| Fecha | Venta | Tickets | Labor (Cache) | Estado |');
    console.log('|---|---|---|---|---|');

    let issues = 0;

    for (const day of sales) {
        let status = '✅';
        let note = '';

        // Check Integrity
        if (!day.net_sales || day.net_sales === 0) {
            status = '❌ VENTA CERO';
            if (day.business_date === '2025-11-27') status = '🦃 Thanksgiving (Reparado?)';
        }

        if (!day.order_count && day.net_sales > 0) {
            status = '⚠️ SIN TICKETS';
        }

        if (!day.labor_hours || day.labor_hours === 0) {
            // Check if it was closed
            if (day.net_sales > 1000) {
                status = '⚠️ SIN LABOR';
            }
        }

        if (status !== '✅') issues++;
        if (day.business_date === '2025-11-27') note = ' (Thanksgiving)';

        console.log(`| ${day.business_date} | $${Number(day.net_sales).toFixed(0)} | ${day.order_count || 'NULL'} | ${Number(day.labor_hours || 0).toFixed(1)} hrs | ${status}${note} |`);
    }

    console.log(`\n🏁 Total Problemas Detectados: ${issues}`);
}

auditNovemberIntegrity();
