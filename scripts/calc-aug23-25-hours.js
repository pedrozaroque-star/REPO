const fs = require('fs');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('⏱️ CÁLCULO FORENSE DE HORAS: 23, 24 Y 25 DE AGOSTO');
console.log('═══════════════════════════════════════════════════════════════════════');

// Check commits for 23, 24, 25
const gitLog = execSync('git log --since="2026-08-23 00:00:00" --until="2026-08-25 23:59:59" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
console.log('Commits:\n', gitLog);

// Let's examine the raw timePoints from aug23_25_scan.json
const scan = JSON.parse(fs.readFileSync('scripts/aug23_25_scan.json', 'utf-8'));

for (const [date, data] of Object.entries(scan)) {
    const times = [...new Set(data.timePoints)].sort();
    console.log(`\n📅 ${date}:`);
    console.log(`  Horas detectadas en chats: ${times[0]} a ${times[times.length - 1]} (${times.length} puntos)`);
    console.log(`  Muestra de horas: ${times.join(', ')}`);
}
