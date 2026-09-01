const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA FORENSE MULTI-CHAT: 31 DE AGOSTO DE 2026 (13:30 A 23:35)');
console.log('═══════════════════════════════════════════════════════════════════════');

// 1. Git status
try {
    const gitStatus = execSync('git status --short', { encoding: 'utf-8' });
    console.log('Git Status:\n', gitStatus || '(Working tree clean)');
} catch (e) {
    console.error('Git status error:', e.message);
}

// 2. Git log since Aug 31 13:30
try {
    const gitLog = execSync('git log --since="2026-08-31 13:30:00" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
    console.log('\nCommits Recientes:\n', gitLog);
} catch (e) {
    console.error('Git log error:', e.message);
}

// 3. Scan all transcripts
const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

const lateResults = { convs: new Set(), userRequests: [], times: [] };

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
                    const m = step.content.match(/2026-08-31T(\d{2}):(\d{2}):(\d{2})/);
                    if (m) {
                        const hour = parseInt(m[1], 10);
                        const min = parseInt(m[2], 10);
                        const timeStr = `${m[1]}:${m[2]}`;
                        const timeVal = hour + min / 60;

                        if (timeVal >= 13.5) {
                            lateResults.convs.add(cId);
                            lateResults.times.push(timeStr);
                            if (step.type === 'USER_INPUT') {
                                const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                                if (clean && !lateResults.userRequests.includes(clean)) {
                                    lateResults.userRequests.push(clean);
                                }
                            }
                        }
                    }
                }
            } catch {}
        });
    } catch {}
});

const times = [...new Set(lateResults.times)].sort();
console.log(`\n📅 2026-08-31 (Tarde/Noche) (${lateResults.convs.size} convs, ${lateResults.userRequests.length} peticiones):`);
if (times.length > 0) {
    console.log(`⏰ Horas detectadas: ${times[0]} a ${times[times.length - 1]} (${times.length} puntos)`);
    console.log(`   Puntos: ${times.join(', ')}`);
}
console.log(`🗣️ Peticiones:`);
lateResults.userRequests.forEach(r => console.log(`   • ${r.replace(/\n/g, ' ').slice(0, 150)}`));

fs.writeFileSync('scripts/aug31_late_scan_results.json', JSON.stringify(lateResults, null, 2), 'utf-8');
