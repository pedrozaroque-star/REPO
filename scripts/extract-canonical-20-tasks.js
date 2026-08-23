const fs = require('fs');

const julyBackup = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');

// Match task cards in july backup
const cardMatches = [...julyBackup.matchAll(/<div class="task-card[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)];
console.log(`Found ${cardMatches.length} raw card matches in July backup.`);

// Let's print each task title and status
const tasksRegex = /<div class="task-card[^"]*">([\s\S]*?)(?=<div class="task-card|<\/div>\s*<!-- End Tasks)/gi;
let m;
let count = 0;
while ((m = tasksRegex.exec(julyBackup)) !== null) {
    count++;
    const cardHtml = m[1];
    const titleMatch = cardHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'No title';
    console.log(`${count}. ${title}`);
}
