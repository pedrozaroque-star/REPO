const fs = require('fs');

const julyBackup = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');

// Match each task card precisely
const cards = [];
const cardRegex = /<div class="task-card[^"]*">([\s\S]*?)(?=<div class="task-card|<\/div>\s*<!-- End Tasks|<\/div>\s*<\/div>\s*<div class="main-footer")/gi;

let m;
while ((m = cardRegex.exec(julyBackup)) !== null) {
    const html = m[1];
    const titleMatch = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    
    const catMatch = html.match(/<span class="badge badge-sys[^"]*">([\s\S]*?)<\/span>|<span class="task-badge badge-sys[^"]*">([\s\S]*?)<\/span>/i);
    const category = catMatch ? (catMatch[1] || catMatch[2]).replace(/<[^>]+>/g, '').trim() : '';

    const deptMatch = html.match(/<span class="badge" style="[^"]*background:\s*#f1f5f9[^"]*">([\s\S]*?)<\/span>|<span class="task-badge badge-dept">([\s\S]*?)<\/span>/i);
    const dept = deptMatch ? (deptMatch[1] || deptMatch[2]).replace(/<[^>]+>/g, '').trim() : '💻 Sistemas';

    const statusMatch = html.match(/<span class="badge ([^"]+)"[^>]*>([\s\S]*?)<\/span>|<span class="task-badge ([^"]+)">([\s\S]*?)<\/span>/i);
    const statusLabel = statusMatch ? (statusMatch[2] || statusMatch[4]).replace(/<[^>]+>/g, '').trim() : '';

    const auditMatch = html.match(/<div class="audit-box[^"]*">([\s\S]*?)<\/div>/i);
    const audit = auditMatch ? auditMatch[1].trim() : '';

    const steps = [...html.matchAll(/<div class="step-item">[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<\/div>|<li class="task-step-item">[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<\/li>/gi)].map(s => (s[1] || s[2]).replace(/<[^>]+>/g, '').trim());

    cards.push({
        title,
        category: category || 'Sistema',
        dept: dept || '💻 Sistemas',
        statusLabel,
        audit,
        steps
    });
}

console.log(`Extracted ${cards.length} cards.`);
fs.writeFileSync('scripts/extracted-july-canonical-tasks.json', JSON.stringify(cards, null, 2), 'utf-8');
console.log('Saved to scripts/extracted-july-canonical-tasks.json');
