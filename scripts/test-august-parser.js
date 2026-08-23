const fs = require('fs');

const augustHtml = fs.readFileSync('backups/pendientes_agosto_canonical_backup.html', 'utf-8');

// August uses:
// <td class="date-cell">22-Ago-2026</td>
// <td class="time-cell">10:00 AM - 11:45 PM</td>
// <td class="hours-cell">9.5</td>
// <td><span class="mod-badge">...</span></td>
// <td><p class="desc-es">...</p><p class="desc-en">...</p></td>

const rowMatches = [...augustHtml.matchAll(/<tr>\s*<td class="date-cell">([^<]+)<\/td>\s*<td class="time-cell">([\s\S]*?)<\/td>\s*<td class="hours-cell">([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)];

console.log('August matches found:', rowMatches.length);

const parsed = rowMatches.map(m => {
    const date = m[1].trim();
    const time = m[2].replace(/<br\s*\/?>/gi, ' & ').replace(/<[^>]+>/g, '').trim();
    const hours = parseFloat(m[3].replace(/<[^>]+>/g, '').trim()) || 0;
    const badges = [...m[4].matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map(b => b[1].trim());
    
    const esMatch = m[5].match(/<p class="desc-es">([\s\S]*?)<\/p>/i);
    const enMatch = m[5].match(/<p class="desc-en">([\s\S]*?)<\/p>/i);

    const descEs = esMatch ? esMatch[1].trim() : m[5].trim();
    const descEn = enMatch ? enMatch[1].trim() : '';

    return { date, time, hours, badges, descEs, descEn };
});

console.log('Parsed August rows:', parsed.length, 'Total hours:', parsed.reduce((a,b)=>a+b.hours, 0));
console.log('Sample row:', parsed[parsed.length - 1]);
