
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';
import { format, addDays, parseISO } from 'date-fns';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function diagnoseOctober17() {
    const startDate = parseISO('2025-10-16');
    const endDate = parseISO('2025-10-18');

    console.log(`\n🔍 DIAGNÓSTICO PROFUNDO (16-18 Oct 2025)...\n`);
    console.log('| Fecha | Día | Real | Forecast | Error % |');
    console.log('|---|---|---|---|---|');

    let currentDate = startDate;

    while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dayOfWeek = format(currentDate, 'EEE');

        const forecast = await generateSmartForecast(STORE_ID, dateStr);
        const predictedSales = forecast.total_sales;

        // Get Real
        const { data: real } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('store_id', STORE_ID)
            .eq('business_date', dateStr)
            .maybeSingle();

        if (real) {
            const actual = real.net_sales;
            const errorPct = (Math.abs(predictedSales - actual) / actual) * 100;
            console.log(`| ${dateStr} | ${dayOfWeek} | $${actual.toFixed(0)} | $${predictedSales.toFixed(0)} | ${errorPct.toFixed(1)}% |`);

            if (dateStr === '2025-10-17') {
                console.log("\n--- ANÁLISIS 17 OCT ---");
                // 1. Check History (Last Year)
                console.log("¿Con qué se comparó?");
                console.log("Growth Factor Aplicado:", forecast.growth_factor_applied);
                console.log("Weather Adjustment:", forecast.weather_adjustment);
            }
        }
        currentDate = addDays(currentDate, 1);
    }
}

diagnoseOctober17();
