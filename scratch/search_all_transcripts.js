const fs = require('fs');
const path = require('path');

const brainPath = 'C:/Users/pedro/.gemini/antigravity/brain';
if (!fs.existsSync(brainPath)) {
  console.log('Brain path does not exist');
  process.exit(1);
}

const dirs = fs.readdirSync(brainPath);
dirs.forEach(d => {
  const transcriptPath = path.join(brainPath, d, '.system_generated/logs/transcript.jsonl');
  if (!fs.existsSync(transcriptPath)) return;
  
  console.log(`Checking conversation: ${d}...`);
  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      if (obj.tool_calls) {
        obj.tool_calls.forEach(tc => {
          const name = tc.name || tc.ToolName || '';
          const args = tc.args || tc.Arguments || {};
          const target = args.TargetFile || args.target_file || args.Target || args.target || '';
          
          if (target.toLowerCase().includes('roles/page.tsx') && (name.includes('write') || name.includes('replace'))) {
            console.log(`  -> Found at step ${obj.step_index} (line ${idx}): tool=${name} desc=${args.Description || ''}`);
          }
        });
      }
    } catch (e) {
      // ignore JSON parse errors
    }
  });
});
console.log('Search finished!');
