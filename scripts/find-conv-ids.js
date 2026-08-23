const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const matching = fs.readdirSync(brainDir).filter(d => d.startsWith('cd9') || d.startsWith('72f') || d.startsWith('fa0'));
console.log('Matching conversations:', matching);

matching.forEach(cid => {
    const p = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(p)) {
        console.log(`\n=================== CONV: ${cid} ===================`);
        const lines = fs.readFileSync(p, 'utf-8').split('\n');
        lines.forEach((line) => {
            if (!line.trim()) return;
            try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
                    const content = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
                    const tsMatch = content.match(/The current local time is: ([\d\-T\:\+]+)/);
                    if (tsMatch && (tsMatch[1].includes('2026-08-20') || tsMatch[1].includes('2026-08-21') || tsMatch[1].includes('2026-08-19'))) {
                        console.log(`[Step ${parsed.step_index}] ⏰ ${tsMatch[1]}`);
                        console.log(`   💬 ${content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 180)}`);
                    }
                }
            } catch(e) {}
        });
    }
});
