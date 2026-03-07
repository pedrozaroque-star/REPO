import { getSupabaseAdminClient } from '../lib/supabase';
import { fetchToastData } from '../lib/toast-api';
import fs from 'fs';

async function runAudit() {
    console.log('Iniciando auditoría de Enero 2026: Toast API vs Supabase Cache...');
    const startDate = '2026-01-01';
    const endDate = '2026-01-31';

    // 1. Fetch from Toast API
    console.log('1. Fetching data from Toast API (Jan 1 - Jan 31, 2026)...');
    const toastRes = await fetchToastData({
        storeIds: 'all',
        startDate,
        endDate,
        groupBy: 'day'
    });

    const toastData = toastRes.rows;
    console.log(`✓ Toast devolvió ${toastData.length} registros.`);

    // 2. Fetch from Supabase
    console.log('2. Fetching data from Supabase Cache...');
    const supabase = await getSupabaseAdminClient();
    const { data: cacheData, error } = await supabase
        .from('sales_daily_cache')
        .select('store_id, business_date, net_sales')
        .gte('business_date', startDate)
        .lte('business_date', endDate);

    if (error) {
        console.error('Error fetching Supabase data:', error);
        return;
    }

    console.log(`✓ Supabase devolvió ${cacheData?.length || 0} registros.`);

    // 3. Compare
    console.log('3. Analizando discrepancias...');

    // Create lookup maps
    // Key: storeId|date
    const toastMap = new Map<string, any>();
    const toastStores = new Map<string, string>();
    toastData.forEach((row: any) => {
        if (row.storeId && row.periodStart) {
            toastMap.set(`${row.storeId}|${row.periodStart}`, row.netSales || 0);
            toastStores.set(row.storeId, row.storeName);
        }
    });

    const cacheMap = new Map<string, any>();
    cacheData?.forEach(row => {
        cacheMap.set(`${row.store_id}|${row.business_date}`, row.net_sales || 0);
    });

    const allKeys = new Set([...toastMap.keys(), ...cacheMap.keys()]);

    let discrepancies = 0;
    let missingInCache = 0;
    let missingInToast = 0;
    let valueMismatches = 0;
    let matches = 0;

    let report = `# Reporte de Auditoría: Toast API vs Supabase Cache (Enero 2026)\n\n`;
    report += `**Rango de fechas:** ${startDate} a ${endDate}\n`;
    report += `**Registros en Toast:** ${toastData.length}\n`;
    report += `**Registros en Cache (Supabase):** ${cacheData?.length || 0}\n\n`;

    report += `## Discrepancias Encontradas\n\n`;

    // Tolerance for floating point differences (e.g. 1 cent)
    const TOLERANCE = 0.05;

    for (const key of allKeys) {
        const [storeId, date] = key.split('|');
        const storeName = toastStores.get(storeId) || storeId;
        const tSales = toastMap.get(key);
        const cSales = cacheMap.get(key);

        if (tSales === undefined && cSales !== undefined) {
            // In cache but not in Toast
            report += `- 🔴 **[Falta en Toast]** ${date} - ${storeName}: Cache tiene $${cSales.toFixed(2)}, Toast no devolvió nada.\n`;
            missingInToast++;
            discrepancies++;
        } else if (cSales === undefined && tSales !== undefined) {
            // In Toast but not in cache
            if (tSales > 0) {
                report += `- 🟡 **[Falta en Cache]** ${date} - ${storeName}: Toast reporta $${tSales.toFixed(2)}, no existe en Cache (Dato faltante).\n`;
                missingInCache++;
                discrepancies++;
            }
        } else if (tSales !== undefined && cSales !== undefined) {
            // In both, check difference
            const diff = Math.abs(tSales - cSales);
            if (diff > TOLERANCE) {
                report += `- 🟠 **[Diferencia de Monto]** ${date} - ${storeName}: Toast=$${tSales.toFixed(2)} vs Cache=$${cSales.toFixed(2)} (Diferencia: $${diff.toFixed(2)})\n`;
                valueMismatches++;
                discrepancies++;
            } else {
                matches++;
            }
        }
    }

    report += `\n## Resumen\n`;
    report += `- **Coincidencias (Matches):** ${matches}\n`;
    report += `- **Discrepancias Totales:** ${discrepancies}\n`;
    report += `  - Faltantes en Cache: ${missingInCache}\n`;
    report += `  - Diferencia de Ventas (>$0.05): ${valueMismatches}\n`;
    report += `  - Faltantes en Toast (Posible dato huérfano en Cache): ${missingInToast}\n`;

    if (discrepancies === 0) {
        report += `\n✅ **¡Excelente! No se encontraron discrepancias. La caché está perfectamente sincronizada con Toast API para Enero de 2026.**\n`;
    } else {
        report += `\n⚠️ **Requiere Reparación:** Existen discrepancias. Se recomienda reparar usando el script de reparación de Caché para los días y tiendas afectados (borrar de caché y refetch).\n`;
    }

    fs.writeFileSync('docs/auditoria_enero_2026.md', report, 'utf-8');
    console.log(`\nAuditoría completada. Resultado guardado en docs/auditoria_enero_2026.md`);
    console.log(`Matches: ${matches}, Discrepancias locales: ${discrepancies}`);
}

runAudit().catch(console.error);
