const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';

const convDirs = fs.readdirSync(brainDir);
console.log(`Scanning ${convDirs.length} conversation directories...`);

const results = [];

convDirs.forEach(convId => {
    const logPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(logPath)) return;

    try {
        const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
        lines.forEach(line => {
            if (!line.trim()) return;
            if (line.includes('"type":"USER_INPUT"') || line.toLowerCase().includes('cohesion')) {
                try {
                    const obj = JSON.parse(line);
                    if (obj.type === 'USER_INPUT' && obj.content && (obj.content.toLowerCase().includes('cohesion') || obj.content.toLowerCase().includes('contabilidad'))) {
                        results.push({
                            convId,
                            time: obj.created_at,
                            content: obj.content
                        });
                    }
                } catch (e) {}
            }
        });
    } catch (e) {}
});

console.log(`Found ${results.length} user prompts mentioning Cohesion/Contabilidad:`);
results.sort((a, b) => new Date(a.time) - new Date(b.time)).forEach(r => {
    console.log(`[${r.time}] (Conv: ${r.convId}):\n  ${r.content.substring(0, 120)}...\n`);
});
