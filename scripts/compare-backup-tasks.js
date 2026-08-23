const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 COMPARANDO TAREAS ORIGINALES EN BACKUP JUNIO VS JULIO');
console.log('═══════════════════════════════════════════════════════════════════════');

const juneBackup = fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8');
const julyBackup = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');

function extractTasks(html) {
    const titles = [...html.matchAll(/<h3 class="task-card-title[^"]*">([\s\S]*?)<\/h3>|<h3 class="task-title[^"]*">([\s\S]*?)<\/h3>|<div class="card-title[^"]*">([\s\S]*?)<\/div>/gi)];
    return titles.map(t => (t[1] || t[2] || t[3]).replace(/<[^>]+>/g, '').trim());
}

const juneTasks = extractTasks(juneBackup);
const julyTasks = extractTasks(julyBackup);

console.log(`\n📋 Tareas en Backup Junio (${juneTasks.length}):`);
juneTasks.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));

console.log(`\n📋 Tareas en Backup Julio (${julyTasks.length}):`);
julyTasks.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
