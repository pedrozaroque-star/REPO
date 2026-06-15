const fs = require('fs');
const path = require('path');

const transcriptPath = 'C:/Users/pedro/.gemini/antigravity/brain/7f8d96b2-5c80-4156-a707-9b12d85ca4af/.system_generated/logs/transcript.jsonl';

if (!fs.existsSync(transcriptPath)) {
  console.error('Transcript not found');
  process.exit(1);
}

const content = fs.readFileSync(transcriptPath, 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('diff_roles') && (line.includes('write_to_file') || line.includes('replace_file_content') || line.includes('run_command'))) {
    try {
      const obj = JSON.parse(line);
      console.log(`Line ${idx + 1}, Step ${obj.step_index}, Type: ${obj.type}`);
      if (obj.tool_calls) {
        obj.tool_calls.forEach(tc => {
          console.log(`  Tool: ${tc.name || tc.ToolName}`);
          const args = tc.args || tc.Arguments || {};
          if (args.CommandLine) {
            console.log(`    Cmd: ${args.CommandLine}`);
          }
          if (args.TargetFile) {
            console.log(`    File: ${args.TargetFile}`);
          }
        });
      }
    } catch(e) {
      console.log(`Line ${idx + 1} (raw matches 'diff_roles')`);
    }
  }
});
