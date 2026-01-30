
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';
import { format, addDays, parseISO } from 'date-fns';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function runComparison() {
    const startDate = parseISO('2025-09-01');
    const endDate = parseISO('2026-01-28');

    console.log(`\n🚀 COMPARATIVA FINAL: V1 (Global) vs V2 (Segmentado) [${format(startDate, 'yyyy-MM-dd')} - ${format(endDate, 'yyyy-MM-dd')}]\n`);
    console.log('| Fecha | Día | Real | V1 (Global) | Error V1 | V2 (Segmentado) | Error V2 | Diferencia | Ganador |');
    console.log('|---|---|---|---|---|---|---|---|---|');

    let currentDate = startDate;

    let winsV1 = 0;
    let winsV2 = 0;
    let totalErrorV1 = 0;
    let totalErrorV2 = 0;
    let count = 0;

    while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dayOfWeek = format(currentDate, 'EEE');

        try {
            // 1. Forecast (Dual Engine)
            let forecast;
            try {
                forecast = await generateSmartForecast(STORE_ID, dateStr);
            } catch (err) {
                // Ignore missing history days
                currentDate = addDays(currentDate, 1);
                continue;
            }

            // Extract hidden V1
            // @ts-ignore
            const v1Sales = forecast.debug_v1_sales || 0;
            const v2Sales = forecast.total_sales || 0;

            if (v1Sales === 0 || v2Sales === 0) {
                currentDate = addDays(currentDate, 1);
                continue;
            }

            // 2. Real Data
            const { data: real } = await supabase
                .from('sales_daily_cache')
                .select('net_sales')
                .eq('store_id', STORE_ID)
                .eq('business_date', dateStr)
                .maybeSingle();

            if (real && real.net_sales > 0) {
                const actual = real.net_sales;

                const errorV1 = Math.abs(v1Sales - actual);
                const pctV1 = (errorV1 / actual) * 100;

                const errorV2 = Math.abs(v2Sales - actual);
                const pctV2 = (errorV2 / actual) * 100;

                totalErrorV1 += pctV1;
                totalErrorV2 += pctV2;
                count++;

                let winner = '';
                if (pctV2 < pctV1) {
                    winner = '🏆 V2';
                    winsV2++;
                } else {
                    winner = 'V1';
                    winsV1++;
                }

                // Highlight big wins
                if (Math.abs(pctV1 - pctV2) > 5 && pctV2 < pctV1) winner = '🔥 V2!'; // Big win for V2

                // Calculate Diff (Interpretation: Did V2 save money vs V1?)
                const diff = v2Sales - v1Sales; // Negative means V2 is lower (Saving money if V1 was over)
                const diffStr = diff > 0 ? `+$${diff.toFixed(0)}` : `-$${Math.abs(diff).toFixed(0)}`;

                console.log(`| ${dateStr} | ${dayOfWeek} | $${actual.toFixed(0)} | $${v1Sales.toFixed(0)} | ${pctV1.toFixed(1)}% | $${v2Sales.toFixed(0)} | ${pctV2.toFixed(1)}% | ${diffStr} | ${winner} |`);
            }

        } catch (e) {
            console.error(`Error ${dateStr}:`, e);
        }

        currentDate = addDays(currentDate, 1);
    }

    if (count > 0) {
        console.log(`\n🏁 RESUMEN FINAL:`);
        console.log(`- Días Evaluados: ${count}`);
        console.log(`- V1 (Global) Error Promedio: ${(totalErrorV1 / count).toFixed(2)}%`);
        console.log(`- V2 (Segmentado) Error Promedio: ${(totalErrorV2 / count).toFixed(2)}%`);
        console.log(`- Victorias: V1 (${winsV1}) vs V2 (${winsV2})`);

        const improvement = ((totalErrorV1 - totalErrorV2) / totalErrorV1) * 100;
        console.log(`- Mejora General: ${improvement.toFixed(1)}% más preciso.`);
    }
}

runComparison().catch(console.error);
