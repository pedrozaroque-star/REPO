const fs = require('fs');

const julyBackupHtml = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');
const julyTableMatch = julyBackupHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
let pureJulyHours = 0;
const pureJulyRows = [];

if (julyTableMatch) {
    const trMatches = [...julyTableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    trMatches.forEach(tr => {
        const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].trim());
        if (tdMatches.length >= 5) {
            const date = tdMatches[0].replace(/<[^>]+>/g, '').trim();
            if (date.includes('Jul')) {
                const hours = parseFloat(tdMatches[2].replace(/<[^>]+>/g, '').trim()) || 0;
                pureJulyHours += hours;
                pureJulyRows.push({ date, hours });
            }
        }
    });
}

console.log('Pure July Rows Count:', pureJulyRows.length);
console.log('Pure July Hours Sum:', pureJulyHours);
pureJulyRows.forEach(r => console.log(`  ${r.date}: ${r.hours}h`));
