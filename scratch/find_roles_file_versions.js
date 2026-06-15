const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function findRolesFileVersions() {
  const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Searching transcript for page.tsx tool calls...');

  let versionCount = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      // Check if step contains tool calls
      if (step.tool_calls && Array.isArray(step.tool_calls)) {
        for (const tc of step.tool_calls) {
          const name = tc.name || tc.ToolName;
          const args = tc.args || tc.Arguments;
          if (!args) continue;

          // Check if TargetFile is page.tsx
          if (args.TargetFile && args.TargetFile.endsWith('page.tsx')) {
            console.log(`Found tool call ${name} targeting page.tsx in step ${step.step_index}`);
            versionCount++;
            
            const outPath = `scratch/roles_version_${step.step_index}_${name}.txt`;
            if (args.CodeContent) {
              fs.writeFileSync(outPath, args.CodeContent, 'utf8');
              console.log(`  Saved CodeContent to ${outPath} (${args.CodeContent.length} chars)`);
            } else if (args.ReplacementContent) {
              fs.writeFileSync(outPath, `Target:\n${args.TargetContent}\n\nReplacement:\n${args.ReplacementContent}`, 'utf8');
              console.log(`  Saved ReplacementContent to ${outPath} (${args.ReplacementContent.length} chars)`);
            } else if (args.ReplacementChunks) {
              fs.writeFileSync(outPath, JSON.stringify(args.ReplacementChunks, null, 2), 'utf8');
              console.log(`  Saved ReplacementChunks to ${outPath} (${args.ReplacementChunks.length} elements)`);
            } else {
              fs.writeFileSync(outPath, JSON.stringify(args, null, 2), 'utf8');
              console.log(`  Saved full args to ${outPath}`);
            }
          }
        }
      }
    } catch (e) {
      // ignore JSON errors
    }
  }
  console.log(`Done! Found ${versionCount} versions.`);
}

findRolesFileVersions();
