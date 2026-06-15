const fs = require('fs');
const readline = require('readline');

const linesToInspect = [1098, 1099, 1109, 1117, 1122, 1124, 1148, 1354, 1403, 1404, 1442, 1443, 1445, 1485, 1487, 1568, 1579, 1601, 1647, 1648, 1650, 1669, 1679, 1934, 1944, 1945, 2106];

async function inspectLines() {
  const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Inspecting specific lines in transcript...');

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (linesToInspect.includes(lineCount)) {
      try {
        const obj = JSON.parse(line);
        console.log(`\nLine ${lineCount} (Step ${obj.step_index}): source=${obj.source}, type=${obj.type}`);
        if (obj.tool_calls) {
          obj.tool_calls.forEach(tc => {
            console.log(`  Tool call: ${tc.name || tc.ToolName}`);
            const args = tc.args || tc.Arguments || {};
            const keys = Object.keys(args);
            console.log(`  Args keys: ${keys.join(', ')}`);
            const target = args.TargetFile || args.target_file || args.Target || args.target || '';
            console.log(`  TargetFile: "${target}"`);
            
            // Print a snippet of CodeContent or ReplacementContent if present
            const repl = args.ReplacementContent || args.CodeContent || '';
            if (repl) {
              console.log(`  Repl/Code size: ${repl.length}`);
              console.log(`  Snippet: ${repl.substring(0, 100)}`);
            }
          });
        }
      } catch (e) {
        console.error(`  Line ${lineCount} parse error:`, e.message);
      }
    }
  }
}

inspectLines();
