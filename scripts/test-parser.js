const fs = require('fs');

function parseLegacyTable(filePath) {
    const html = fs.readFileSync(filePath, 'utf-8');
    const tableBodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tableBodyMatch) return [];

    const rowsHtml = tableBodyMatch[1];
    const trMatches = [...rowsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    const rows = [];
    trMatches.forEach(tr => {
        const trContent = tr[1];
        const tdMatches = [...trContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].trim());
        if (tdMatches.length >= 5) {
            const dateRaw = tdMatches[0].replace(/<[^>]+>/g, '').trim();
            const timeRaw = tdMatches[1].replace(/<br\s*\/?>/gi, ' & ').replace(/<[^>]+>/g, '').trim();
            const hoursRaw = parseFloat(tdMatches[2].replace(/<[^>]+>/g, '').trim()) || 0;
            
            // Extract badges
            const badges = [...tdMatches[3].matchAll(/<span[^>]*>([^<]+)<\/span>/gi)].map(b => b[1].trim());
            
            // Extract descriptions
            const esMatch = tdMatches[4].match(/<div class="es-desc">([\s\S]*?)<\/div>/i) || tdMatches[4].match(/<p class="desc-es">([\s\S]*?)<\/p>/i);
            const enMatch = tdMatches[4].match(/<div class="en-desc">([\s\S]*?)<\/div>/i) || tdMatches[4].match(/<p class="desc-en">([\s\S]*?)<\/p>/i);

            const descEs = esMatch ? esMatch[1].trim() : tdMatches[4];
            const descEn = enMatch ? enMatch[1].trim() : '';

            rows.push({
                date: dateRaw,
                time: timeRaw,
                hours: hoursRaw,
                badges: badges.length ? badges : ['Sistema'],
                descEs,
                descEn
            });
        }
    });

    return rows;
}

const juneRows = parseLegacyTable('pendientes.html');
const julyRows = parseLegacyTable('pendientes_julio.html');

console.log('✅ June rows parsed:', juneRows.length, 'Total hours:', juneRows.reduce((a,b)=>a+b.hours, 0));
console.log('✅ July rows parsed:', julyRows.length, 'Total hours:', julyRows.reduce((a,b)=>a+b.hours, 0));

console.log('\n--- June Sample ---', juneRows[0]);
console.log('\n--- July Sample ---', julyRows[0]);
