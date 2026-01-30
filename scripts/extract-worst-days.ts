
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio'; // Hacky but standard text processing works too if cheerio not avail

const reportPath = path.resolve(process.cwd(), 'public', 'audit-report-6m.html');

function extractWorstDays() {
    if (!fs.existsSync(reportPath)) {
        console.log("No se encontró el reporte audit-report-6m.html");
        return;
    }

    const html = fs.readFileSync(reportPath, 'utf-8');

    // Simple Regex parser because we generated the HTML structure ourselves
    // Looking for rows with "bg-red-900" (which indicates > 20% error)
    // Structure: <tr> ... <td>Date</td> ... <td>Store</td> (Wait, store is in <summary>) ... </tr>

    // Actually, store name is in <h2 class="text-xl font-bold text-white">Store Name</h2>
    // And rows are under it.

    console.log("\n🚨 PEORES DÍAS (ERROR > 20%) - ÚLTIMOS 6 MESES\n");
    console.log("| Tienda | Fecha | Día | Real | Forecast | Error |");
    console.log("|---|---|---|---|---|---|");

    const storeBlocks = html.split('<details');

    storeBlocks.forEach(block => {
        // Extract Store Name
        const nameMatch = block.match(/<h2 class="text-xl font-bold text-white">([^<]+)<\/h2>/);
        if (!nameMatch) return;
        const storeName = nameMatch[1];

        // Find Red Rows
        const rows = block.split('<tr class="hover:bg-slate-800/50">');
        rows.forEach(row => {
            if (row.includes('bg-red-900')) {
                // Extract Cell Data
                const dateMatch = row.match(/<td class="px-4 py-2 font-mono text-slate-300">([^<]+)<\/td>/);
                const dayMatch = row.match(/<td class="px-4 py-2 text-slate-500">([^<]+)<\/td>/);
                const realMatch = row.match(/<td class="px-4 py-2 text-right font-medium">([^<]+)<\/td>/);
                const forecastMatch = row.match(/<td class="px-4 py-2 text-right text-slate-400">([^<]+)<\/td>/);
                const errorMatch = row.match(/<td class="px-4 py-2 text-right font-bold [^"]+">([^<]+)<\/td>/);

                if (dateMatch && errorMatch) {
                    console.log(`| ${storeName.padEnd(15)} | ${dateMatch[1]} | ${dayMatch?.[1]} | ${realMatch?.[1]} | ${forecastMatch?.[1]} | ${errorMatch[1]} 🔴 |`);
                }
            }
        });
    });
}

extractWorstDays();
