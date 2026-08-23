const fs = require('fs');

const julyHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html', 'utf-8');

// Find all section headers in task list
const lines = julyHtml.split('\n').slice(906, 1755);
let currentSection = 'Unknown';

lines.forEach((line, idx) => {
    if (line.includes('class="section-header"')) {
        console.log('\n--- SECTION HEADER ---');
    }
    if (line.includes('<h2>')) {
        currentSection = line.replace(/<[^>]+>/g, '').trim();
        console.log(`\n📌 SECCIÓN: ${currentSection}`);
    }
    if (line.includes('<h3 class="task-title">')) {
        const title = line.replace(/<[^>]+>/g, '').trim();
        console.log(`   └─ [${currentSection}] ${title}`);
    }
});
