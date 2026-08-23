const fs = require('fs');
const path = require('path');

const transcriptPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\cd97748a-a621-4770-9856-11f84b6f1230\\.system_generated\\logs\\transcript.jsonl';

const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

console.log('═══════════════════════════════════════════════════════════════════');
console.log('📜 TIMELINE COMPLETO DE CONVERSACIÓN cd97748a (20 y 21 de Agosto):');
console.log('═══════════════════════════════════════════════════════════════════');

lines.forEach((line, idx) => {
    if (!line.trim()) return;
    try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
            const content = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
            const tsMatch = content.match(/The current local time is: ([\d\-T\:\+]+)/);
            const localTime = tsMatch ? tsMatch[1] : (parsed.timestamp || 'N/A');
            console.log(`\n[Step ${parsed.step_index}] ⏰ ${localTime}`);
            console.log(`💬 Request: ${content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 180)}...`);
        }
    } catch(e) {}
});
