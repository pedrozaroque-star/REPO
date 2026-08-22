const fs = require('fs');
const path = require('path');

const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);

console.log('Searching for August 4 activity across transcripts...');

for (const dir of convDirs) {
  const transcriptPath = path.join(brainDir, dir, '.system_generated/logs/transcript.jsonl');
  if (fs.existsSync(transcriptPath)) {
    const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.content && typeof obj.content === 'string') {
          if (obj.content.includes('2026-08-04') || obj.content.includes('4 de agosto') || obj.content.includes('04-Ago')) {
            if (obj.type === 'USER_INPUT' || obj.source === 'USER_EXPLICIT') {
              console.log(`[${dir}] [${obj.type}] ${obj.content.substring(0, 150)}...`);
            }
          }
        }
      } catch (e) {}
    }
  }
}
