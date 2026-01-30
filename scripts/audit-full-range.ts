
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';
import { format, addDays, parseISO } from 'date-fns';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function runFullAudit() {
    const startDate = parseISO('2025-01-01');
    const endDate = parseISO('2026-01-29'); // Updated to Jan 29

    console.log(`\n🌎 AUDITORÍA DETALLADA DÍA A DÍA (Ene 2025 - Ene 29 2026)\n`);
    console.log('| Fecha | Día | Real | Forecast | Error % | Calif. |');
    console.log('|---|---|---|---|---|---|');

    let currentDate = startDate;

    while (currentDate <= endDate) {
        // FULL SPEED AHEAD 🚀
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dayOfWeek = format(currentDate, 'EEE');

        try {
            // Generate Forecast
            const forecast = await generateSmartForecast(STORE_ID, dateStr);
            const predicted = forecast.total_sales;

            // Get Real Data 
            const { data: real } = await supabase
                .from('sales_daily_cache')
                .select('net_sales')
                .eq('store_id', STORE_ID)
                .eq('business_date', dateStr)
                .maybeSingle();

            if (real && real.net_sales > 0) {
                const actual = real.net_sales;
                const dailyError = (Math.abs(predicted - actual) / actual) * 100;

                let icon = '🟢';
                if (dailyError < 5) icon = '🏆';
                else if (dailyError > 10) icon = '�';
                else if (dailyError > 20) icon = '🔴';

                console.log(`| ${dateStr} | ${dayOfWeek} | $${actual.toFixed(0)} | $${predicted.toFixed(0)} | ${dailyError.toFixed(1)}% | ${icon} |`);
            }
        } catch (e) {
            // ignore
        }

        currentDate = addDays(currentDate, 1);
    }
}

runFullAudit();
