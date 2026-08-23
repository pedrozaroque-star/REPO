const fs = require('fs');
const scanData = JSON.parse(fs.readFileSync('scripts/august_forensic_scan.json', 'utf-8'));

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA PROFUNDA DE ACTIVIDADES DEL 01 AL 17 DE AGOSTO DE 2026');
console.log('═══════════════════════════════════════════════════════════════════════');

for (let d = 1; d <= 17; d++) {
    const dStr = `2026-08-${String(d).padStart(2, '0')}`;
    const scan = scanData[dStr];
    console.log(`\n📅 ${dStr}:`);
    console.log(`   Commits (${scan.commitMatches?.length || 0}):`);
    scan.commitMatches?.forEach(c => console.log(`     * [${c.time}] ${c.hash}: ${c.msg}`));
    if (scan.userRequests?.length > 0) {
        console.log(`   Peticiones (${scan.userRequests.length}):`);
        scan.userRequests.slice(0, 5).forEach(r => console.log(`     • ${r.replace(/\n/g, ' ').slice(0, 140)}`));
    }
}
