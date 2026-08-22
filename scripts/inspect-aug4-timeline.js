const fs = require('fs');

const transcriptPath = 'C:/Users/pedro/.gemini/antigravity/brain/ede4760c-dbf9-46f4-9c72-871369a9d62c/.system_generated/logs/transcript.jsonl';
const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

console.log('=== TIMELINE DE ACTIVIDADES EL 04 DE AGOSTO 2026 ===');
for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'USER_INPUT') {
      const match = obj.content.match(/The current local time is: (2026-08-04T[\d:]+)/);
      const time = match ? match[1] : 'No time';
      const textMatch = obj.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      const req = textMatch ? textMatch[1].trim() : obj.content.substring(0, 100);
      console.log(`⏱️ [${time}] User: ${req}`);
    }
  } catch (e) {}
}
