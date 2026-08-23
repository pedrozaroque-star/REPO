const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 AUDITORÍA FORENSE DÍA POR DÍA: 01 AL 22 DE AGOSTO DE 2026');
console.log('═══════════════════════════════════════════════════════════════════════');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const convDirs = fs.readdirSync(brainDir).filter(d => {
    const p = path.join(brainDir, d);
    return fs.statSync(p).isDirectory() && !d.startsWith('.');
});

console.log(`Analizando ${convDirs.length} conversaciones en el historial...`);

// Helper to convert date string to Date object
function parseLocalTime(str) {
    return new Date(str);
}

// Business day definition: starts at 6:00 AM and ends at 5:59:59 AM the next day
function getBusinessDate(dateObj) {
    const d = new Date(dateObj);
    // If before 6:00 AM, it belongs to previous day
    if (d.getHours() < 6) {
        d.setDate(d.getDate() - 1);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const allUserEvents = [];

convDirs.forEach(cid => {
    const p = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(p)) return;
    
    try {
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.split('\n');
        lines.forEach(line => {
            if (!line.trim()) return;
            try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
                    const text = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
                    const match = text.match(/The current local time is: (2026-08-\d\dT\d\d:\d\d:\d\d)/);
                    if (match) {
                        const isoStr = match[1];
                        const dateObj = new Date(isoStr);
                        const bDate = getBusinessDate(dateObj);
                        
                        allUserEvents.push({
                            cid,
                            step: parsed.step_index,
                            isoStr,
                            dateObj,
                            bDate,
                            prompt: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                        });
                    }
                }
            } catch(e) {}
        });
    } catch(e) {}
});

console.log(`Total interacciones de usuario encontradas en Agosto: ${allUserEvents.length}`);

// Group by business date
const eventsByDay = {};
allUserEvents.forEach(ev => {
    if (!eventsByDay[ev.bDate]) eventsByDay[ev.bDate] = [];
    eventsByDay[ev.bDate].push(ev);
});

// Also scan git commits
const commitsByDay = {};
try {
    const gitLog = execSync('git log --since="2026-08-01" --format="%h|%ai|%s" --all --no-merges', { encoding: 'utf-8' });
    gitLog.split('\n').forEach(line => {
        if (!line.trim()) return;
        const [hash, dateStr, ...msgArr] = line.split('|');
        const msg = msgArr.join('|');
        const d = new Date(dateStr);
        const bDate = getBusinessDate(d);
        if (!commitsByDay[bDate]) commitsByDay[bDate] = [];
        commitsByDay[bDate].push({ hash, dateStr, msg, dateObj: d });
    });
} catch(e) {
    console.error('Git log error:', e.message);
}

// Days from 2026-08-01 to 2026-08-22
const allDays = [];
for (let i = 1; i <= 22; i++) {
    const dayStr = String(i).padStart(2, '0');
    allDays.push(`2026-08-${dayStr}`);
}

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('📊 RESUMEN DE ACTIVIDAD FORENSE POR DÍA LABORAL');
console.log('═══════════════════════════════════════════════════════════════════════');

const dayReports = [];

allDays.forEach(day => {
    const dayEvents = (eventsByDay[day] || []).sort((a, b) => a.dateObj - b.dateObj);
    const dayCommits = (commitsByDay[day] || []).sort((a, b) => a.dateObj - b.dateObj);
    
    // Group events into sessions if gap between interactions > 45 minutes
    const sessions = [];
    let currentSession = null;
    
    dayEvents.forEach(ev => {
        if (!currentSession) {
            currentSession = { start: ev.dateObj, end: ev.dateObj, events: [ev] };
        } else {
            const diffMinutes = (ev.dateObj - currentSession.end) / (1000 * 60);
            if (diffMinutes <= 45) {
                currentSession.end = ev.dateObj;
                currentSession.events.push(ev);
            } else {
                sessions.push(currentSession);
                currentSession = { start: ev.dateObj, end: ev.dateObj, events: [ev] };
            }
        }
    });
    if (currentSession) sessions.push(currentSession);
    
    // Also merge commit times into sessions if commits happened outside user inputs
    dayCommits.forEach(cm => {
        let placed = false;
        sessions.forEach(sess => {
            const diffBefore = (sess.start - cm.dateObj) / (1000 * 60);
            const diffAfter = (cm.dateObj - sess.end) / (1000 * 60);
            if (diffBefore >= 0 && diffBefore <= 30) {
                sess.start = cm.dateObj;
                placed = true;
            } else if (diffAfter >= 0 && diffAfter <= 30) {
                sess.end = cm.dateObj;
                placed = true;
            } else if (cm.dateObj >= sess.start && cm.dateObj <= sess.end) {
                placed = true;
            }
        });
        if (!placed) {
            // New 30 min session for isolated commit
            const s = new Date(cm.dateObj.getTime() - 15 * 60 * 1000);
            const e = new Date(cm.dateObj.getTime() + 15 * 60 * 1000);
            sessions.push({ start: s, end: e, events: [{ prompt: `Commit: ${cm.msg}` }] });
        }
    });
    
    // Calculate total session hours
    let totalHours = 0;
    const sessionDetails = sessions.map(sess => {
        // Minimum session duration is 30 mins (0.5h) or actual span + 15 min buffer for reading/analyzing/testing
        let durationHrs = (sess.end - sess.start) / (1000 * 60 * 60);
        if (sess.events.length === 1 && durationHrs === 0) {
            durationHrs = 0.5; // At least 30 mins for a task
        } else {
            durationHrs = Math.max(0.5, durationHrs + 0.25); // +15 mins buffer
        }
        totalHours += durationHrs;
        
        const fmt = d => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        return {
            timeRange: `${fmt(sess.start)} - ${fmt(sess.end)}`,
            durationHrs: Number(durationHrs.toFixed(2)),
            eventCount: sess.events.length,
            topics: sess.events.slice(0, 3).map(e => e.prompt.substring(0, 60))
        };
    });
    
    dayReports.push({
        day,
        eventCount: dayEvents.length,
        commitCount: dayCommits.length,
        sessionCount: sessions.length,
        totalHours: Number(totalHours.toFixed(2)),
        sessionDetails
    });
    
    console.log(`\n📅 DÍA ${day}:`);
    console.log(`   💬 Mensajes: ${dayEvents.length} | 📌 Commits: ${dayCommits.length} | ⏱️ Horas detectadas: ${totalHours.toFixed(2)}h`);
    sessionDetails.forEach((s, idx) => {
        console.log(`   └─ [Sesión ${idx+1}] ${s.timeRange} (${s.durationHrs}h) - ${s.eventCount} interacciones`);
    });
});

fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/scratch/forensic_month_audit.json', JSON.stringify(dayReports, null, 2), 'utf-8');
console.log('\n✅ Reporte de auditoría mensual guardado en scratch/forensic_month_audit.json');
