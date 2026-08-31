const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA FORENSE MULTI-CHAT: 28 AL 31 DE AGOSTO DE 2026');
console.log('═══════════════════════════════════════════════════════════════════════');

// 1. Git status
try {
    const gitStatus = execSync('git status --short', { encoding: 'utf-8' });
    console.log('Git Status:\n', gitStatus || '(Working tree clean)');
} catch (e) {
    console.error('Git status error:', e.message);
}

// 2. Git log since Aug 28 09:00
try {
    const gitLog = execSync('git log --since="2026-08-28 09:00:00" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
    console.log('\nCommits Recientes:\n', gitLog);
} catch (e) {
    console.error('Git log error:', e.message);
}

// 3. Scan all transcripts
const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

const datesToScan = ['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31'];
const scanResults = {};
datesToScan.forEach(d => {
    scanResults[d] = { convs: new Set(), userRequests: [], times: [] };
});

convDirs.forEach(cId => {
    const transcriptPath = path.join(brainDir, cId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;

    try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
        lines.forEach(l => {
            if (!l.trim()) return;
            try {
                const step = JSON.parse(l);
                if (step.content) {
                    const m = step.content.match(/2026-08-(28|29|30|31)T(\d{2}):(\d{2}):(\d{2})/);
                    if (m) {
                        const dayKey = `2026-08-${m[1]}`;
                        const timeStr = `${m[2]}:${m[3]}`;
                        if (scanResults[dayKey]) {
                            scanResults[dayKey].convs.add(cId);
                            scanResults[dayKey].times.push(timeStr);
                            if (step.type === 'USER_INPUT') {
                                const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                                if (clean && !scanResults[dayKey].userRequests.includes(clean)) {
                                    scanResults[dayKey].userRequests.push(clean);
                                }
                            }
                        }
                    }
                }
            } catch {}
        });
    } catch {}
});

for (const [key, data] of Object.entries(scanResults)) {
    const times = [...new Set(data.times)].sort();
    console.log(`\n📅 ${key} (${data.convs.size} convs, ${data.userRequests.length} peticiones):`);
    if (times.length > 0) {
        console.log(`⏰ Horas detectadas: ${times[0]} a ${times[times.length - 1]} (${times.length} puntos)`);
        console.log(`   Muestra: ${times.slice(0, 10).join(', ')} ... ${times.slice(-5).join(', ')}`);
    }
    console.log(`🗣️ Peticiones:`);
    data.userRequests.forEach(r => console.log(`   • ${r.replace(/\n/g, ' ').slice(0, 150)}`));
}

fs.writeFileSync('scripts/aug31_scan_results.json', JSON.stringify(scanResults, null, 2), 'utf-8');
