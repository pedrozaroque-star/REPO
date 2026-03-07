import { getSupabaseAdminClient } from '../lib/supabase';
import { getAuthToken, getToastRestaurants } from '../lib/toast-api';
import fs from 'fs';

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchToastDateFast(token: string, storeId: string, dateStr: string): Promise<number> {
    const formattedDate = dateStr.replace(/-/g, '');
    let net = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`);
        url.searchParams.append('businessDate', formattedDate);
        url.searchParams.append('pageSize', '100');
        url.searchParams.append('page', String(page));
        // ONLY fetch what we absolutely need to calculate Fast Net
        url.searchParams.append('fields', 'voided,checks.voided,checks.amount,checks.taxAmount,checks.payments.tipAmount,serviceCharges');

        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        });

        if (!res.ok) {
            if (res.status === 429) {
                // Rate limited
                await sleep(5000);
                continue;
            }
            throw new Error(`Toast API Error: ${res.status}`);
        }

        const orders = await res.json();
        if (orders.length === 0) break;

        orders.forEach((o: any) => {
            if (o.voided) return;
            o.checks?.forEach((c: any) => {
                if (c.voided) return;
                const amt = Number(c.amount || 0);
                const tax = Number(c.taxAmount || 0);
                let tip = 0;
                c.payments?.forEach((p: any) => tip += Number(p.tipAmount || 0));
                net += (amt - tax - tip);
            });
            o.serviceCharges?.forEach((s: any) => {
                net += Number(s.amount || 0);
            });
        });

        if (orders.length < 100) hasMore = false;
        else page++;
    }
    return net;
}

async function runAudit() {
    console.log('Iniciando Auditoría Masiva Ultra-Rápida (Año 2026 YTD)...');

    // Rango: 1 Enero 2026 a ayer
    const startDate = '2026-01-01';
    const nowLA = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    nowLA.setDate(nowLA.getDate() - 1); // Ayer

    const startY = 2026; const startM = 0; const startD = 1;
    const endY = nowLA.getFullYear(); const endM = nowLA.getMonth(); const endD = nowLA.getDate();

    const neededDates: string[] = [];
    const cur = new Date(startY, startM, startD);
    const end = new Date(endY, endM, endD);
    while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        neededDates.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
    }

    console.log(`Periodo: ${neededDates[0]} a ${neededDates[neededDates.length - 1]} (${neededDates.length} días)`);

    const token = await getAuthToken();
    if (!token) return;
    const realStores = await getToastRestaurants(token);
    const supabase = await getSupabaseAdminClient();

    let report = `# Auditoría de Integridad: Toast API vs Base de Datos (2026 YTD)\n\n`;
    report += `**Periodo:** ${neededDates[0]} a ${neededDates[neededDates.length - 1]}\n`;
    report += `**Tolerancia de discrepancia:** $5.00\n\n`;

    let totalDiscrepancias = 0;
    const TOLERANCE = 5.00;

    // Run 2 stores concurrently
    const CONCURRENCY = 2;
    let storeIndex = 0;

    async function processStore(store: any) {
        const { data: cacheData } = await supabase
            .from('sales_daily_cache')
            .select('business_date, net_sales')
            .eq('store_id', store.id)
            .gte('business_date', neededDates[0])
            .lte('business_date', neededDates[neededDates.length - 1]);

        const cacheMap = new Map<string, number>();
        cacheData?.forEach(row => cacheMap.set(row.business_date, Number(row.net_sales || 0)));

        let storeIssues: string[] = [];

        process.stdout.write(`\n⏳ Auditando ${store.name}: `);

        for (const dateStr of neededDates) {
            try {
                const tSales = await fetchToastDateFast(token!, store.id, dateStr);
                const cSales = cacheMap.get(dateStr);

                if (tSales > 0 && cSales === undefined) {
                    storeIssues.push(`- 🔴 **Faltante en DB:** ${dateStr} | Toast: $${tSales.toFixed(2)} | DB: null`);
                    totalDiscrepancias++;
                } else if (tSales === 0 && cSales !== undefined && cSales > 0) {
                    storeIssues.push(`- 🟡 **Dato Huérfano en DB:** ${dateStr} | Toast: $0.00 | DB: $${cSales.toFixed(2)}`);
                    totalDiscrepancias++;
                } else if (tSales > 0 && cSales !== undefined) {
                    const diff = Math.abs(tSales - cSales);
                    if (diff > TOLERANCE) {
                        storeIssues.push(`- 🟠 **Descuadre:** ${dateStr} | Toast: $${tSales.toFixed(2)} | DB: $${cSales.toFixed(2)} | Diferencia: $${diff.toFixed(2)}`);
                        totalDiscrepancias++;
                    }
                }
                process.stdout.write('.');
            } catch (err: any) {
                storeIssues.push(`- ⚠️ **Error API Toast:** ${dateStr} | ${err.message}`);
                totalDiscrepancias++;
                process.stdout.write('x');
            }
            await sleep(500); // 500ms space between days
        }

        if (storeIssues.length > 0) {
            console.log(`\n⚠️ ${store.name}: ${storeIssues.length} problemas encontrados.`);
            report += `### 🏪 ${store.name}\n`;
            storeIssues.forEach(iss => report += `${iss}\n`);
            report += '\n';
        } else {
            console.log(`\n✅ ${store.name}: Perfecto.`);
        }
    }

    const promises = [];
    while (storeIndex < realStores.length) {
        const batch = realStores.slice(storeIndex, storeIndex + CONCURRENCY);
        storeIndex += CONCURRENCY;
        promises.push(...batch.map(s => processStore(s)));
        await Promise.all(promises);
        promises.length = 0;
    }

    report += `\n## Resumen Final\n`;
    report += `- **Total de Corrupciones detectadas:** ${totalDiscrepancias}\n`;

    if (totalDiscrepancias === 0) report += `\n✅ **El sistema está 100% sincronizado (Diferencias menores a $5.00 ignoradas).**\n`;

    fs.writeFileSync('docs/auditoria_anual_toast_2026.md', report, 'utf-8');
    console.log(`\nAuditoría finalizada. Resultados guardados en docs/auditoria_anual_toast_2026.md`);
}

runAudit().catch(console.error);
