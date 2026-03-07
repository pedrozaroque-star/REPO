import { getSupabaseAdminClient } from '../lib/supabase';
import fs from 'fs';

async function run() {
    const supabase = await getSupabaseAdminClient();

    // Fetch all 2026 sales
    const { data: sales, error } = await supabase
        .from('sales_daily_cache')
        .select('store_id, business_date, net_sales')
        .gte('business_date', '2025-01-01') // Todo el ano pasado y este
        .order('store_id')
        .order('business_date');

    if (error) {
        console.error(error);
        return;
    }

    const storesMap = new Map<string, any[]>();
    sales?.forEach(s => {
        if (!storesMap.has(s.store_id)) storesMap.set(s.store_id, []);
        storesMap.get(s.store_id)!.push(s);
    });

    const storeNames = await supabase.from('stores').select('external_id, name');
    const nameMap = new Map<string, string>();
    storeNames.data?.forEach(s => nameMap.set(s.external_id, s.name));

    let report = "ANOMALÍAS DETECTADAS EN LA BASE DE DATOS LOCAL\n";
    report += "Basado en caídas del 50% respecto al mes anterior o respecto al día de la semana.\n\n";

    let warnings = 0;

    storesMap.forEach((storeSales, storeId) => {
        const name = nameMap.get(storeId) || storeId;
        const suspects: string[] = [];

        for (let i = 1; i < storeSales.length; i++) {
            const today = storeSales[i];
            const yesterday = storeSales[i - 1];

            // Check for massive drop day-over-day
            if (today.net_sales < (yesterday.net_sales * 0.45) && today.net_sales > 0 && yesterday.net_sales > 1000) {
                // Ignore Christmas, Thanksgiving, etc.
                const dt = today.business_date;
                if (!dt.includes('-12-25') && !dt.includes('-11-27') && !dt.includes('-01-01')) {
                    suspects.push(`- Posible Terminal Offline: ${today.business_date} (${today.net_sales} vs previo ${yesterday.net_sales})`);
                    warnings++;
                }
            }

            // Check for 0 net sales mid-week
            if (today.net_sales === 0 || today.net_sales === null) {
                suspects.push(`- 🔴 DÍA HUÉRFANO (Zero Sales): ${today.business_date}`);
                warnings++;
            }
        }

        if (suspects.length > 0) {
            report += `\n[ ${name} ]\n`;
            suspects.forEach(s => report += s + "\n");
        }
    });

    fs.writeFileSync('docs/anomalias_detectadas.md', report, 'utf-8');
    console.log(`Búsqueda heurística terminada. ${warnings} anomalías encontradas.`);
}
run();
