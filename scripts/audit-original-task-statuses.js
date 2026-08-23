const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 AUDITORÍA FORENSE DE ESTATUS ORIGINALES EN BACKUP JUNIO Y JULIO');
console.log('═══════════════════════════════════════════════════════════════════════');

const juneHtml = fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8');
const julyHtml = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');

function extractOriginalTaskDetails(html, label) {
    console.log(`\n=================== ${label} ===================`);
    const cardRegex = /<div class="task-card[^"]*">([\s\S]*?)(?=<div class="task-card|<\/div>\s*<!-- End Tasks|<\/div>\s*<\/div>\s*<div class="main-footer")/gi;
    let m;
    let idx = 0;
    while ((m = cardRegex.exec(html)) !== null) {
        idx++;
        const cardHtml = m[1];
        const titleMatch = cardHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Sin título';

        const badgeMatch = cardHtml.match(/<span class="(?:task-badge|badge)[^"]*">([\s\S]*?)<\/span>/gi);
        const badges = badgeMatch ? badgeMatch.map(b => b.replace(/<[^>]+>/g, '').trim()) : [];

        const auditMatch = cardHtml.match(/<div class="audit-box[^"]*">([\s\S]*?)<\/div>/i);
        const audit = auditMatch ? auditMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 100) : '';

        console.log(`${idx}. [${title}]`);
        console.log(`   Badges: ${badges.join(' | ')}`);
        console.log(`   Audit snippet: ${audit}...`);
    }
}

extractOriginalTaskDetails(juneHtml, 'BACKUP ORIGINAL JUNIO (pendientes.html)');
extractOriginalTaskDetails(julyHtml, 'BACKUP ORIGINAL JULIO (pendientes_julio.html)');
