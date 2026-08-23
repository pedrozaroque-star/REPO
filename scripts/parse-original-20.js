const fs = require('fs');

const julyHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html', 'utf-8');

// Parse the exact 20 task cards from July
const cardRegex = /<div class="task-card"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
// Extract all cards
const parts = julyHtml.split('<div class="task-card"');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📜 LAS 20 TAREAS ORIGINALES Y CANÓNICAS DE CARLOS EN JULIO');
console.log('═══════════════════════════════════════════════════════════════════════');

const original20 = [];

for (let i = 1; i < parts.length; i++) {
    const raw = '<div class="task-card"' + parts[i];
    const num = raw.match(/<span class="task-number">#?(\d+)<\/span>/);
    const title = raw.match(/<h3 class="task-title">([\s\S]*?)<\/h3>/);
    const status = raw.match(/<span class="status-badge ([^"]+)">([\s\S]*?)<\/span>/);
    const desc = raw.match(/<p class="task-description">([\s\S]*?)<\/p>/);
    const audit = raw.match(/<div class="task-audit-box">([\s\S]*?)<\/div>/);
    
    original20.push({
        num: num ? num[1] : i,
        title: title ? title[1].trim() : '',
        statusClass: status ? status[1] : '',
        statusText: status ? status[2].trim() : '',
        desc: desc ? desc[1].trim() : '',
        audit: audit ? audit[1].trim() : '',
        raw
    });
    
    console.log(`[#${num ? num[1] : i}] ${title ? title[1].trim() : ''}`);
    console.log(`    Status anterior en Julio: ${status ? status[2].trim() : ''}`);
}
