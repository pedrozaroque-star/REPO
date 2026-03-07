import { getSupabaseAdminClient } from '../lib/supabase';
import fs from 'fs';

async function run() {
    const supabase = await getSupabaseAdminClient();

    // Fetch all 2026 sales without limit
    let allSales: any[] = [];
    let page = 0;
    while (true) {
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('store_id, business_date, net_sales')
            .gte('business_date', '2026-01-01')
            .lte('business_date', '2026-03-06')
            .order('store_id')
            .order('business_date')
            .range(page * 1000, (page + 1) * 1000 - 1);

        if (error) {
            console.error(error);
            break;
        }
        if (!data || data.length === 0) break;
        allSales = allSales.concat(data);
        page++;
    }

    const storesMap = new Map<string, any[]>();
    allSales?.forEach(s => {
        if (!storesMap.has(s.store_id)) storesMap.set(s.store_id, []);
        storesMap.get(s.store_id)!.push(s);
    });

    const storeNames = await supabase.from('stores').select('external_id, name');
    const nameMap = new Map<string, string>();
    storeNames.data?.forEach(s => nameMap.set(s.external_id, s.name));

    let report = "ANOMALÍAS DETECTADAS EN 2026\n\n";

    let warnings = 0;

    storesMap.forEach((storeSales, storeId) => {
        const name = nameMap.get(storeId) || storeId;
        const suspects: string[] = [];

        for (let i = 1; i < storeSales.length; i++) {
            const today = storeSales[i];
            const yesterday = storeSales[i - 1];

            // Mas de 40% caida repentina
            if (today.net_sales < (yesterday.net_sales * 0.50) && today.net_sales > 0 && yesterday.net_sales > 1000) {
                suspects.push(`- Posible Offline: ${today.business_date} ($${today.net_sales} vs previo $${yesterday.net_sales})`);
                warnings++;
            }

            if (today.net_sales === 0 || today.net_sales === null) {
                suspects.push(`- 🔴 DÍA $0: ${today.business_date}`);
                warnings++;
            }
        }

        if (suspects.length > 0) {
            report += `\n[ ${name} ]\n`;
            suspects.forEach(s => report += s + "\n");
        }
    });

    fs.writeFileSync('docs/anomalias_detectadas_2026.md', report, 'utf-8');
    console.log(`Búsqueda heurística de Toast 2026 terminada. ${warnings} anomalías encontradas.`);
}
run();
