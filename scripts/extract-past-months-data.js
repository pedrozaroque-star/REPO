const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📊 EXTRACCIÓN DE FILAS HISTÓRICAS DE JUNIO Y JULIO');
console.log('═══════════════════════════════════════════════════════════════════════');

function parseTableRows(filePath, monthName) {
    const html = fs.readFileSync(filePath, 'utf-8');
    const rowMatches = [...html.matchAll(/<tr>\s*<td class="date-cell">([^<]+)<\/td>\s*<td class="time-cell">([^<]+)<\/td>\s*<td class="hours-cell">([^<]+)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)];

    console.log(`\n--- ${monthName} (${rowMatches.length} filas encontradas) ---`);
    let totalH = 0;
    const parsedRows = rowMatches.map(r => {
        const date = r[1].trim();
        const time = r[2].trim();
        const hours = parseFloat(r[3].trim());
        totalH += hours;
        
        // Extract badges
        const badges = [...r[4].matchAll(/class="mod-badge"[^>]*>([^<]+)<\/span>/g)].map(b => b[1].trim());
        
        // Extract descriptions
        const descMatch = r[5].match(/<p class="desc-es">([\s\S]*?)<\/p>/i);
        const descEs = descMatch ? descMatch[1].replace(/<br\s*\/?>/gi, ' | ').replace(/<[^>]+>/g, '').trim() : '';

        return { date, time, hours, badges, descEs };
    });

    console.log(`Total horas extraídas: ${totalH.toFixed(2)} hrs`);
    console.log('Muestra de 3 filas:', parsedRows.slice(0, 3));
    return parsedRows;
}

const juneRows = parseTableRows('pendientes.html', 'JUNIO 2026');
const julyRows = parseTableRows('pendientes_julio.html', 'JULIO 2026');
