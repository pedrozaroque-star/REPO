const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 REVISANDO ESTRUCTURA ORIGINAL EN BACKUPS');
console.log('═══════════════════════════════════════════════════════════════════════');

const juneBackup = fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8');
const julyBackup = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');

function extractDatesFromTable(html) {
    const tableMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tableMatch) return [];
    const trMatches = [...tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    return trMatches.map(tr => {
        const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
        return { date: tdMatches[0], time: tdMatches[1], hours: tdMatches[2] };
    });
}

const juneDates = extractDatesFromTable(juneBackup);
const julyDates = extractDatesFromTable(julyBackup);

console.log(`\n📅 Fechas en Backup de Junio (Total: ${juneDates.length}):`);
console.log(juneDates.map(d => `${d.date} (${d.hours}h)`).join(', '));

console.log(`\n📅 Fechas en Backup de Julio (Total: ${julyDates.length}):`);
console.log(julyDates.map(d => `${d.date} (${d.hours}h)`).join(', '));
