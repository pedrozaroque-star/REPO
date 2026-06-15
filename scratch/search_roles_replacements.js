const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function searchReplacements() {
  const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Reading transcript line by line for page.tsx write/replace...');

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    try {
      const obj = JSON.parse(line);
      if (obj.tool_calls) {
        for (const tc of obj.tool_calls) {
          const name = tc.name || '';
          let args = tc.args || {};
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch(e) {}
          }
          const target = args.TargetFile || args.target_file || args.Target || args.target || '';
          if (target.toLowerCase().includes('roles/page.tsx')) {
            const repl = args.ReplacementContent || args.CodeContent || '';
            const desc = args.Description || '';
            console.log(`Line ${lineCount} (Step ${obj.step_index}): name=${name}, desc="${desc}", repl_size=${repl.length}`);
            if (repl.includes('viewMode')) {
              console.log('  -> Contains viewMode!');
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }
}

searchReplacements();
