const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Let's search all transcript files for user messages on August 20
const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const convDirs = fs.readdirSync(brainDir).filter(d => {
    const p = path.join(brainDir, d);
    return fs.statSync(p).isDirectory() && !d.startsWith('.');
});

console.log('Scanning all transcripts for August 20 events...');

const foundEvents = [];

convDirs.forEach(cid => {
    const transcriptPath = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;
    
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    if (content.includes('2026-08-20') || content.includes('20-Ago') || content.includes('20-Aug')) {
        const lines = content.split('\n');
        lines.forEach((line, lineIdx) => {
            if (!line.trim()) return;
            try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
                    foundEvents.push({
                        cid,
                        step: parsed.step_index,
                        content: typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content)
                    });
                }
            } catch(e) {}
        });
    }
});

console.log(`Found ${foundEvents.length} user inputs in conversations referencing Aug 20:`);
foundEvents.forEach((ev, i) => {
    console.log(`\n[${i+1}] (Conv: ${ev.cid.substring(0,8)}... step ${ev.step})`);
    console.log(`    ${ev.content.substring(0, 200).replace(/\n/g, ' ')}`);
});
