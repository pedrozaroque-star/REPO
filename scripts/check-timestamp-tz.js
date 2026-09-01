const fs = require('fs');
const path = require('path');

const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

console.log('Testing transcript timestamp formats:');
let samples = 0;
for (const cId of convDirs) {
    const tPath = path.join(brainDir, cId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(tPath)) continue;
    const lines = fs.readFileSync(tPath, 'utf-8').split('\n');
    for (const l of lines) {
        if (!l.trim()) continue;
        try {
            const step = JSON.parse(l);
            if (step.created_at) {
                console.log(`created_at: ${step.created_at}`);
                if (step.content && step.content.includes('<ADDITIONAL_METADATA>')) {
                    const m = step.content.match(/The current local time is:\s*([^\.]+)/);
                    if (m) console.log(`  user metadata local time: ${m[1]}`);
                }
                samples++;
                if (samples >= 5) break;
            }
        } catch {}
    }
    if (samples >= 5) break;
}
