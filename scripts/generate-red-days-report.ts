
import fs from 'fs';
import path from 'path';

const inputPath = path.resolve(process.cwd(), 'public', 'audit-report-6m.html');
const outputPath = path.resolve(process.cwd(), 'public', 'red-days-report.html');

function generateRedDaysHtml() {
    if (!fs.existsSync(inputPath)) {
        console.log("No source report found.");
        return;
    }

    const htmlContent = fs.readFileSync(inputPath, 'utf-8');
    const storeBlocks = htmlContent.split('<details');

    let rowsHtml = '';
    let totalRedDays = 0;

    storeBlocks.forEach(block => {
        const nameMatch = block.match(/<h2 class="text-xl font-bold text-white">([^<]+)<\/h2>/);
        if (!nameMatch) return;
        const storeName = nameMatch[1];

        const rows = block.split('<tr class="hover:bg-slate-800/50">');
        rows.forEach(row => {
            if (row.includes('bg-red-900')) {
                // Inject Store Name column for the consolidated view
                const newRow = row.replace(
                    '<td class="px-4 py-2 font-mono text-slate-300">',
                    `<td class="px-4 py-2 font-bold text-white">${storeName}</td><td class="px-4 py-2 font-mono text-slate-300">`
                );
                rowsHtml += `<tr class="hover:bg-slate-800/50 border-b border-slate-800">${newRow}</tr>`;
                totalRedDays++;
            }
        });
    });

    const finalHtml = `
    <!DOCTYPE html>
    <html lang="es" class="dark">
    <head>
        <meta charset="UTF-8">
        <title>Red Days Report</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #e2e8f0; }</style>
    </head>
    <body class="p-10 max-w-5xl mx-auto">
        <h1 class="text-3xl font-bold text-red-500 mb-2">🚨 Red Days Report (>20% Error)</h1>
        <p class="text-slate-400 mb-8">Period: Aug 2025 - Jan 2026 • Found ${totalRedDays} critical deviations.</p>

        <div class="bg-slate-900/50 rounded-xl border border-red-900/30 overflow-hidden">
            <table class="w-full text-sm text-left">
                <thead class="text-xs text-slate-400 uppercase bg-slate-900">
                    <tr>
                        <th class="px-4 py-3">Store</th>
                        <th class="px-4 py-3">Date</th>
                        <th class="px-4 py-3">Day</th>
                        <th class="px-4 py-3 text-right">Real</th>
                        <th class="px-4 py-3 text-right">Forecast</th>
                        <th class="px-4 py-3 text-right">Error %</th>
                        <th class="px-4 py-3 text-center">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-800">
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    </body>
    </html>
    `;

    fs.writeFileSync(outputPath, finalHtml);
    console.log(`\n🔴 REPORTE DE ERRORES GENERADO: ${outputPath}`);
}

generateRedDaysHtml();
