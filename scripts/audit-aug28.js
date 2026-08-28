const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA FORENSE MULTI-CHAT: 26 (NOCHE), 27 Y 28 DE AGOSTO 2026');
console.log('═══════════════════════════════════════════════════════════════════════');

// 1. Git status
try {
    const gitStatus = execSync('git status --short', { encoding: 'utf-8' });
    console.log('Git Status:\n', gitStatus || '(Working tree clean)');
} catch (e) {
    console.error('Git status error:', e.message);
}

// 2. Git log since Aug 26 17:00
try {
    const gitLog = execSync('git log --since="2026-08-26 17:00:00" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
    console.log('\nCommits Recientes:\n', gitLog);
} catch (e) {
    console.error('Git log error:', e.message);
}

// 3. Scan all transcripts
const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

const datesToScan = ['2026-08-26', '2026-08-27', '2026-08-28'];
const scanResults = {
    '2026-08-26_late': { convs: new Set(), userRequests: [], times: [] },
    '2026-08-27': { convs: new Set(), userRequests: [], times: [] },
    '2026-08-28': { convs: new Set(), userRequests: [], times: [] }
};

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
                    const m = step.content.match(/2026-08-(26|27|28)T(\d{2}):(\d{2}):(\d{2})/);
                    if (m) {
                        const day = m[1];
                        const hour = parseInt(m[2], 10);
                        const min = parseInt(m[3], 10);
                        const timeStr = `${m[2]}:${m[3]}`;
                        const timeVal = hour + min / 60;

                        if (day === '26' && timeVal >= 17.25) {
                            scanResults['2026-08-26_late'].convs.add(cId);
                            scanResults['2026-08-26_late'].times.push(timeStr);
                            if (step.type === 'USER_INPUT') {
                                const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                                if (clean && !scanResults['2026-08-26_late'].userRequests.includes(clean)) {
                                    scanResults['2026-08-26_late'].userRequests.push(clean);
                                }
                            }
                        } else if (day === '27') {
                            scanResults['2026-08-27'].convs.add(cId);
                            scanResults['2026-08-27'].times.push(timeStr);
                            if (step.type === 'USER_INPUT') {
                                const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                                if (clean && !scanResults['2026-08-27'].userRequests.includes(clean)) {
                                    scanResults['2026-08-27'].userRequests.push(clean);
                                }
                            }
                        } else if (day === '28') {
                            scanResults['2026-08-28'].convs.add(cId);
                            scanResults['2026-08-28'].times.push(timeStr);
                            if (step.type === 'USER_INPUT') {
                                const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                                if (clean && !scanResults['2026-08-28'].userRequests.includes(clean)) {
                                    scanResults['2026-08-28'].userRequests.push(clean);
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
        console.log(`   Muestra: ${times.slice(0, 15).join(', ')} ... ${times.slice(-5).join(', ')}`);
    }
    console.log(`🗣️ Peticiones:`);
    data.userRequests.forEach(r => console.log(`   • ${r.replace(/\n/g, ' ').slice(0, 150)}`));
}

fs.writeFileSync('scripts/aug28_scan_results.json', JSON.stringify(scanResults, null, 2), 'utf-8');
