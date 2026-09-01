const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔬 AUDITORÍA FORENSE DEFINITIVA CON ZONA HORARIA PDT (UTC-7) Y DÍA 6AM-6AM');
console.log('═══════════════════════════════════════════════════════════════════════');

const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

// Initialize all 31 August business days
const businessDays = {};
for (let d = 1; d <= 31; d++) {
    const dayStr = d < 10 ? `0${d}` : `${d}`;
    businessDays[`2026-08-${dayStr}`] = {
        dayNum: d,
        convIds: new Set(),
        userPrompts: [],
        toolCalls: [],
        pdtTimestamps: [], // in decimal hours from 0.0 to 24.0+ (where 6:00 AM is 6.0, 5:59 AM next day is 29.98)
        commits: []
    };
}

// 1. Get ALL Git Commits in PDT
try {
    const rawCommits = execSync('git log --since="2026-08-01" --until="2026-09-01 12:00:00" --format="%h|%ai|%s" --all', { encoding: 'utf-8' });
    rawCommits.split('\n').forEach(line => {
        if (!line.trim()) return;
        const [hash, dateStr, ...msgParts] = line.split('|');
        const msg = msgParts.join('|');
        // dateStr e.g. "2026-08-25 18:51:35 -0700"
        const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*([\+\-]\d{4})/);
        if (m) {
            const commitDate = new Date(dateStr);
            // Convert to PDT
            const pdtString = commitDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
            const pdtDate = new Date(pdtString);
            
            let y = pdtDate.getFullYear();
            let mNum = pdtDate.getMonth() + 1;
            let d = pdtDate.getDate();
            let h = pdtDate.getHours();
            let min = pdtDate.getMinutes();

            // Business day logic: if hour < 6, belongs to previous calendar day
            if (h < 6) {
                const prev = new Date(pdtDate.getTime() - 24 * 60 * 60 * 1000);
                y = prev.getFullYear();
                mNum = prev.getMonth() + 1;
                d = prev.getDate();
                h += 24; // map 1:00 AM to 25.0
            }

            const dayStr = d < 10 ? `0${d}` : `${d}`;
            const bDayKey = `2026-08-${dayStr}`;

            if (mNum === 8 && businessDays[bDayKey]) {
                const decimalHour = h + min / 60;
                businessDays[bDayKey].commits.push({ hash, time: `${pdtDate.getHours()}:${min}`, decimalHour, msg });
                businessDays[bDayKey].pdtTimestamps.push(decimalHour);
            }
        }
    });
} catch (e) {
    console.error('Git log error:', e.message);
}

// 2. Process all transcripts
let transcriptsCount = 0;
convDirs.forEach(cId => {
    const transcriptPath = path.join(brainDir, cId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;
    transcriptsCount++;

    try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
        lines.forEach(l => {
            if (!l.trim()) return;
            try {
                const step = JSON.parse(l);
                let timestampUtc = step.created_at;
                
                // Also check if content has explicit metadata timestamp
                if (step.content && step.content.includes('<ADDITIONAL_METADATA>')) {
                    const metaMatch = step.content.match(/The current local time is:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\+\-]\d{2}:\d{2})/);
                    if (metaMatch) timestampUtc = metaMatch[1];
                }

                if (!timestampUtc) return;

                const utcDate = new Date(timestampUtc);
                if (isNaN(utcDate.getTime())) return;

                // Format in PDT
                const pdtFormatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Los_Angeles',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                });

                const parts = pdtFormatter.formatToParts(utcDate);
                const pdtMap = {};
                parts.forEach(p => pdtMap[p.type] = p.value);

                let y = parseInt(pdtMap.year, 10);
                let mNum = parseInt(pdtMap.month, 10);
                let d = parseInt(pdtMap.day, 10);
                let h = parseInt(pdtMap.hour, 10);
                let min = parseInt(pdtMap.minute, 10);

                if (y !== 2026 || (mNum !== 8 && !(mNum === 9 && d === 1 && h < 6))) return;

                // Business day rule: 6:00 AM to 5:59 AM next day
                let bDay = d;
                let bHour = h;
                if (h < 6) {
                    bDay = d - 1;
                    bHour = h + 24; // e.g. 1:30 AM -> 25.5
                    if (mNum === 9 && d === 1) {
                        bDay = 31; // Aug 31 late night
                        mNum = 8;
                    }
                }

                if (mNum === 8 && bDay >= 1 && bDay <= 31) {
                    const dayStr = bDay < 10 ? `0${bDay}` : `${bDay}`;
                    const bDayKey = `2026-08-${dayStr}`;
                    const decimalHour = bHour + min / 60;

                    businessDays[bDayKey].convIds.add(cId);
                    businessDays[bDayKey].pdtTimestamps.push(decimalHour);

                    if (step.type === 'USER_INPUT' && step.content) {
                        const clean = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                        if (clean && !businessDays[bDayKey].userPrompts.includes(clean)) {
                            businessDays[bDayKey].userPrompts.push(clean);
                        }
                    }

                    if (step.tool_calls && Array.isArray(step.tool_calls)) {
                        step.tool_calls.forEach(tc => {
                            const summary = tc.toolSummary || tc.toolAction || tc.name || '';
                            if (summary && !businessDays[bDayKey].toolCalls.includes(summary)) {
                                businessDays[bDayKey].toolCalls.push(summary);
                            }
                        });
                    }
                }
            } catch {}
        });
    } catch {}
});

