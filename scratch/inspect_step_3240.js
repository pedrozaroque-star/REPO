const fs = require('fs');
const readline = require('readline');

async function inspectStep() {
  const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Searching for line 3199...');

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (lineCount === 3199) {
      try {
        const obj = JSON.parse(line);
        console.log(`Step ${obj.step_index}: name=${obj.tool_calls[0].name}`);
        const args = obj.tool_calls[0].args || {};
        console.log('TargetContent:\n', args.TargetContent);
        console.log('ReplacementContent:\n', args.ReplacementContent);
      } catch (e) {
        console.error('Error parsing line:', e.message);
      }
      break;
    }
  }
}

inspectStep();
