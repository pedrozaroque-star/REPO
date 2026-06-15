import fs from 'fs';
import readline from 'readline';

const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\4ceb2434-e87c-471e-9645-0aa73d71baea\\.system_generated\\logs\\transcript.jsonl';

async function readOldSteps() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  console.log(`Total steps: ${lines.length}`);
  // print steps 3520 to 3580
  const sliceSteps = lines.slice(3520, 3580);
  sliceSteps.forEach((l, idx) => {
    try {
      const obj = JSON.parse(l);
      console.log(`\n--- STEP ${3520 + idx} ---`);
      console.log(`Type: ${obj.type} | Status: ${obj.status} | Source: ${obj.source}`);
      if (obj.thinking) {
        console.log(`Thinking: ${obj.thinking.slice(0, 400)}...`);
      }
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

readOldSteps().catch(console.error);
