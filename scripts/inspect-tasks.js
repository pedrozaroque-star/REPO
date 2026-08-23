const fs = require('fs');
const path = require('path');

const julyHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html', 'utf-8');

// Parse all task cards in July HTML
const taskCardRegex = /<div class="task-card"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
// Actually let's parse using regex or string splitting
const cardSplits = julyHtml.split('<div class="task-card"');
console.log(`Found ${cardSplits.length - 1} task cards in July report`);

const tasks = [];

for (let i = 1; i < cardSplits.length; i++) {
    const chunk = cardSplits[i];
    const numMatch = chunk.match(/<span class="task-number">#?(\d+)<\/span>/);
    const titleMatch = chunk.match(/<h3 class="task-title">([\s\S]*?)<\/h3>/);
    const statusMatch = chunk.match(/<span class="status-badge ([^"]+)">([\s\S]*?)<\/span>/);
    const descMatch = chunk.match(/<p class="task-description">([\s\S]*?)<\/p>/);
    
    tasks.push({
        index: i,
        number: numMatch ? numMatch[1] : i,
        title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Unknown',
        statusClass: statusMatch ? statusMatch[1] : 'unknown',
        statusText: statusMatch ? statusMatch[2].replace(/<[^>]+>/g, '').trim() : 'unknown',
        description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 100) : ''
    });
}

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📋 TAREAS EXISTENTES EN EL REPORTE INICIAL');
console.log('═══════════════════════════════════════════════════════════════════════');
tasks.forEach(t => {
    console.log(`#${t.number} [${t.statusText}] ${t.title}`);
});
