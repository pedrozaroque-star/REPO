const fs = require('fs');

const june = fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8');
const july = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');
const august = fs.readFileSync('backups/pendientes_agosto_backup_1787468372401.html', 'utf-8');

console.log('June cards count (.task-card):', (june.match(/class="task-card"/g) || []).length);
console.log('July cards count (.task-card):', (july.match(/class="task-card"/g) || []).length);
console.log('August cards count (.task-card):', (august.match(/class="task-card"/g) || []).length);

// Let's find what container has them in August
const augustCardMatches = [...august.matchAll(/<div class="task-card[^"]*">([\s\S]*?)<\/div>\s*<\/div>/gi)];
console.log('August matchAll task-card count:', augustCardMatches.length);
