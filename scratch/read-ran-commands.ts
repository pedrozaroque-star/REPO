import fs from 'fs';
import path from 'path';

function run() {
  const logPath = path.resolve(
    'C:/Users/pedro/.gemini/antigravity/brain/7f8d96b2-5c80-4156-a707-9b12d85ca4af/.system_generated/logs/transcript.jsonl'
  );
  
  if (!fs.existsSync(logPath)) {
    console.error('Log file not found');
    return;
  }
  
  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n');
  
  console.log('--- Ran Commands in Current Conversation ---');
  lines.forEach((line) => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      if (obj.tool_calls) {
        obj.tool_calls.forEach((tc: any) => {
          if (tc.name === 'run_command') {
            console.log(`Step ${obj.step_index} (${obj.created_at}): ${tc.args.CommandLine}`);
          }
        });
      }
    } catch (e) {
      // ignore
    }
  });
}

run();
