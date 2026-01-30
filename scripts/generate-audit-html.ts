
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
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

interface DailyRecord {
    date: string;
    day: string;
    real: number;
    forecast: number;
    errorPct: number;
    icon: string;
    statusClass: string;
}

interface StoreResult {
    id: string;
    name: string;
    mape: number;
    totalError: number;
    daysCount: number;
    records: DailyRecord[];
}

async function generateReport() {
    const startDate = parseISO('2025-01-01');
    const endDate = parseISO('2026-01-29');

    console.log(`\n🌎 GENERANDO REPORTE HTML (15 TIENDAS)...\n`);

    // --- PRE-FETCH REAL DATA (MASSIVE OPTIMIZATION) ---
    console.log("📥 Descargando historial completo de ventas (2025-2026)...");

    let allSales: any[] = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('store_id, business_date, net_sales')
            .gte('business_date', '2025-01-01')
            .lte('business_date', '2026-01-29')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) { console.error(error); break; }
        if (!data || data.length === 0) break;

        allSales = [...allSales, ...data];
        process.stdout.write(`Cargados: ${allSales.length}...\r`);
        if (data.length < pageSize) break; // End of list
        page++;
    }
    console.log(`\n✅ Datos cargados TOTAL: ${allSales.length.toLocaleString()} registros.\n`);

    // Create lookup map: "store_id|date" -> net_sales
    const salesMap = new Map<string, number>();
    allSales?.forEach(s => {
        salesMap.set(`${s.store_id}|${s.business_date}`, s.net_sales);
    });
    console.log(`✅ Datos cargados: ${allSales?.length.toLocaleString()} registros.\n`);

    const results: StoreResult[] = [];

    // --- DATA COLLECTION ---
    for (const [id, name] of Object.entries(STORES)) {
        process.stdout.write(`Processing: ${name.padEnd(20)} `);

        let currentDate = startDate;
        let totalReal = 0;
        let totalForecast = 0;
        let absErrorSum = 0;
        const records: DailyRecord[] = [];

        const totalDaysApprox = 400;
        let dayCounter = 0;

        while (currentDate <= endDate) {
            dayCounter++;
            if (dayCounter % 100 === 0) process.stdout.write(`|`);

            const dateStr = format(currentDate, 'yyyy-MM-dd');
            const dayOfWeek = format(currentDate, 'EEE');

            try {
                // Generate Forecast (Still the heavy lifter)
                const forecast = await generateSmartForecast(id, dateStr);
                const predicted = forecast.total_sales;

                // Lookup Real Data from Memory
                const lookupKey = `${id}|${dateStr}`;
                const actual = salesMap.get(lookupKey) || 0;

                if (actual > 0) {
                    const errorPct = (Math.abs(predicted - actual) / actual) * 100;

                    totalReal += actual;
                    totalForecast += predicted;
                    absErrorSum += errorPct;

                    let icon = '🟢';
                    let statusClass = 'bg-emerald-900/20 text-emerald-400';
                    if (errorPct < 5) { icon = '🏆'; statusClass = 'bg-blue-900/20 text-blue-400 font-bold'; }
                    else if (errorPct > 10) { icon = '🟡'; statusClass = 'bg-yellow-900/20 text-yellow-400'; }
                    if (errorPct > 20) { icon = '🔴'; statusClass = 'bg-red-900/20 text-red-400 font-bold'; }

                    records.push({
                        date: dateStr,
                        day: dayOfWeek,
                        real: actual,
                        forecast: predicted,
                        errorPct: errorPct,
                        icon,
                        statusClass
                    });
                }
            } catch (e) { }
            currentDate = addDays(currentDate, 1);
        }

        if (records.length > 0) {
            process.stdout.write(` Done (${records.length} days)\n`);
            results.push({
                id,
                name,
                mape: absErrorSum / records.length,
                totalError: ((totalForecast - totalReal) / totalReal) * 100,
                daysCount: records.length,
                records
            });
        } else {
            process.stdout.write(` No Data!\n`);
        }
    }

    // --- HTML GENERATION ---
    const html = `
    <!DOCTYPE html>
    <html lang="es" class="dark">
    <head>
        <meta charset="UTF-8">
        <title>Audit Report 2025-26</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #e2e8f0; }
            .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
            details > summary { list-style: none; cursor: pointer; }
            details > summary::-webkit-details-marker { display: none; }
        </style>
    </head>
    <body class="p-8 max-w-7xl mx-auto">
        
        <header class="mb-10 text-center">
            <h1 class="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
                Intelligence v2.1 Audit Report
            </h1>
            <p class="text-slate-400">Period: Jan 1, 2025 - Jan 29, 2026 • 15 Stores Analyzed</p>
        </header>

        <!-- DASHBOARD SUMMARY -->
        <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-12">
            ${results.map(r => {
        let color = 'border-emerald-500/50 text-emerald-400';
        if (r.mape > 8) color = 'border-yellow-500/50 text-yellow-400';
        if (r.mape > 12) color = 'border-red-500/50 text-red-400';
        return `
                <div class="glass p-4 rounded-xl border-l-4 ${color} hover:bg-slate-800 transition">
                    <h3 class="font-bold text-white text-lg">${r.name}</h3>
                    <div class="flex justify-between items-end mt-2">
                        <div>
                            <div class="text-xs text-slate-500">MAPE (Avg Error)</div>
                            <div class="text-2xl font-mono ${color.split(' ')[1]}">${r.mape.toFixed(1)}%</div>
                        </div>
                        <div class="text-right">
                            <div class="text-xs text-slate-500">Total Bias</div>
                            <div class="font-mono text-sm ${r.totalError > 0 ? 'text-blue-400' : 'text-orange-400'}">
                                ${r.totalError > 0 ? '+' : ''}${r.totalError.toFixed(1)}%
                            </div>
                        </div>
                    </div>
                </div>
                `;
    }).join('')}
        </div>

        <!-- DETAILED STORE TABLES -->
        <div class="space-y-6">
            ${results.map(r => `
            <details class="glass rounded-xl overflow-hidden group">
                <summary class="p-6 flex items-center justify-between hover:bg-slate-800/50 transition select-none">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-slate-300">
                            ${r.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <h2 class="text-xl font-bold text-white">${r.name}</h2>
                            <p class="text-sm text-slate-400">${r.daysCount} Days Validated</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-6">
                        <div class="text-right">
                             <span class="px-3 py-1 rounded-full text-xs font-bold bg-slate-900 border border-slate-700">
                                MAPE: ${r.mape.toFixed(1)}%
                             </span>
                        </div>
                        <svg class="w-6 h-6 text-slate-500 transform group-open:rotate-180 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </summary>
                
                <div class="p-6 border-t border-slate-700/50 bg-slate-900/30">
                    <div class="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <table class="w-full text-sm text-left">
                            <thead class="text-xs text-slate-400 uppercase bg-slate-800 sticky top-0">
                                <tr>
                                    <th class="px-4 py-3">Date</th>
                                    <th class="px-4 py-3">Day</th>
                                    <th class="px-4 py-3 text-right">Real Sales</th>
                                    <th class="px-4 py-3 text-right">Forecast</th>
                                    <th class="px-4 py-3 text-right">Error %</th>
                                    <th class="px-4 py-3 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-800">
                                ${r.records.map(d => `
                                <tr class="hover:bg-slate-800/50">
                                    <td class="px-4 py-2 font-mono text-slate-300">${d.date}</td>
                                    <td class="px-4 py-2 text-slate-500">${d.day}</td>
                                    <td class="px-4 py-2 text-right font-medium">$${d.real.toLocaleString()}</td>
                                    <td class="px-4 py-2 text-right text-slate-400">$${Math.round(d.forecast).toLocaleString()}</td>
                                    <td class="px-4 py-2 text-right font-bold ${d.statusClass}">${d.errorPct.toFixed(1)}%</td>
                                    <td class="px-4 py-2 text-center text-lg">${d.icon}</td>
                                </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </details>
            `).join('')}
        </div>

        <footer class="mt-20 text-center text-slate-600 text-sm">
            Generated automatically by Antigravity Intelligence v2.1 • ${new Date().toLocaleString()}
        </footer>

    </body>
    </html>
    `;

    const outputPath = path.join(process.cwd(), 'public', 'audit-report.html');
    fs.writeFileSync(outputPath, html);
    console.log(`\n✅ REPORTE GENERADO EXITOSAMENTE:\n👉 ${outputPath}\n`);
}

generateReport();
