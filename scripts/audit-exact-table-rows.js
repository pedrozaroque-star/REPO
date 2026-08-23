const fs = require('fs');

const html = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

// Parse all table rows from the monthly report table
const rowRegex = /<tr>\s*<td><strong>(.*?)<\/strong><\/td>\s*<td>(.*?)<\/td>\s*<td style="text-align: center; font-weight: 700;">([\d\.]+)<\/td>\s*<td>(.*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;

let match;
const parsedRows = [];
let totalTableHours = 0;

while ((match = rowRegex.exec(html)) !== null) {
    const date = match[1].trim();
    const timeRange = match[2].trim();
    const hours = parseFloat(match[3].trim());
    const modules = match[4].replace(/<[^>]+>/g, ' ').trim();
    const desc = match[5].replace(/<[^>]+>/g, ' ').trim().substring(0, 80);
    
    totalTableHours += hours;
    parsedRows.push({ date, timeRange, hours, modules, desc });
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log(`📊 TOTAL FILAS ENCONTRADAS EN LA TABLA: ${parsedRows.length}`);
console.log(`⏱️ SUMA TOTAL DE HORAS EN TABLA DE ACTIVIDADES: ${totalTableHours.toFixed(2)} hrs`);
console.log('═══════════════════════════════════════════════════════════════════');

// Group by Date
const byDate = {};
parsedRows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { hours: 0, ranges: [], rowsCount: 0 };
    byDate[r.date].hours += r.hours;
    byDate[r.date].ranges.push(`${r.timeRange} (${r.hours}h)`);
    byDate[r.date].rowsCount++;
});

console.log('\n📅 DESGLOSE EXACTO POR DÍA REGISTRADO EN EL REPORTE:');
Object.keys(byDate).sort().forEach(d => {
    console.log(`• ${d.padEnd(14)}: ${byDate[d].hours.toFixed(2)} hrs [${byDate[d].rowsCount} sesiones] -> ${byDate[d].ranges.join(' | ')}`);
});
