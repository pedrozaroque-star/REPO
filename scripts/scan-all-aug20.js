const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const convDirs = fs.readdirSync(brainDir).filter(d => {
    const p = path.join(brainDir, d);
    return fs.statSync(p).isDirectory() && !d.startsWith('.');
});

console.log('Searching all conversations for August 20, 2026 messages...');

const aug20Logs = [];

convDirs.forEach(cid => {
    const p = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(p)) return;
    
    const content = fs.readFileSync(p, 'utf-8');
    const lines = content.split('\n');
    lines.forEach(line => {
        if (!line.trim()) return;
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
                const text = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
                const match = text.match(/The current local time is: (2026-08-20T[^\.]+)/);
                if (match) {
                    aug20Logs.push({
                        cid,
                        step: parsed.step_index,
                        localTime: match[1],
                        prompt: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                    });
                }
                // Also check if user request on early morning 2026-08-21 before 6am
                const matchEarly21 = text.match(/The current local time is: (2026-08-21T0[0-5]:[^\.]+)/);
                if (matchEarly21) {
                    aug20Logs.push({
                        cid,
                        step: parsed.step_index,
                        localTime: matchEarly21[1] + ' (Early morning night session)',
                        prompt: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                    });
                }
            }
        } catch(e) {}
    });
});

aug20Logs.sort((a, b) => a.localTime.localeCompare(b.localTime));

console.log(`\n=============================================================`);
console.log(`TOTAL USER MESSAGES ON AUG 20 (AND NIGHT SESSION): ${aug20Logs.length}`);
console.log(`=============================================================`);

aug20Logs.forEach((l, i) => {
    console.log(`[${i+1}] ⏰ ${l.localTime} | Conv: ${l.cid.substring(0,8)}...`);
    console.log(`    💬 ${l.prompt.substring(0, 160)}`);
});
