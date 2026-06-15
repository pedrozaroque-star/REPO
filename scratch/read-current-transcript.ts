import fs from 'fs';
import readline from 'readline';

const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';

async function readLastLines() {
  if (!fs.existsSync(logPath)) {
    console.error("Log file does not exist at:", logPath);
    return;
  }
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
  // Let's print user inputs from the entire conversation
  lines.forEach((l, idx) => {
    try {
      const obj = JSON.parse(l);
      if (obj.source === 'USER_EXPLICIT' || obj.type === 'USER_INPUT') {
        console.log(`\n--- STEP ${idx} (User Message) ---`);
        console.log(obj.content);
      }
    } catch (e) {
      console.log(`Line parse error:`, l.slice(0, 100));
    }
  });
}

readLastLines().catch(console.error);
