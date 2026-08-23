const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA FORENSE DÍA POR DÍA DE AGOSTO 2026 (MULTI-CHAT CONSOLIDATION)');
console.log('═══════════════════════════════════════════════════════════════════════');

const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

// Collect all events per date (2026-08-01 to 2026-08-23)
const eventsByDate = {};
for (let d = 1; d <= 23; d++) {
    const dStr = `2026-08-${String(d).padStart(2, '0')}`;
    eventsByDate[dStr] = {
        conversations: new Set(),
        userRequests: [],
        toolFilesTouched: new Set(),
        commitMatches: [],
        timeRanges: []
    };
}

// 1. Scan all git commits in August
try {
    const gitLog = execSync('git log --since="2026-08-01" --until="2026-08-23 23:59:59" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
    const commitLines = gitLog.split('\n').filter(Boolean);
    commitLines.forEach(line => {
        const [hash, dateStr, ...msgParts] = line.split(' | ');
        if (dateStr) {
            const dayKey = dateStr.slice(0, 10);
            if (eventsByDate[dayKey]) {
                eventsByDate[dayKey].commitMatches.push({ hash, time: dateStr.slice(11, 19), msg: msgParts.join(' | ') });
            }
        }
    });
} catch (e) {
    console.error('Git log error:', e.message);
}

// 2. Scan all conversation transcripts
convDirs.forEach(cId => {
    const transcriptPath = path.join(brainDir, cId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;

    try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
        lines.forEach(l => {
            if (!l.trim()) return;
            try {
                const step = JSON.parse(l);
                // Look for timestamps
                // In steps, check if there's a timestamp or if content mentions 2026-08-XX
                let timeStr = null;
                if (step.content) {
                    const m = step.content.match(/2026-08-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
                    if (m) {
                        const dayKey = `2026-08-${m[1]}`;
                        const hourMin = `${m[2]}:${m[3]}`;
                        if (eventsByDate[dayKey]) {
                            eventsByDate[dayKey].conversations.add(cId);
                            eventsByDate[dayKey].timeRanges.push(hourMin);
                            if (step.type === 'USER_INPUT') {
                                const cleanReq = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                                if (cleanReq && !eventsByDate[dayKey].userRequests.includes(cleanReq)) {
                                    eventsByDate[dayKey].userRequests.push(cleanReq.slice(0, 200));
                                }
                            }
                        }
                    }
                }
                if (step.tool_calls) {
                    step.tool_calls.forEach(tc => {
                        const target = tc.parameters?.TargetFile || tc.parameters?.AbsolutePath || tc.parameters?.SearchPath;
                        if (target && typeof target === 'string') {
                            // Find matching day if any
                            const filename = path.basename(target);
                            // Add to global files touched
                        }
                    });
                }
            } catch {}
        });
    } catch {}
});

// Print Day-by-Day forensic summary
for (let d = 1; d <= 23; d++) {
    const dStr = `2026-08-${String(d).padStart(2, '0')}`;
    const ev = eventsByDate[dStr];
    console.log(`\n═══════════════════════════════════════════════════════════════════════`);
    console.log(`📅 FECHA: ${dStr} (${ev.conversations.size} conversaciones detectadas | ${ev.commitMatches.length} commits)`);
    console.log(`═══════════════════════════════════════════════════════════════════════`);
    
    if (ev.timeRanges.length > 0) {
        const sortedTimes = [...new Set(ev.timeRanges)].sort();
        console.log(`⏰ Rango horario detectado en chats: ${sortedTimes[0]} a ${sortedTimes[sortedTimes.length - 1]} (${sortedTimes.length} puntos de actividad)`);
    }

    if (ev.commitMatches.length > 0) {
        console.log(`🔨 Commits realizados:`);
        ev.commitMatches.forEach(c => console.log(`   - [${c.time}] ${c.hash}: ${c.msg}`));
    }

    if (ev.userRequests.length > 0) {
        console.log(`🗣️ Peticiones de Carlos encontradas (${ev.userRequests.length}):`);
        ev.userRequests.slice(0, 8).forEach(r => console.log(`   • ${r.replace(/\n/g, ' ')}`));
    }
}

fs.writeFileSync('scripts/august_forensic_scan.json', JSON.stringify(eventsByDate, null, 2), 'utf-8');
console.log('\nAudit complete! Dumped to scripts/august_forensic_scan.json');
