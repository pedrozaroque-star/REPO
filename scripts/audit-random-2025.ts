
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { format, eachMonthOfInterval, startOfYear, endOfYear, setDate } from 'date-fns';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function auditRandom2025() {
    console.log(`\n🎲 AUDITORÍA ALEATORIA INTEGRIDAD 2025 (Muestreo + Festivos)...\n`);

    // 1. Generate Target Dates
    const targetDates: string[] = [];
    const months = eachMonthOfInterval({
        start: startOfYear(new Date(2025, 0, 1)),
        end: endOfYear(new Date(2025, 0, 1))
    });

    // Random Picks
    months.forEach(m => {
        // Pick random day 1-28
        const d1 = Math.floor(Math.random() * 28) + 1;
        const d2 = Math.floor(Math.random() * 28) + 1;
        targetDates.push(format(setDate(m, d1), 'yyyy-MM-dd'));
        targetDates.push(format(setDate(m, d2), 'yyyy-MM-dd'));
    });

    // Critical Holidays
    targetDates.push('2025-01-01'); // New Year
    targetDates.push('2025-05-05'); // 5 Mayo
    targetDates.push('2025-07-04'); // Independence
    targetDates.push('2025-12-25'); // Xmas (Closed?)
    targetDates.push('2025-12-31'); // NYE

    // Sort
    targetDates.sort();
    const uniqueDates = [...new Set(targetDates)];

    // Fetch All
    const { data: sales } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .in('business_date', uniqueDates)
        .order('business_date');

    if (!sales) return;

    console.log('| Fecha | Venta | Tickets | Labor | Estado |');
    console.log('|---|---|---|---|---|');

    let issues = 0;
    const salesMap = new Map(sales.map(s => [s.business_date, s]));

    for (const date of uniqueDates) {
        const day = salesMap.get(date);
        let status = '✅';

        if (!day) {
            console.log(`| ${date} | MISSING | NULL | NULL | ❌ NO EXISTE REGISTRO |`);
            issues++;
            continue;
        }

        // Integrity Checks
        if (day.net_sales === 0) {
            // Check known closed days
            if (date === '2025-12-25') status = '🎄 CERRADO (OK)';
            else status = '❌ VENTA CERO';
        }

        if (!day.order_count && day.net_sales > 100) status = '⚠️ SIN TICKETS';
        if ((!day.labor_hours || day.labor_hours === 0) && day.net_sales > 1000) status = '⚠️ SIN LABOR';

        if (status.includes('❌') || status.includes('⚠️')) issues++;

        console.log(`| ${date} | $${Number(day.net_sales).toFixed(0)} | ${day.order_count || 'NULL'} | ${Number(day.labor_hours || 0).toFixed(1)} hrs | ${status} |`);
    }

    console.log(`\n🏁 Muestreo Finalizado. Problemas: ${issues}/${uniqueDates.length}`);
}

auditRandom2025();
