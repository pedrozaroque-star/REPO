
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';
import { format, addDays, parseISO } from 'date-fns';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const STORES = {
    'acf15327-54c8-4da4-8d0d-3ac0544dc422': 'Rialto',
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': 'Azusa',
    '42ed15a6-106b-466a-9076-1e8f72451f6b': 'Norwalk',
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a': 'Downey',
    '475bc112-187d-4b9c-884d-1f6a041698ce': 'LA Broadway',
    'a83901db-2431-4283-834e-9502a2ba4b3b': 'Bell',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b': 'Hollywood',
    '47256ade-2cd4-4073-9632-84567ad9e2c8': 'Huntington Park',
    '8685e942-3f07-403a-afb6-faec697cd2cb': 'LA Central',
    '3a803939-eb13-4def-a1a4-462df8e90623': 'La Puente',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6': 'Lynwood',
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': 'Santa Ana',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd': 'Slauson',
    '95866cfc-eeb8-4af9-9586-f78931e1ea04': 'South Gate',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': 'West Covina'
};

async function auditStore(storeId: string, storeName: string) {
    const startDate = parseISO('2025-01-01');
    const endDate = parseISO('2026-01-29');

    console.log(`\n🏢 Auditando: ${storeName}...`);
    console.log('| Fecha | Día | Real | Forecast | Error % | Icon |');
    console.log('|---|---|---|---|---|---|');

    let currentDate = startDate;
    let totalReal = 0;
    let totalForecast = 0;
    let absErrorSum = 0;
    let daysCount = 0;

    while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dayOfWeek = format(currentDate, 'EEE');

        try {
            const forecast = await generateSmartForecast(storeId, dateStr);
            const predicted = forecast.total_sales;

            const { data: real } = await supabase
                .from('sales_daily_cache')
                .select('net_sales')
                .eq('store_id', storeId)
                .eq('business_date', dateStr)
                .maybeSingle();

            if (real && real.net_sales > 0) {
                const actual = real.net_sales;
                const error = Math.abs(predicted - actual);
                const errorPct = (error / actual) * 100;

                totalReal += actual;
                totalForecast += predicted;
                absErrorSum += errorPct;
                daysCount++;

                let icon = '🟢';
                if (errorPct < 5) icon = '🏆';
                else if (errorPct > 10) icon = '🟡';
                else if (errorPct > 20) icon = '🔴';

                console.log(`| ${dateStr} | ${dayOfWeek} | $${actual.toFixed(0)} | $${predicted.toFixed(0)} | ${errorPct.toFixed(1)}% | ${icon} |`);
            }
        } catch (e) {
            // ignore
        }
        currentDate = addDays(currentDate, 1);
    }

    if (daysCount > 0) {
        const mape = absErrorSum / daysCount;
        const totalDiffPct = ((totalForecast - totalReal) / totalReal) * 100;

        let icon = '🟢';
        if (mape < 5) icon = '🏆';
        else if (mape > 10) icon = '🟡';
        else if (mape > 20) icon = '🔴';

        console.log(`\n📊 Resumen ${storeName}: MAPE ${mape.toFixed(1)}% | Error Global ${totalDiffPct > 0 ? '+' : ''}${totalDiffPct.toFixed(1)}% | ${icon}`);
    } else {
        console.log(`⚠️ ${storeName}: Sin datos suficientes.`);
    }
}

async function runAllStores() {
    console.log(`\n🌎 EJECUTANDO AUDITORÍA GLOBAL DETALLADA (15 TIENDAS) - Ene 2025 a Ene 2026\n`);

    for (const [id, name] of Object.entries(STORES)) {
        await auditStore(id, name);
    }

    console.log(`\n🏁 Auditoría Global Finalizada.`);
}

runAllStores();
