const fs = require('fs');
const path = require('path');
const readline = require('readline');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';

async function searchTranscripts() {
  console.log('Searching all conversation transcripts for page.tsx edits containing viewMode...');
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

        for await (const line of rl) {
          if (!line.trim()) continue;
          const step = JSON.parse(line);
          if (step.tool_calls && Array.isArray(step.tool_calls)) {
            for (const tc of step.tool_calls) {
              const name = tc.name || tc.ToolName;
              const args = tc.args || tc.Arguments;
              if (!args) continue;

              if (args.TargetFile && args.TargetFile.endsWith('page.tsx')) {
                const code = args.CodeContent || args.ReplacementContent || '';
                if (code.includes('viewMode') || JSON.stringify(args).includes('viewMode')) {
                  console.log(`FOUND in conversation ${dir}, step ${step.step_index}, tool ${name}`);
                  
                  const outPath = `scratch/found_page_tsx_${dir}_step${step.step_index}.txt`;
                  fs.writeFileSync(outPath, JSON.stringify(args, null, 2), 'utf8');
                  console.log(`Saved to ${outPath}`);
                }
              }
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
