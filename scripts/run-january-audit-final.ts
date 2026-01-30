
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';
import { format, addDays, parseISO } from 'date-fns';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function runJanuaryAudit() {
    const startDate = parseISO('2026-01-01');
    const endDate = parseISO('2026-01-26');

    console.log(`\n❄️ AUDITORÍA FINAL ENERO 2026 (Fixes Aplicados)...\n`);
    console.log('| Fecha | Día | Real | Forecast V2.1 | Error % | Status |');
    console.log('|---|---|---|---|---|---|');

    let currentDate = startDate;
    let totalError = 0;
    let days = 0;

    while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dayOfWeek = format(currentDate, 'EEE');

        try {
            const forecast = await generateSmartForecast(STORE_ID, dateStr);
            const predictedSales = forecast.total_sales;

            const { data: real } = await supabase
                .from('sales_daily_cache')
                .select('net_sales')
                .eq('store_id', STORE_ID)
                .eq('business_date', dateStr)
                .maybeSingle();

            if (real && real.net_sales > 0) {
                const actual = real.net_sales;
                const errorPct = (Math.abs(predictedSales - actual) / actual) * 100;

                let icon = '🟢';
                if (errorPct > 10) icon = '🟡';
                if (errorPct > 20) icon = '🔴';
                if (errorPct < 5) icon = '🏆';

                // Highlight problematic Wednesdays/Mondays
                const isProblemDay = (dayOfWeek === 'Wed' || dayOfWeek === 'Mon');
                // if (isProblemDay) icon += ' 🧐';

                console.log(`| ${dateStr} | ${dayOfWeek} | $${actual.toFixed(0)} | $${predictedSales.toFixed(0)} | ${errorPct.toFixed(1)}% | ${icon} |`);

                totalError += errorPct;
                days++;
            }
        } catch (e) {
            // console.error(e);
        }
        currentDate = addDays(currentDate, 1);
    }

    if (days > 0) {
        console.log(`\n🏁 Error Promedio Final: ${(totalError / days).toFixed(2)}%`);
    }
}

runJanuaryAudit();
