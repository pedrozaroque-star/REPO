
import * as fs from 'fs';
import * as path from 'path';

const csvPath = path.resolve('docs', 'promedios_apertura_cierre_2025_con_supervisor.csv');
const htmlPath = path.resolve('docs', 'reporte_ventas_apertura_cierre_2025_supervisores.html');

// Helper to format currency
const formatMoney = (val: string) => {
    const num = parseFloat(val);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

// Updated intensity logic
const getIntensityClass = (val: string) => {
    const num = parseFloat(val);
    if (num >= 800) return 'high-intensity';
    if (num >= 500) return 'medium-intensity';
    if (num < 250) return 'low-intensity'; // Changed as per previous request
    return '';
}

// LOGIC FOR PROPOSALS
const getOpeningProposal = (time: string, sales: string) => {
    const amount = parseFloat(sales);
    // Logic: If opening sales < 350, propose opening 1 hour later
    if (amount < 350) {
        let [hours, modifier] = time.split(' ');
        let [h, m] = hours.split(':');
        let hour = parseInt(h);

        // Convert to 24h
        if (modifier === 'PM' && hour !== 12) hour += 12;
        if (modifier === 'AM' && hour === 12) hour = 0;

        // Add 1 hour
        let newHour = hour + 1;

        // Convert back to 12h
        let newModifier = newHour >= 12 ? 'PM' : 'AM';
        let displayHour = newHour > 12 ? newHour - 12 : newHour;
        if (displayHour === 0) displayHour = 12;
        if (newHour === 12) displayHour = 12;

        return `${displayHour}:00 ${newModifier}`;
    }
    return ''; // No change
}

const getClosingProposal = (time: string, sales: string) => {
    const amount = parseFloat(sales);
    // Logic: If closing sales < 350, propose closing 1 hour earlier
    if (amount < 350) {
        // Parse time to subtract 1 hour
        // Formats: "12:00 AM", "1:00 AM", "10:00 PM"
        let [hours, modifier] = time.split(' ');
        let [h, m] = hours.split(':');
        let hour = parseInt(h);

        // Convert to 24h for math
        if (modifier === 'PM' && hour !== 12) hour += 12;
        if (modifier === 'AM' && hour === 12) hour = 0;

        // Subtract 1 hour
        let newHour = hour - 1;
        if (newHour < 0) newHour = 23;

        // Convert back to 12h
        let newModifier = newHour >= 12 ? 'PM' : 'AM';
        let displayHour = newHour % 12;
        if (displayHour === 0) displayHour = 12;

        return `${displayHour}:00 ${newModifier}`;
    }
    return ''; // No change
}

try {
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const lines = csvData.trim().split('\n');
    lines.shift(); // remove header

    // Structure: Supervisor -> Store -> Rows
    const supervisors: Record<string, Record<string, any[]>> = {};

    lines.forEach(line => {
        const cols = line.split(';');
        if (cols.length < 7) return;

        const storeName = cols[0];
        const supervisor = cols[1];

        if (!supervisors[supervisor]) supervisors[supervisor] = {};
        if (!supervisors[supervisor][storeName]) supervisors[supervisor][storeName] = [];

        supervisors[supervisor][storeName].push({
            day: cols[2],
            openTime: cols[3],
            openSales: cols[4],
            closeTime: cols[5],
            closeSales: cols[6]
        });
    });

    // HTML Template - Based on the ORIGINAL file as requested
    let html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reporte de Ventas por Supervisor: Apertura vs Cierre 2025</title>
    <style>
        :root {
            --primary: #D32F2F;
            --dark: #212121;
            --light: #F5F5F5;
            --grey: #9E9E9E;
            --border: #E0E0E0;
            --highlight-high: #E8F5E9; /* Green tint */
            --highlight-low: #FFEBEE; /* Red tint */
            --text-high: #2E7D32;
            --text-low: #C62828;
            --proposal-color: #0288D1; /* Blue for proposals */
            --proposal-bg: #E1F5FE;
        }
        
        body {
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #F9FAFB;
            color: #333;
            margin: 0;
            padding: 40px;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1400px; /* Wider to accommodate new columns */
            margin: 0 auto;
            background: white;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            border-radius: 8px;
            overflow: hidden;
        }
        
        header {
            background-color: var(--dark);
            color: white;
            padding: 30px 40px;
            border-bottom: 4px solid var(--primary);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .subtitle { opacity: 0.8; font-size: 14px; margin-top: 5px; }
        
        .summary-card {
            padding: 20px 40px;
            background-color: white;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .supervisor-section {
            padding: 20px 40px;
            border-bottom: 4px solid #f0f0f0;
        }
        
        .supervisor-header {
            background-color: var(--primary);
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            font-size: 18px;
            font-weight: 700;
            margin-top: 20px;
            margin-bottom: 20px;
            display: inline-block;
        }

        .store-block {
            margin-bottom: 40px;
        }
        
        .store-header {
            display: flex;
            align-items: center;
            margin-top: 10px;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--border);
        }
        
        .store-title {
            font-size: 18px;
            font-weight: 700;
            color: var(--dark);
            margin: 0;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        
        th {
            text-align: left;
            padding: 12px 16px;
            background-color: #f5f5f5;
            color: #666;
            font-weight: 600;
            border-bottom: 1px solid #ddd;
        }
        
        td {
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
        }
        
        tr:last-child td { border-bottom: none; }
        
        .money { font-family: 'Consolas', monospace; font-weight: 600; }
        .time { color: #555; }
        
        /* Intensity Formatting */
        .high-intensity { color: var(--text-high); background-color: var(--highlight-high); }
        .medium-intensity { color: #1565C0; background-color: #E3F2FD; }
        .low-intensity { color: var(--text-low); background-color: var(--highlight-low); font-weight: bold; }
        
        .proposal-text {
            color: var(--proposal-color);
            background-color: var(--proposal-bg);
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 4px;
            border: 1px dashed var(--proposal-color);
        }
        
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 700;
        }
        
        .footer {
            background-color: #f9f9f9;
            padding: 20px 40px;
            text-align: center;
            font-size: 12px;
            color: #888;
            border-top: 1px solid var(--border);
        }
        
        .print-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
        }

        /* Input specific styles */
        .input-cell {
            background-color: #fafafa;
            border-left: 2px solid #eee;
        }
        
        .input-box {
            border: 1px solid #ddd;
            background: white;
            min-height: 24px;
            width: 100%;
            border-radius: 2px;
            padding: 2px 5px;
            font-size: 13px;
        }

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
            <h1>Análisis de Ventas por Supervisor: Apertura vs Cierre</h1>
            <div class="subtitle">Promedios Anuales 2025 • Basado en Horarios Oficiales (Matriz Estricta)</div>
        </div>
        <button class="print-btn" onclick="window.print()">🖨️ Imprimir PDF</button>
    </header>

    <div class="summary-card">
        <div>
            <p><strong>Metodología:</strong> Promedio de Ventas Netas ($) de 2025 para la primera y última hora oficial de operación.</p>
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

    // 1. Sort Supervisors
    const sortedSupervisors = Object.keys(supervisors).sort();

    sortedSupervisors.forEach(supervisorName => {
        html += `
        <div class="supervisor-section">
            <div class="supervisor-header">👮‍♂️ Supervisor: ${supervisorName}</div>
        `;

        // 2. Sort Stores within Supervisor
        const storesMap = supervisors[supervisorName];
        const sortedStores = Object.keys(storesMap).sort();

        sortedStores.forEach(storeName => {
            const rows = storesMap[storeName];

            html += `
            <div class="store-block">
                <div class="store-header">
                    <h2 class="store-title">🏪 ${storeName}</h2>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 10%">Día</th>
                            <th style="width: 12%">Hora Apertura</th>
                            <th style="width: 12%">Venta Promedio</th>
                            
                            <th style="width: 12%">Hora Cierre</th>
                            <th style="width: 12%">Venta Promedio</th>
                            
                            <!-- NEW COLUMNS -->
                            <th style="width: 20%; border-left: 2px solid #ddd;">📝 Propuesta Apertura</th>
                            <th style="width: 20%">📝 Propuesta Cierre</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            rows.forEach(row => {
                const openClass = getIntensityClass(row.openSales);
                const closeClass = getIntensityClass(row.closeSales);

                const openProposal = getOpeningProposal(row.openTime, row.openSales);
                const closeProposal = getClosingProposal(row.closeTime, row.closeSales);

                html += `
                    <tr>
                        <td><strong>${row.day}</strong></td>
                        <td class="time">${row.openTime}</td>
                        <td class="money ${openClass}">${formatMoney(row.openSales)}</td>
                        
                        <td class="time">${row.closeTime}</td>
                        <td class="money ${closeClass}">${formatMoney(row.closeSales)}</td>
                        
                        <!-- NEW COLUMN CELLS -->
                        <td class="input-cell">
                            <div class="input-box" contenteditable="true">${openProposal ? `<span class="proposal-text">${openProposal}</span>` : ''}</div>
                        </td>
                        <td class="input-cell" style="border-left: 1px solid #eee;">
                            <div class="input-box" contenteditable="true">${closeProposal ? `<span class="proposal-text">${closeProposal}</span>` : ''}</div>
                        </td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
            </div>
            `;
        });

        html += `</div>`; // End Supervisor Section
    });

    html += `
    <div class="footer">
        Generado por Antigravity • Tacos Gavilán Intelligence System v4.0 • ${new Date().toLocaleDateString()}
    </div>
</div>

</body>
</html>
`;

    fs.writeFileSync(htmlPath, html);
    console.log(`✅ HTML generado en: ${htmlPath}`);

} catch (err) {
    console.error('❌ Error generando HTML:', err);
}
