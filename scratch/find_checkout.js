const fs = require('fs');
const readline = require('readline');

async function findCheckout() {
  const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Searching transcript for git checkout/reset/clean/restore...');

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    try {
      const obj = JSON.parse(line);
      if (obj.tool_calls) {
        for (const tc of obj.tool_calls) {
          if (tc.name === 'run_command') {
            const cmd = tc.args.CommandLine || '';
            if (cmd.includes('checkout') || cmd.includes('reset') || cmd.includes('clean') || cmd.includes('restore')) {
              console.log(`Line ${lineCount} (Step ${obj.step_index}): ${cmd}`);
            }
          }
        }
      }
    } catch (e) {}
  }
}

findCheckout();
