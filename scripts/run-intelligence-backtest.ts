
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';
import { format, addDays, parseISO } from 'date-fns';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function runBacktest() {
    // Rango definido por ti: 01 Sept 2025 al 28 Enero 2026
    const startDate = parseISO('2025-09-01');
    const endDate = parseISO('2026-01-28');

    console.log(`🚀 INICIANDO BACKTEST INTELLIGENCE (${format(startDate, 'yyyy-MM-dd')} a ${format(endDate, 'yyyy-MM-dd')})\n`);
    console.log('| Fecha | Día | Pronóstico IA | Venta Real | Error % | Accuracy |');
    console.log('|---|---|---|---|---|---|');

    let currentDate = startDate;
    let totalError = 0;
    let daysCount = 0;
    let wins = 0; // Days with < 5% error

    while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dayOfWeek = format(currentDate, 'EEE');

        try {
            // 1. Generar Pronóstico IA
            // Si intelligence.ts retorna null, evitar crash
            let forecast;
            try {
                forecast = await generateSmartForecast(STORE_ID, dateStr);
            } catch (err) {
                // Si falla el forecast (ej. falta historial del año anterior completo), lo saltamos
                // console.log(`| ${dateStr} | ${dayOfWeek} | - | - | - | ❌ Forecast Error |`);
                currentDate = addDays(currentDate, 1);
                continue;
            }

            const predictedSales = forecast?.total_sales || 0;

            if (predictedSales === 0) {
                // Posiblemente holiday cerrado o falta de datos
                currentDate = addDays(currentDate, 1);
                continue;
            }

            // 2. Obtener Realidad (Daily Sales Cache)
            const { data: real } = await supabase
                .from('sales_daily_cache')
                .select('net_sales')
                .eq('store_id', STORE_ID)
                .eq('business_date', dateStr)
                .maybeSingle();

            if (real && real.net_sales > 0) {
                const actualSales = real.net_sales;
                const error = Math.abs(predictedSales - actualSales);
                const errorPct = (error / actualSales) * 100;

                totalError += errorPct;
                daysCount++;
                if (errorPct < 5) wins++;

                let icon = '🟢';
                if (errorPct > 10) icon = '🟡';
                if (errorPct > 20) icon = '🔴';
                if (errorPct < 5) icon = '🏆'; // Accuracy estelar

                console.log(`| ${dateStr} | ${dayOfWeek} | $${predictedSales.toFixed(0)} | $${actualSales.toFixed(0)} | ${errorPct.toFixed(1)}% | ${icon} |`);
            } else {
                console.log(`| ${dateStr} | ${dayOfWeek} | $${predictedSales.toFixed(0)} | - | - | ⚪ No Data |`);
            }

        } catch (e) {
            console.error(`Error procesando ${dateStr}:`, e);
        }

        currentDate = addDays(currentDate, 1);
    }

    if (daysCount > 0) {
        const avgError = totalError / daysCount;
        const accuracy = ((wins / daysCount) * 100).toFixed(1);

        console.log(`\n🏁 RESULTADOS FINALES:`);
        console.log(`- Días Analizados: ${daysCount}`);
        console.log(`- Error Promedio Global: ${avgError.toFixed(2)}%`);
        console.log(`- Precisión Sniper (<5% error): ${accuracy}% de los días`);
    } else {
        console.log("\n⚠️ No se encontraron días con datos suficientes para comparar.");
    }
}

runBacktest().catch(console.error);
