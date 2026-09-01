const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA FORENSE TOTAL DE TODAS LAS CONVERSACIONES Y COMMITS (AGOSTO 2026)');
console.log('═══════════════════════════════════════════════════════════════════════');

const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

// 1. Get ALL git commits for August 2026
const gitCommitsByDay = {};
for (let d = 1; d <= 31; d++) {
    const dayStr = d < 10 ? `0${d}` : `${d}`;
    gitCommitsByDay[`2026-08-${dayStr}`] = [];
}

try {
    const rawCommits = execSync('git log --since="2026-08-01" --until="2026-08-31 23:59:59" --format="%h|%ai|%s" --all', { encoding: 'utf-8' });
    rawCommits.split('\n').forEach(line => {
        if (!line.trim()) return;
        const [hash, dateStr, ...msgParts] = line.split('|');
        const msg = msgParts.join('|');
        const m = dateStr.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
        if (m) {
            const day = m[1];
            const time = m[2];
            if (gitCommitsByDay[day]) {
                gitCommitsByDay[day].push({ hash, time, msg });
            }
        }
    });
} catch (e) {
    console.error('Git log error:', e.message);
}

// 2. Scan ALL transcript files across all conversations
const transcriptEventsByDay = {};
for (let d = 1; d <= 31; d++) {
    const dayStr = d < 10 ? `0${d}` : `${d}`;
    transcriptEventsByDay[`2026-08-${dayStr}`] = {
        convIds: new Set(),
        userPrompts: [],
        toolCalls: [],
        timestamps: []
    };
}

let totalTranscriptsScanned = 0;

convDirs.forEach(cId => {
    const transcriptPath = path.join(brainDir, cId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;
    totalTranscriptsScanned++;

    try {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const lines = content.split('\n');
        lines.forEach(l => {
            if (!l.trim()) return;
            try {
                const step = JSON.parse(l);
                const timeMatch = (step.created_at || step.content || '').match(/2026-08-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
                if (timeMatch) {
                    const day = `2026-08-${timeMatch[1]}`;
                    const time = `${timeMatch[2]}:${timeMatch[3]}`;
                    if (transcriptEventsByDay[day]) {
                        transcriptEventsByDay[day].convIds.add(cId);
                        transcriptEventsByDay[day].timestamps.push(time);
                        if (step.type === 'USER_INPUT' && step.content) {
                            const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                            if (clean && !transcriptEventsByDay[day].userPrompts.includes(clean)) {
                                transcriptEventsByDay[day].userPrompts.push(clean);
                            }
                        }
                        if (step.tool_calls && Array.isArray(step.tool_calls)) {
                            step.tool_calls.forEach(tc => {
                                const toolSummary = tc.toolSummary || tc.toolAction || tc.name || '';
                                if (toolSummary && !transcriptEventsByDay[day].toolCalls.includes(toolSummary)) {
                                    transcriptEventsByDay[day].toolCalls.push(toolSummary);
                                }
                            });
                        }
                    }
                }
            } catch {}
        });
    } catch {}
});

console.log(`Transcripts analizados: ${totalTranscriptsScanned} conversaciones.`);

// 3. Compare day-by-day current recorded hours vs detected active blocks
const currentReport = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));
const currentRowsByDate = {};
currentReport.rows.forEach(r => {
    // parse date e.g. "01-Ago-2026"
    const m = r.date.match(/(\d{2})-Ago-2026/);
    if (m) {
        currentRowsByDate[`2026-08-${m[1]}`] = r;
    }
});

const auditReport = [];

for (let d = 1; d <= 31; d++) {
    const dayStr = d < 10 ? `0${d}` : `${d}`;
    const dateKey = `2026-08-${dayStr}`;
    const tData = transcriptEventsByDay[dateKey];
    const commits = gitCommitsByDay[dateKey] || [];
    const currentRow = currentRowsByDate[dateKey] || { hours: 0, time: '—' };

    const uniqueTimes = [...new Set(tData.timestamps)].sort();
    
    // Cluster timestamps into sessions (gap > 45 mins starts new session)
    const sessions = [];
    if (uniqueTimes.length > 0) {
        let currentStart = uniqueTimes[0];
        let lastTime = uniqueTimes[0];

        const parseMinutes = (t) => {
            const [h, min] = t.split(':').map(Number);
            return h * 60 + min;
        };

        for (let i = 1; i < uniqueTimes.length; i++) {
            const prevM = parseMinutes(lastTime);
            const currM = parseMinutes(uniqueTimes[i]);
            if (currM - prevM > 45) { // gap > 45 mins
                const duration = ((prevM - parseMinutes(currentStart) + 30) / 60); // add 30m buffer for thinking/prompting
                sessions.push({ start: currentStart, end: lastTime, duration: Math.max(0.5, parseFloat(duration.toFixed(2))) });
                currentStart = uniqueTimes[i];
            }
            lastTime = uniqueTimes[i];
        }
        const lastM = parseMinutes(lastTime);
        const startM = parseMinutes(currentStart);
        const duration = ((lastM - startM + 30) / 60);
        sessions.push({ start: currentStart, end: lastTime, duration: Math.max(0.5, parseFloat(duration.toFixed(2))) });
    }

    const calculatedHours = sessions.reduce((sum, s) => sum + s.duration, 0);

    auditReport.push({
        date: dateKey,
        dayNum: d,
        recordedHours: currentRow.hours,
        recordedTime: currentRow.time,
        detectedSessionsCount: sessions.length,
        detectedSessions: sessions,
        calculatedHours: parseFloat(calculatedHours.toFixed(2)),
        convCount: tData.convIds.size,
        promptCount: tData.userPrompts.length,
        commitCount: commits.length,
        prompts: tData.userPrompts,
        commits: commits
    });
}

fs.writeFileSync('scripts/august_forensic_deep_audit.json', JSON.stringify(auditReport, null, 2), 'utf-8');

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('📋 COMPARATIVA DÍA POR DÍA (REGISTRADO VS DETECTADO FORENSE):');
console.log('═══════════════════════════════════════════════════════════════════════');

let totalRecorded = 0;
let totalDetected = 0;

auditReport.forEach(r => {
    totalRecorded += r.recordedHours;
    totalDetected += r.calculatedHours;
    const diff = r.calculatedHours - r.recordedHours;
    const alert = diff > 1.0 ? '🚨 INFRARREGISTRADO' : (diff < -1.0 ? '⚠️' : '✅');
    console.log(`${r.date} | Reg: ${r.recordedHours.toFixed(2)}h (${r.recordedTime}) | Forense: ${r.calculatedHours.toFixed(2)}h (${r.detectedSessions.map(s => `${s.start}-${s.end}`).join(', ')}) | Convs: ${r.convCount} | Prompts: ${r.promptCount} | Commits: ${r.commitCount} | ${alert}`);
});

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log(`TOTAL REGISTRADO ACTUAL: ${totalRecorded.toFixed(2)} hrs`);
console.log(`TOTAL DETECTADO FORENSE: ${totalDetected.toFixed(2)} hrs`);
console.log(`DIFERENCIA TOTAL NO REGISTRADA: +${(totalDetected - totalRecorded).toFixed(2)} hrs`);
console.log('═══════════════════════════════════════════════════════════════════════');
