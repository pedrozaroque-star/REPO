import fs from 'fs';
import readline from 'readline';

const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\43ac0447-df87-481d-9ccc-33117d59f184\\.system_generated\\logs\\transcript.jsonl';

async function readLastLines() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  console.log(`Total transcript steps: ${lines.length}`);
  // Let's print the last 5 steps
  const lastSteps = lines.slice(-5);
  lastSteps.forEach((l, idx) => {
    try {
      const obj = JSON.parse(l);
      console.log(`\n--- STEP ${lines.length - 5 + idx} ---`);
      console.log(`Type: ${obj.type} | Status: ${obj.status} | Source: ${obj.source}`);
      if (obj.tool_calls) {
        console.log(`Tool Calls:`, JSON.stringify(obj.tool_calls, null, 2));
      }
      if (obj.content) {
        console.log(`Content snippet: ${obj.content.slice(0, 400)}...`);
      }
    } catch (e) {
      console.log(`Line parse error:`, l.slice(0, 100));
    }
  });
}

readLastLines().catch(console.error);
