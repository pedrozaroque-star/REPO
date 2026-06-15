const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\27e33a5f-522a-444b-84f3-db480630736f\\.system_generated\\logs\\transcript.jsonl';
if (!fs.existsSync(logPath)) {
  console.log('File does not exist:', logPath);
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf8').split('\n');
lines.forEach(line => {
  if (!line.trim()) return;
  const step = JSON.parse(line);
  if (step.step_index === 56) {
    const tc = step.tool_calls[0];
    if (tc && tc.args && tc.args.Message) {
      console.log('--- FULL MESSAGE FROM SUBAGENT ---');
      console.log(tc.args.Message);
      console.log('----------------------------------');
      
      // Save it to a file for easy reading
      fs.writeFileSync('scratch/full_research_report.md', tc.args.Message, 'utf8');
      console.log('Saved to scratch/full_research_report.md');
    }
  }
});
