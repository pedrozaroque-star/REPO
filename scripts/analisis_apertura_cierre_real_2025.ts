import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: '.env.local' })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Env Vars')
    process.exit(1)
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const DAYS: Record<number, string> = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };

// The toast business day logic runs 6 AM to 5 AM. Let's define the chronological order of hours in a business day:
const HOURLY_ORDER = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

const formatHourRange = (h: number) => {
    let h1 = (h + 24) % 24;
    const ampm1 = (h1 >= 12 && h1 < 24) ? 'PM' : 'AM';
    let d1 = h1 % 12;
    if (d1 === 0) d1 = 12;

    let h2 = (h1 + 1) % 24;
    const ampm2 = (h2 >= 12 && h2 < 24) ? 'PM' : 'AM';
    let d2 = h2 % 12;
    if (d2 === 0) d2 = 12;

    return `${d1}:00 ${ampm1} a ${d2}:00 ${ampm2}`;
}

const getIntensityClass = (val: number) => {
    if (val >= 800) return 'high-intensity';
    if (val >= 500) return 'medium-intensity';
    if (val < 250) return 'low-intensity';
    return '';
}

const formatMoney = (val: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

const getOpeningProposal = (h: number, sales: number) => {
    if (sales < 350) {
        return formatHourRange(h + 1);
    }
    return '';
}

const getClosingProposal = (h: number, sales: number) => {
    if (sales < 350) {
        return formatHourRange(h - 1);
    }
    return '';
}

function mode(arr: number[]): number | undefined {
    if (arr.length === 0) return undefined;
    return arr.sort((a, b) =>
        arr.filter(v => v === a).length - arr.filter(v => v === b).length
    ).pop();
}

async function run() {
    console.log('🚀 Calculando Promedios 2025 REALES...')

    const { data: stores } = await supabase.from('stores')
        .select('external_id, name, supervisor_name')
        .eq('is_active', true)

    if (!stores) return console.error('❌ No se encontraron tiendas.')

    const storeMap = new Map(stores.map(s => [s.external_id, s.name]))
    const supervisorMap = new Map(stores.map(s => [s.name, s.supervisor_name || 'Sin Supervisor']))

    let allSales: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    console.log('📥 Descargando datos...')
    while (hasMore) {
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('business_date, store_id, hourly_data')
            .gte('business_date', '2025-01-01')
            .lte('business_date', '2025-12-31')
            .order('business_date')
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) { console.error('❌ Error fetching sales:', error); break; }
        if (!data || data.length === 0) {
            hasMore = false
        } else {
            allSales = allSales.concat(data)
            process.stdout.write(`\r   Registros: ${allSales.length}`)
            if (data.length < pageSize) hasMore = false
            page++
        }
    }
    console.log(`\n✅ ${allSales.length} registros totales.`)

    // First Pass: Find actual open and close hours per record
    // Store -> DayOfWeek -> Array of OpenHours / CloseHours
    type HoursFreq = { openHours: number[], closeHours: number[] };
    const rawHours = new Map<string, Map<number, HoursFreq>>();

    console.log('🔍 Identificando horas reales moda...')
    for (const record of allSales) {
        const storeName = storeMap.get(record.store_id)
        if (!storeName) continue

        const parts = record.business_date.split('-');
        const date = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
        const dayIdx = date.getUTCDay();

        if (!rawHours.has(storeName)) {
            const m = new Map();
            for (let d = 0; d < 7; d++) {
                m.set(d, { openHours: [], closeHours: [] });
            }
            rawHours.set(storeName, m);
        }

        const hourly = record.hourly_data || {}
        let openHour = -1;
        let closeHour = -1;

        // threshold validation so a stray $1 sale doesnt ruin the metric
        const THRESHOLD = 20;

        for (const h of HOURLY_ORDER) {
            if (Number(hourly[h.toString()] || 0) > THRESHOLD) {
                if (openHour === -1) openHour = h;
                closeHour = h; // Last hit overrides
            }
        }

        if (openHour !== -1) {
            const hq = rawHours.get(storeName)!.get(dayIdx)!;
            hq.openHours.push(openHour);
            hq.closeHours.push(closeHour);
        }
    }

    // Now compute modes per Store / Day
    type StoreModels = { openMode: number, closeMode: number, openSum: number, openCount: number, closeSum: number, closeCount: number }
    const stats = new Map<string, Map<number, StoreModels>>();

    for (const store of rawHours.keys()) {
        const m = new Map<number, StoreModels>();
        for (let d = 0; d < 7; d++) {
            const hq = rawHours.get(store)!.get(d)!;
            const oModeVal = mode(hq.openHours);
            const openMode = oModeVal !== undefined ? oModeVal : 9; // Fallback
            const cModeVal = mode(hq.closeHours);
            const closeMode = cModeVal !== undefined ? cModeVal : 23; // Fallback
            m.set(d, { openMode, closeMode, openSum: 0, openCount: 0, closeSum: 0, closeCount: 0 });
        }
        stats.set(store, m);
    }

    // Second Pass: Compute averages ONLY for the Mode hours
    console.log('🧮 Calculando promedios exactos sobre los horarios moda...')
    for (const record of allSales) {
        const storeName = storeMap.get(record.store_id)
        if (!storeName) continue

        const parts = record.business_date.split('-');
        const date = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
        const dayIdx = date.getUTCDay();

        const model = stats.get(storeName)!.get(dayIdx)!;
        const hourly = record.hourly_data || {};

        const openSale = Number(hourly[model.openMode.toString()] || 0);
        const closeSale = Number(hourly[model.closeMode.toString()] || 0);

        if (openSale > 0) {
            model.openSum += openSale;
            model.openCount++;
        }
        if (closeSale > 0) {
            model.closeSum += closeSale;
            model.closeCount++;
        }
    }

    // Generate HTML
    let html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reporte de Ventas por Supervisor: Apertura vs Cierre REAL 2025</title>
    <style>
        :root { --primary: #D32F2F; --dark: #212121; --light: #F5F5F5; --grey: #9E9E9E; --border: #E0E0E0; --highlight-high: #E8F5E9; --highlight-low: #FFEBEE; --text-high: #2E7D32; --text-low: #C62828; --proposal-color: #0288D1; --proposal-bg: #E1F5FE; }
        body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F9FAFB; color: #333; margin: 0; padding: 40px; line-height: 1.6; }
        .container { max-width: 1400px; margin: 0 auto; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 8px; overflow: hidden; }
        header { background-color: var(--dark); color: white; padding: 30px 40px; border-bottom: 4px solid var(--primary); display: flex; justify-content: space-between; align-items: center; }
        h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .subtitle { opacity: 0.8; font-size: 14px; margin-top: 5px; }
        .summary-card { padding: 20px 40px; background-color: white; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .supervisor-section { padding: 20px 40px; border-bottom: 4px solid #f0f0f0; }
        .supervisor-header { background-color: var(--primary); color: white; padding: 10px 20px; border-radius: 4px; font-size: 18px; font-weight: 700; margin-top: 20px; margin-bottom: 20px; display: inline-block; }
        .store-block { margin-bottom: 40px; }
        .store-header { display: flex; align-items: center; margin-top: 10px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid var(--border); }
        .store-title { font-size: 18px; font-weight: 700; color: var(--dark); margin: 0; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { text-align: left; padding: 12px 16px; background-color: #f5f5f5; color: #666; font-weight: 600; border-bottom: 1px solid #ddd; }
        td { padding: 12px 16px; border-bottom: 1px solid #eee; }
        tr:last-child td { border-bottom: none; }
        .money { font-family: 'Consolas', monospace; font-weight: 600; }
        .time { color: #555; }
        .high-intensity { color: var(--text-high); background-color: var(--highlight-high); }
        .medium-intensity { color: #1565C0; background-color: #E3F2FD; }
        .low-intensity { color: var(--text-low); background-color: var(--highlight-low); font-weight: bold; }
        .proposal-text { color: var(--proposal-color); background-color: var(--proposal-bg); font-weight: bold; padding: 2px 6px; border-radius: 4px; border: 1px dashed var(--proposal-color); }
        .badge { display: inline-block; padding: 4px 8px; font-weight: 600; }
        .input-cell { background-color: #fafafa; border-left: 2px solid #eee; }
        .input-box { border: 1px solid #ddd; background: white; min-height: 24px; width: 100%; border-radius: 2px; padding: 2px 5px; font-size: 13px; }
        @media print {
            body { padding: 0; background: white; }
            .container { box-shadow: none; max-width: 100%; border-radius: 0; }
            .print-btn { display: none; }
            .supervisor-header { background-color: #333 !important; color: white !important; -webkit-print-color-adjust: exact; }
            th { background-color: #eee !important; -webkit-print-color-adjust: exact; }
            .low-intensity { color: black; font-weight: bold; background-color: #ddd !important; -webkit-print-color-adjust: exact; } 
            .proposal-text { border: 1px solid #999; color: black; background: #eee; -webkit-print-color-adjust: exact; }
        }
    </style>
</head>
<body>
<div class="container">
    <header>
        <div>
            <h1>Análisis de Ventas por Supervisor: Apertura vs Cierre (VERSIÓN INVESTIGACIÓN REAL)</h1>
            <div class="subtitle">Promedios Anuales 2025 • Modas Reales de Operación de la Sucursal</div>
        </div>
        <button class="print-btn" onclick="window.print()">🖨️ Imprimir PDF</button>
    </header>
    <div class="summary-card">
        <div>
            <p><strong>Metodología:</strong> Se analizó ticket por ticket todo 2025 para ubicar los <strong>bloques de horas reales</strong> en los que cada sucursal recibe sus primeras y últimas ventas (filtrando actividad menor de $20). Luego se promedió esa 1ra hora viva contra la última hora viva verdadera.</p>
            <p style="font-size: 12px; color: #666; margin-top: 5px;">
                <strong>Reglas de Propuesta Automática:</strong><br>
                1. Apertura: Si vende < $350 -> Proponer abrir 1 hora después<br>
                2. Cierre: Si vende < $350 en última hora -> Proponer cerrar 1 hora antes
            </p>
        </div>
        <div>
            <span class="badge" style="background:var(--highlight-high); color:var(--text-high)">Alto (> $800)</span>
            <span class="badge" style="background:#E3F2FD; color:#1565C0">Medio (> $500)</span>
            <span class="badge" style="background:var(--highlight-low); color:var(--text-low)">Bajo (< $250)</span>
        </div>
    </div>
`;

    // Map supervisor -> stores
    const supToStores = new Map<string, string[]>();
    for (const [store, data] of stats) {
        const sup = supervisorMap.get(store) || 'Sin Supervisor';
        if (!supToStores.has(sup)) supToStores.set(sup, []);
        supToStores.get(sup)!.push(store);
    }

    const sortedSupervisors = Array.from(supToStores.keys()).sort();
    for (const sup of sortedSupervisors) {
        html += `
        <div class="supervisor-section">
            <div class="supervisor-header">👮‍♂️ Supervisor: ${sup}</div>`;

        const sortedStores = supToStores.get(sup)!.sort();
        for (const store of sortedStores) {
            html += `
            <div class="store-block">
                <div class="store-header">
                    <h2 class="store-title">🏪 ${store}</h2>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 10%">Día</th>
                            <th style="width: 15%">Rango Apertura (Real)</th>
                            <th style="width: 10%">Venta Promedio</th>
                            
                            <th style="width: 15%">Última Hora Operativa (Real)</th>
                            <th style="width: 10%">Venta Promedio</th>
                            
                            <th style="width: 20%; border-left: 2px solid #ddd;">📝 Propuesta Apertura</th>
                            <th style="width: 20%">📝 Propuesta Cierre</th>
                        </tr>
                    </thead>
                    <tbody>`;

            const m = stats.get(store)!;
            const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon - Sun
            for (const d of dayOrder) {
                const dayStats = m.get(d)!;
                const avgOpen = dayStats.openCount > 0 ? dayStats.openSum / dayStats.openCount : 0;
                const avgClose = dayStats.closeCount > 0 ? dayStats.closeSum / dayStats.closeCount : 0;

                const openTime = formatHourRange(dayStats.openMode);
                const closeTime = formatHourRange(dayStats.closeMode);

                const openClass = getIntensityClass(avgOpen);
                const closeClass = getIntensityClass(avgClose);

                const openProposal = getOpeningProposal(dayStats.openMode, avgOpen);
                const closeProposal = getClosingProposal(dayStats.closeMode, avgClose);

                html += `
                    <tr>
                        <td><strong>${DAYS[d]}</strong></td>
                        <td class="time">${openTime}</td>
                        <td class="money ${openClass}">${formatMoney(avgOpen)}</td>
                        
                        <td class="time">${closeTime}</td>
                        <td class="money ${closeClass}">${formatMoney(avgClose)}</td>
                        
                        <td class="input-cell">
                            <div class="input-box" contenteditable="true">${openProposal ? `<span class="proposal-text">${openProposal}</span>` : ''}</div>
                        </td>
                        <td class="input-cell" style="border-left: 1px solid #eee;">
                            <div class="input-box" contenteditable="true">${closeProposal ? `<span class="proposal-text">${closeProposal}</span>` : ''}</div>
                        </td>
                    </tr>`;
            }
            html += `
                    </tbody>
                </table>
            </div>`;
        }
        html += `</div>`;
    }

    html += `
    <div class="footer" style="padding: 20px 40px; text-align: center; font-size: 13px; color: #777;">
        Generado por Algoritmo de Inteligencia Antigravity • Análisis Estadístico de Transacciones Reales 2025 • ${new Date().toLocaleString()}
    </div>
</div>
</body>
</html>`;

    const htmlPath = path.resolve('docs', 'reporte_ventas_apertura_cierre_2025_supervisores.html')
    fs.writeFileSync(htmlPath, html)
    console.log(`\n✅ HTML OVERWRITTEN: ${htmlPath}`)
}

run().catch(console.error)
