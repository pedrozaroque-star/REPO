const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 ESCANEO EXHAUSTIVO DE TODA LA ACTIVIDAD DE HOY (22 DE AGOSTO 2026)');
console.log('═══════════════════════════════════════════════════════════════════════');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const convDirs = fs.readdirSync(brainDir).filter(d => {
    const p = path.join(brainDir, d);
    return fs.statSync(p).isDirectory() && !d.startsWith('.');
});

const todayEvents = [];

convDirs.forEach(cid => {
    const p = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(p)) return;

    try {
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.split('\n');
        lines.forEach(l => {
            if (!l.trim()) return;
            try {
                const step = JSON.parse(l);
                // Look for timestamp
                let ts = null;
                if (step.timestamp) ts = step.timestamp;
                else if (step.created_at) ts = step.created_at;
                
                // Also check inside content for timestamps or step content
                const rawStr = JSON.stringify(step);
                const tsMatches = rawStr.match(/2026-08-22T\d\d:\d\d:\d\d/g) || rawStr.match(/2026-08-23T0[0-6]:\d\d:\d\d/g);
                
                if (tsMatches) {
                    tsMatches.forEach(tStr => {
                        // Convert to LA time
                        const dt = new Date(tStr + 'Z');
                        const laTime = dt.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: true });
                        const laDate = dt.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
                        
                        let summary = '';
                        if (step.type === 'USER_INPUT' && typeof step.content === 'string') {
                            summary = 'USER: ' + step.content.substring(0, 100);
                        } else if (step.tool_calls) {
                            summary = 'TOOL: ' + step.tool_calls.map(tc => tc.toolSummary || tc.toolAction || tc.name).join(', ');
                        }

                        todayEvents.push({
                            cid,
                            iso: tStr,
                            dateStr: laDate,
                            timeStr: laTime,
                            type: step.type || 'STEP',
                            summary
                        });
                    });
                }
            } catch(e) {}
        });
    } catch(e) {}
});

console.log(`Total timestamps encontrados para hoy: ${todayEvents.length}`);

// Sort by ISO timestamp
todayEvents.sort((a, b) => a.iso.localeCompare(b.iso));

// Unique events by CID + time
const uniqueEvents = [];
const seen = new Set();
todayEvents.forEach(e => {
    const key = `${e.cid}_${e.timeStr}_${e.summary.substring(0, 30)}`;
    if (!seen.has(key)) {
        seen.add(key);
        uniqueEvents.push(e);
    }
});

console.log(`\nTimeline cronológico de hoy (22 de Agosto 2026 en Los Ángeles):`);
uniqueEvents.forEach(e => {
    console.log(`[${e.timeStr}] (${e.cid.substring(0, 8)}) ${e.summary}`);
});
