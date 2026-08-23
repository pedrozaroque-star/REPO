const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📋 AUDITORÍA COMPLETA DE ACTIVIDADES DE HOY (22 DE AGOSTO 2026)');
console.log('═══════════════════════════════════════════════════════════════════════');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const convDirs = fs.readdirSync(brainDir).filter(d => {
    const p = path.join(brainDir, d);
    return fs.statSync(p).isDirectory() && !d.startsWith('.');
});

const todayConvs = {};

convDirs.forEach(cid => {
    const p = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(p)) return;

    try {
        const content = fs.readFileSync(p, 'utf-8');
        if (content.includes('2026-08-22') || content.includes('2026-08-23T00') || content.includes('2026-08-23T01') || content.includes('2026-08-23T02') || content.includes('2026-08-23T03') || content.includes('2026-08-23T04') || content.includes('2026-08-23T05') || content.includes('2026-08-23T06')) {
            const lines = content.split('\n');
            const userMessages = [];
            const timestamps = [];

            lines.forEach(l => {
                if (!l.trim()) return;
                try {
                    const step = JSON.parse(l);
                    const rawStr = JSON.stringify(step);
                    const tsMatches = rawStr.match(/2026-08-22T\d\d:\d\d:\d\d/g) || rawStr.match(/2026-08-23T0[0-6]:\d\d:\d\d/g);
                    if (tsMatches) {
                        tsMatches.forEach(tStr => {
                            const dt = new Date(tStr + 'Z');
                            const laDate = dt.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
                            const laTime = dt.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: true });
                            if (laDate === '8/22/2026' || laDate === '08/22/2026') {
                                timestamps.push({ dt, laTime });
                            }
                        });
                    }
                    if (step.type === 'USER_INPUT' && typeof step.content === 'string') {
                        userMessages.push(step.content);
                    }
                } catch(e) {}
            });

            if (timestamps.length > 0) {
                timestamps.sort((a, b) => a.dt - b.dt);
                const startTime = timestamps[0].laTime;
                const endTime = timestamps[timestamps.length - 1].laTime;
                const durationHours = (timestamps[timestamps.length - 1].dt - timestamps[0].dt) / (1000 * 60 * 60);

                todayConvs[cid] = {
                    cid,
                    startTime,
                    endTime,
                    durationHours: Math.max(durationHours, 0.25),
                    eventCount: timestamps.length,
                    userMessages: userMessages.slice(0, 3)
                };
            }
        }
    } catch(e) {}
});

console.log(`Conversaciones activas hoy (${Object.keys(todayConvs).length}):\n`);
Object.values(todayConvs).forEach((c, idx) => {
    console.log(`[${idx+1}] Conversación ${c.cid.substring(0, 8)}:`);
    console.log(`    Horario: ${c.startTime} a ${c.endTime} (~${c.durationHours.toFixed(2)}h, ${c.eventCount} eventos)`);
    console.log(`    Mensajes clave:`);
    c.userMessages.forEach(m => console.log(`      - "${m.replace(/\n/g, ' ').substring(0, 100)}"`));
    console.log('');
});
