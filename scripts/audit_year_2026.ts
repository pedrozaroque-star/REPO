import { getSupabaseAdminClient } from '../lib/supabase';
import { fetchToastData, getAuthToken, getToastRestaurants } from '../lib/toast-api';
import fs from 'fs';

async function runAudit() {
    console.log('Iniciando Auditoría Masiva (Año 2026 YTD): Toast API vs Supabase Cache...');

    // Rango: 1 Enero 2026 hasta Ayer
    const startDate = '2026-01-01';

    // Obtener "Ayer" en hora de Los Angeles
    const nowLA = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    nowLA.setDate(nowLA.getDate() - 1);
    const y = nowLA.getFullYear();
    const m = String(nowLA.getMonth() + 1).padStart(2, '0');
    const d = String(nowLA.getDate()).padStart(2, '0');
    const endDate = `${y}-${m}-${d}`;

    console.log(`Periodo de Auditoría: ${startDate} a ${endDate}`);

    let report = `# Auditoría de Integridad: Toast API vs Base de Datos (2026 YTD)\n\n`;
    report += `**Periodo:** ${startDate} a ${endDate}\n`;
    report += `**Tolerancia de discrepancia:** $5.00 (Evita reportar diferencias por centavos/redondeos)\n\n`;

    const token = await getAuthToken();
    if (!token) {
        console.log('Error de Autenticación con Toast');
        return;
    }
    const realStores = await getToastRestaurants(token);
    const supabase = await getSupabaseAdminClient();

    let totalDiscrepancias = 0;
    const TOLERANCE = 5.00;

    // Ejecutar tienda por tienda para no saturar memoria/API
    for (const store of realStores) {
        console.log(`\nAuditando: ${store.name} (${store.id})`);

        // 1. Fetch from Toast
        const toastRes = await fetchToastData({
            storeIds: String(store.id),
            startDate,
            endDate,
            groupBy: 'day',
            fastMode: true, // Modo rápido, sólo consulta totales diarios
            skipCache: true // FORZAMOS ir a Toast directamente, saltando DB
        });

        const toastData = toastRes.rows;

        // 2. Fetch from Supabase
        const { data: cacheData } = await supabase
            .from('sales_daily_cache')
            .select('business_date, net_sales')
            .eq('store_id', store.id)
            .gte('business_date', startDate)
            .lte('business_date', endDate)
            .order('business_date', { ascending: true });

        // Mapas para comparación rápida
        const toastMap = new Map<string, number>();
        toastData.forEach((row: any) => {
            if (row.periodStart) toastMap.set(row.periodStart, Number(row.netSales || 0));
        });

        const cacheMap = new Map<string, number>();
        cacheData?.forEach(row => {
            cacheMap.set(row.business_date, Number(row.net_sales || 0));
        });

        // Revisar todos los días del periodo
        const currDate = new Date(`${startDate}T12:00:00Z`);
        const maxDate = new Date(`${endDate}T12:00:00Z`);

        let storeIssues = [];

        while (currDate <= maxDate) {
            const y = currDate.getUTCFullYear();
            const m = String(currDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(currDate.getUTCDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;

            const tSales = toastMap.get(dateStr);
            const cSales = cacheMap.get(dateStr);

            if (tSales !== undefined && cSales === undefined) {
                if (tSales > 0) {
                    storeIssues.push(`- 🔴 **Dato Faltante:** ${dateStr} - En Toast hay $${tSales.toFixed(2)}, pero NO EXISTE en la BD Local.`);
                    totalDiscrepancias++;
                }
            } else if (tSales === undefined && cSales !== undefined) {
                if (cSales > 0) {
                    storeIssues.push(`- 🟡 **Dato Huérfano:** ${dateStr} - En la BD hay $${cSales.toFixed(2)}, pero Toast no devolvió nada (Terminal apagada y forzada después?).`);
                    totalDiscrepancias++;
                }
            } else if (tSales !== undefined && cSales !== undefined) {
                const diff = Math.abs(tSales - cSales);
                if (diff > TOLERANCE) {
                    storeIssues.push(`- 🟠 **Corrupción Asimétrica:** ${dateStr} - Toast reporta **$${tSales.toFixed(2)}** vs BD local **$${cSales.toFixed(2)}** (Diferencia de $${diff.toFixed(2)}). ¡Requiere Re-Sync!`);
                    totalDiscrepancias++;
                }
            }

            currDate.setUTCDate(currDate.getUTCDate() + 1);
        }

        if (storeIssues.length > 0) {
            console.log(`⚠️ Se encontraron ${storeIssues.length} problemas en ${store.name}`);
            report += `### 🏪 ${store.name}\n`;
            storeIssues.forEach(iss => report += `${iss}\n`);
            report += '\n';

            // Auto generar comando de reparación para la tienda
            report += `**🔹 Comando de reparación rápida para esta tienda:**\n`;
            report += `\`TBD: Ejecutar reparación para ${store.id} desde UI o Script\`\n\n`;
        } else {
            console.log(`✅ ${store.name}: Perfecto (100% de coincidencia)`);
        }
    }

    report += `\n## Resumen Final\n`;
    report += `- **Total de Discrepancias / Corrupciones detectadas en toda la cadena:** ${totalDiscrepancias}\n`;

    if (totalDiscrepancias === 0) {
        report += `\n✅ **El sistema está perfectamente sincronizado con la matriz de Toast. No hay discrepancias mayores a $5.00 en lo que va del año.**\n`;
    }

    fs.writeFileSync('docs/auditoria_anual_toast_2026.md', report, 'utf-8');
    console.log(`\nAuditoría finalizada. Resultados guardados en docs/auditoria_anual_toast_2026.md`);
}

runAudit().catch(console.error);
