import fs from 'fs';
import readline from 'readline';

const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\43ac0447-df87-481d-9ccc-33117d59f184\\.system_generated\\logs\\transcript.jsonl';

async function findChat() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  const matches: { idx: number; obj: any }[] = [];
  for await (const line of rl) {
    lineCount++;
    try {
      const obj = JSON.parse(line);
      // Look for user input about cajeros or discounts
      if (obj.content && (obj.content.includes('¿Qué cajeros') || obj.content.includes('Employee Discount') || obj.content.includes('descuentos de tipo'))) {
        matches.push({ idx: lineCount, obj });
      }
    } catch (e) {}
  }

  console.log(`Found ${matches.length} matching lines in transcript.`);
  for (const m of matches) {
    console.log(`\n========================================`);
    console.log(`LINE ${m.idx} | Type: ${m.obj.type} | Source: ${m.obj.source}`);
    console.log(`Content:\n${m.obj.content.slice(0, 1000)}...`);
    if (m.obj.tool_calls) {
      console.log(`Tool Calls:`, JSON.stringify(m.obj.tool_calls, null, 2));
    }
  }
}

findChat().catch(console.error);