// Load current recorded data
const currentReport = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));
const currentRowsByDate = {};
currentReport.rows.forEach(r => {
    const m = r.date.match(/(\d{2})-Ago-2026/);
    if (m) currentRowsByDate[`2026-08-${m[1]}`] = r;
});

console.log(`Transcripts escaneados: ${transcriptsCount}`);

// Cluster sessions for each business day
const consolidatedForensicDays = [];

for (let d = 1; d <= 31; d++) {
    const dayStr = d < 10 ? `0${d}` : `${d}`;
    const dateKey = `2026-08-${dayStr}`;
    const bData = businessDays[dateKey];
    const currentRow = currentRowsByDate[dateKey] || { hours: 0, time: '—' };

    // Sort unique timestamps
    const rawTimes = [...new Set(bData.pdtTimestamps)].sort((a, b) => a - b);
    
    const sessions = [];
    if (rawTimes.length > 0) {
        let sessionStart = rawTimes[0];
        let lastTime = rawTimes[0];

        for (let i = 1; i < rawTimes.length; i++) {
            const curr = rawTimes[i];
            // If gap between events is > 45 minutes (0.75h), close session and start new
            if (curr - lastTime > 0.75) {
                // Duration with 30m buffer for thinking & context
                const duration = Math.max(0.5, (lastTime - sessionStart) + 0.5);
                sessions.push({ startDec: sessionStart, endDec: lastTime, duration: parseFloat(duration.toFixed(2)) });
                sessionStart = curr;
            }
            lastTime = curr;
        }
        const duration = Math.max(0.5, (lastTime - sessionStart) + 0.5);
        sessions.push({ startDec: sessionStart, endDec: lastTime, duration: parseFloat(duration.toFixed(2)) });
    }

    // Helper to format decimal hour to 12h AM/PM
    const decToTimeStr = (dec) => {
        let h = Math.floor(dec);
        let m = Math.round((dec - h) * 60);
        if (m === 60) { h++; m = 0; }
        let displayH = h % 24;
        const ampm = displayH >= 12 ? 'PM' : 'AM';
        let h12 = displayH % 12;
        if (h12 === 0) h12 = 12;
        const mStr = m < 10 ? `0${m}` : `${m}`;
        return `${h12}:${mStr} ${ampm}`;
    };

    const sessionStrings = sessions.map(s => `${decToTimeStr(s.startDec)} - ${decToTimeStr(s.endDec)}`);
    const totalForensicHours = sessions.reduce((sum, s) => sum + s.duration, 0);

    // Max between recorded and forensic (non-destructive)
    const finalHours = Math.max(currentRow.hours, parseFloat(totalForensicHours.toFixed(2)));

    consolidatedForensicDays.push({
        dateKey,
        dayNum: d,
        recordedHours: currentRow.hours,
        recordedTime: currentRow.time,
        forensicHours: parseFloat(totalForensicHours.toFixed(2)),
        forensicSessions: sessionStrings,
        finalHours: finalHours,
        sessionsCount: sessions.length,
        convCount: bData.convIds.size,
        promptsCount: bData.userPrompts.length,
        commitsCount: bData.commits.length,
        commits: bData.commits,
        userPrompts: bData.userPrompts,
        toolCalls: bData.toolCalls.slice(0, 15)
    });
}

fs.writeFileSync('scripts/august_forensic_pdt_audit.json', JSON.stringify(consolidatedForensicDays, null, 2), 'utf-8');

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('📋 AUDITORÍA FORENSE DÍA A DÍA (PDT / BUSINESS DAY 6AM-6AM):');
console.log('═══════════════════════════════════════════════════════════════════════');

let grandTotalRecorded = 0;
let grandTotalForensic = 0;
let grandTotalFinal = 0;

consolidatedForensicDays.forEach(r => {
    grandTotalRecorded += r.recordedHours;
    grandTotalForensic += r.forensicHours;
    grandTotalFinal += r.finalHours;
    const diff = r.finalHours - r.recordedHours;
    const badge = diff > 0 ? `🔥 +${diff.toFixed(2)}h` : '✅ Exacto';
    console.log(`${r.dateKey} | Reg: ${r.recordedHours.toFixed(2)}h | Forense: ${r.forensicHours.toFixed(2)}h | Final: ${r.finalHours.toFixed(2)}h | Sesiones: ${r.forensicSessions.join(' & ') || '—'} | Convs: ${r.convCount} | Prompts: ${r.promptsCount} | ${badge}`);
});

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log(`TOTAL REGISTRADO PREVIO: ${grandTotalRecorded.toFixed(2)} hrs`);
console.log(`TOTAL FORENSE IDENTIFICADO: ${grandTotalForensic.toFixed(2)} hrs`);
console.log(`TOTAL FINAL ACUMULADO NO-DESTRUCTIVO: ${grandTotalFinal.toFixed(2)} hrs (+${(grandTotalFinal - grandTotalRecorded).toFixed(2)} hrs de esfuerzo real adicional)`);
console.log('═══════════════════════════════════════════════════════════════════════');
