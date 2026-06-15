const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function inspectTranscriptKeys() {
  const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      console.log(`Step ${step.step_index}: source = ${step.source}, type = ${step.type}`);
      console.log('Keys:', Object.keys(step));
      if (step.tool_calls) {
        console.log('tool_calls type:', typeof step.tool_calls, Array.isArray(step.tool_calls));
        console.log('tool_calls:', JSON.stringify(step.tool_calls).substring(0, 300));
      }
      count++;
      if (count >= 10) break;
    } catch (e) {
      console.log('JSON parse error:', e.message);
    }
  }
}

inspectTranscriptKeys();
