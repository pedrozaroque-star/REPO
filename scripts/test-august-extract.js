const fs = require('fs');

const augustHtml = fs.readFileSync('backups/pendientes_agosto_backup_1787468372401.html', 'utf-8');

// Find table in August backup
const tableMatch = augustHtml.match(/<table class="hours-table">([\s\S]*?)<\/table>/i);
console.log('Table found:', !!tableMatch);

if (tableMatch) {
    const rowsHtml = tableMatch[1];
    const trMatches = [...rowsHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
    console.log('Total tr matches:', trMatches.length);

    const parsed = [];
    trMatches.forEach(tr => {
        const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].trim());
        if (tdMatches.length >= 5) {
            const date = tdMatches[0].replace(/<[^>]+>/g, '').trim();
            const time = tdMatches[1].replace(/<br\s*\/?>/gi, ' & ').replace(/<[^>]+>/g, '').trim();
            const hours = parseFloat(tdMatches[2].replace(/<[^>]+>/g, '').trim()) || 0;
            const badges = [...tdMatches[3].matchAll(/<span[^>]*>([^<]+)<\/span>/gi)].map(b => b[1].trim());
            
            const esMatch = tdMatches[4].match(/<div class="es-desc">([\s\S]*?)<\/div>/i) || tdMatches[4].match(/<p class="desc-es">([\s\S]*?)<\/p>/i);
            const enMatch = tdMatches[4].match(/<div class="en-desc">([\s\S]*?)<\/div>/i) || tdMatches[4].match(/<p class="desc-en">([\s\S]*?)<\/p>/i);

            const descEs = esMatch ? esMatch[1].trim() : tdMatches[4];
            const descEn = enMatch ? enMatch[1].trim() : '';

            parsed.push({ date, time, hours, badges, descEs, descEn });
        }
    });

    console.log('Parsed rows count:', parsed.length);
    console.log('Total hours in August table:', parsed.reduce((a,b)=>a+b.hours,0));
    console.log('First row:', parsed[0]);
    console.log('Last row:', parsed[parsed.length - 1]);
}
