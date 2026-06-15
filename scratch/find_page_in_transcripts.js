const fs = require('fs');
const path = require('path');
const readline = require('readline');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';

async function searchTranscripts() {
  console.log('Searching all conversation transcripts for ANY occurrences of "viewMode"...');
  const dirs = fs.readdirSync(brainDir);
  
  for (const dir of dirs) {
    const logPath = path.join(brainDir, dir, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(logPath)) {
      try {
        const fileStream = fs.createReadStream(logPath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        let lineNum = 0;
        for await (const line of rl) {
          lineNum++;
          if (line.includes('viewMode')) {
            console.log(`FOUND "viewMode" in conversation ${dir}, line ${lineNum}`);
            // Let's parse and print a preview
            try {
              const step = JSON.parse(line);
              console.log(`  Step: ${step.step_index}, Source: ${step.source}, Type: ${step.type}`);
              if (step.tool_calls) {
                console.log(`  Tool calls names:`, step.tool_calls.map(tc => tc.name || tc.ToolName));
              }
              const outPath = `scratch/found_viewmode_${dir}_line${lineNum}.json`;
              fs.writeFileSync(outPath, line, 'utf8');
              console.log(`  Saved full line to ${outPath}`);
            } catch (e) {
              console.log(`  Could not parse JSON:`, e.message);
            }
          }
        }
      } catch (e) {
        // console.error(`Error processing ${dir}:`, e.message);
      }
    }
  }
  console.log('Search completed.');
}

searchTranscripts();
