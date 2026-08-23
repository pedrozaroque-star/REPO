const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 EXTRAYENDO TODAS LAS TARJETAS ORIGINALES DE JUNIO Y JULIO');
console.log('═══════════════════════════════════════════════════════════════════════');

function parseTaskCards(html) {
    const cards = [];
    const cardRegex = /<div class="task-card">([\s\S]*?)(?=<div class="task-card"|<\/div>\s*<!-- End Tasks|<\/div>\s*<\/div>\s*<div class="main-footer")/gi;
    let m;
    while ((m = cardRegex.exec(html)) !== null) {
        const cardHtml = m[1];
        
        // Extract title
        const titleMatch = cardHtml.match(/<h3 class="task-title">([\s\S]*?)<\/h3>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        // Extract badges
        const badgeComplete = cardHtml.includes('badge completed') || cardHtml.includes('badge complete') || cardHtml.includes('Completado');
        const badgeProgress = cardHtml.includes('badge in-progress') || cardHtml.includes('badge progress') || cardHtml.includes('En Progreso');
        const badgePending = cardHtml.includes('badge pending') || cardHtml.includes('Pendiente');

        let status = 'pendiente';
        let statusLabel = '⏳ Pendiente';
        if (badgeComplete) {
            status = 'completado';
            statusLabel = '✓ Completado';
        } else if (badgeProgress) {
            status = 'progreso';
            statusLabel = '⚡ En Progreso';
        }

        // Category
        const catMatch = cardHtml.match(/<span class="badge-cat[^"]*">([\s\S]*?)<\/span>/i);
        const category = catMatch ? catMatch[1].replace(/<[^>]+>/g, '').trim() : 'Operaciones';

        // Audit box
        const auditMatch = cardHtml.match(/<div class="audit-box">([\s\S]*?)<\/div>/i);
        const audit = auditMatch ? auditMatch[1].trim() : '';

        // Steps
        const steps = [...cardHtml.matchAll(/<div class="step-item">[\s\S]*?<span class="step-text">([\s\S]*?)<\/span>[\s\S]*?<\/div>/gi)].map(s => s[1].replace(/<[^>]+>/g, '').trim());

        // Extract task number
        const numMatch = title.match(/^(\d+)\./);
        const num = numMatch ? parseInt(numMatch[1], 10) : cards.length + 1;

        cards.push({
            num,
            title,
            category,
            status,
            statusLabel,
            audit,
            steps
        });
    }
    return cards;
}

const juneCards = parseTaskCards(fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8'));
const julyCards = parseTaskCards(fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8'));

console.log(`Tarjetas extraídas de Junio: ${juneCards.length}`);
juneCards.sort((a,b) => a.num - b.num).forEach(c => console.log(`  ${c.num}. ${c.title} -> [${c.statusLabel}]`));

console.log(`\nTarjetas extraídas de Julio: ${julyCards.length}`);
julyCards.sort((a,b) => a.num - b.num).forEach(c => console.log(`  ${c.num}. ${c.title} -> [${c.statusLabel}]`));

fs.writeFileSync('scripts/parsed-june-tasks.json', JSON.stringify(juneCards, null, 2), 'utf-8');
fs.writeFileSync('scripts/parsed-july-tasks.json', JSON.stringify(julyCards, null, 2), 'utf-8');
