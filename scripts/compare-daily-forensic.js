const fs = require('fs');

const scanData = JSON.parse(fs.readFileSync('scripts/august_forensic_scan.json', 'utf-8'));
const buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');
const augustConfigMatch = buildScript.match(/const augustRows = (\[[\s\S]*?\]);/);
const augustRows = eval(augustConfigMatch[1]);

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 COMPARACIÓN DÍA POR DÍA: REPORTE ACTUAL VS REALIDAD DETECTADA EN CHATS Y COMMITS');
console.log('═══════════════════════════════════════════════════════════════════════');

for (let d = 1; d <= 23; d++) {
    const dStr = `2026-08-${String(d).padStart(2, '0')}`;
    const dateFormatted = `${String(d).padStart(2, '0')}-Ago-2026`;
    const reportRow = augustRows.find(r => r.date === dateFormatted);
    const scan = scanData[dStr] || { conversations: [], commitMatches: [], userRequests: [], timeRanges: [] };

    console.log(`\n📅 ${dateFormatted} (${dStr}):`);
    console.log(`  Reporte Actual: ${reportRow ? `${reportRow.hours}h | ${reportRow.time} | Badges: [${reportRow.badges.join(', ')}]` : '❌ NO ESTÁ EN EL REPORTE'}`);
    console.log(`  Realidad Detectada:`);
    console.log(`    - Chats involucrados: ${scan.conversations ? (Array.isArray(scan.conversations) ? scan.conversations.length : Object.keys(scan.conversations).length) : 0}`);
    console.log(`    - Commits: ${scan.commitMatches?.length || 0}`);
    if (scan.commitMatches?.length > 0) {
        scan.commitMatches.forEach(c => console.log(`      * [${c.time}] ${c.hash}: ${c.msg}`));
    }
    if (scan.userRequests?.length > 0) {
        console.log(`    - Peticiones clave (${scan.userRequests.length}):`);
        scan.userRequests.slice(0, 4).forEach(r => console.log(`      • ${r.replace(/\n/g, ' ').slice(0, 120)}`));
    }
}
