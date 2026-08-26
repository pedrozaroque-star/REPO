const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA FORENSE MULTI-CHAT: 23, 24 Y 25 DE AGOSTO DE 2026');
console.log('═══════════════════════════════════════════════════════════════════════');

// 1. Check all git commits from August 23 onwards
try {
    const gitLog = execSync('git log --since="2026-08-23 00:00:00" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
    console.log('Commits (23-25 Ago):\n', gitLog);
} catch (e) {
    console.error('Git log error:', e.message);
}

// 2. Scan all conversation transcripts in brain
const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

const datesToScan = ['2026-08-23', '2026-08-24', '2026-08-25'];
const scanResults = {};

datesToScan.forEach(d => {
    scanResults[d] = {
        conversations: new Set(),
        userRequests: [],
        toolFilesTouched: new Set(),
        timePoints: []
    };
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
                let timeMatch = null;
                if (step.content) {
                    const m = step.content.match(/2026-08-(23|24|25)T(\d{2}):(\d{2}):(\d{2})/);
                    if (m) {
                        const dayKey = `2026-08-${m[1]}`;
                        const timeStr = `${m[2]}:${m[3]}`;
                        scanResults[dayKey].conversations.add(cId);
                        scanResults[dayKey].timePoints.push(timeStr);
                        if (step.type === 'USER_INPUT') {
                            const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                            if (clean && !scanResults[dayKey].userRequests.includes(clean)) {
                                scanResults[dayKey].userRequests.push(clean);
                            }
                        }
                    }
                }
                if (step.tool_calls) {
                    step.tool_calls.forEach(tc => {
                        const target = tc.parameters?.TargetFile || tc.parameters?.AbsolutePath;
                        if (target && typeof target === 'string') {
                            // Find dayKey if any
                            datesToScan.forEach(d => {
                                if (JSON.stringify(tc).includes(d) || l.includes(d)) {
                                    scanResults[d].toolFilesTouched.add(target);
                                }
                            });
                        }
                    });
                }
            } catch {}
        });
    } catch {}
});

datesToScan.forEach(d => {
    const res = scanResults[d];
    console.log(`\n═══════════════════════════════════════════════════════════════════════`);
    console.log(`📅 FECHA: ${d} (${res.conversations.size} conversaciones detectadas | ${res.timePoints.length} eventos)`);
    console.log(`═══════════════════════════════════════════════════════════════════════`);
    if (res.timePoints.length > 0) {
        const sorted = [...new Set(res.timePoints)].sort();
        console.log(`⏰ Rango de horas detectado: ${sorted[0]} a ${sorted[sorted.length - 1]}`);
        console.log(`   Puntos de tiempo: ${sorted.join(', ')}`);
    }
    console.log(`🗣️ Peticiones encontradas (${res.userRequests.length}):`);
    res.userRequests.forEach(r => console.log(`   • ${r.replace(/\n/g, ' ').slice(0, 150)}`));
});

fs.writeFileSync('scripts/aug23_25_scan.json', JSON.stringify(scanResults, null, 2), 'utf-8');
