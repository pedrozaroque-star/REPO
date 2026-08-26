const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 ESCANEO FORENSE VESPERTINO DEL 23 DE AGOSTO (12:15 PM A 7:11 PM)');
console.log('═══════════════════════════════════════════════════════════════════════');

// 1. Check git status
try {
    const gitStatus = execSync('git status --short', { encoding: 'utf-8' });
    console.log('Git Status:\n', gitStatus || '(Working tree clean, no pending changes)');
} catch (e) {
    console.log('Git status error:', e.message);
}

// 2. Check git log today
try {
    const gitLog = execSync('git log --since="2026-08-23 00:00:00" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
    console.log('\nCommits Today (23-Ago):\n', gitLog);
} catch (e) {
    console.log('Git log error:', e.message);
}

// 3. Scan all transcripts for activity between 12:15 PM and 7:11 PM
const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

const afternoonEvents = [];

convDirs.forEach(cId => {
    const transcriptPath = path.join(brainDir, cId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;

    try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
        lines.forEach(l => {
            if (!l.trim()) return;
            try {
                const step = JSON.parse(l);
                if (step.content && step.content.includes('2026-08-23T')) {
                    const m = step.content.match(/2026-08-23T(\d{2}):(\d{2}):(\d{2})/);
                    if (m) {
                        const hour = parseInt(m[1], 10);
                        const min = parseInt(m[2], 10);
                        const timeVal = hour + min / 60;
                        // Check if between 12:15 and 19:15
                        if (timeVal >= 12.25 && timeVal <= 19.25) {
                            if (step.type === 'USER_INPUT') {
                                const cleanReq = step.content.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
                                afternoonEvents.push({
                                    conversation: cId,
                                    time: `${m[1]}:${m[2]}`,
                                    request: cleanReq
                                });
                            }
                        }
                    }
                }
            } catch {}
        });
    } catch {}
});

console.log(`\nActividades detectadas en la tarde (12:15 PM - 7:11 PM): ${afternoonEvents.length}`);
afternoonEvents.forEach(e => {
    console.log(`- [${e.time}] (Chat ${e.conversation.slice(0, 8)}): ${e.request.slice(0, 140)}`);
});
