const fs = require('fs');
const path = require('path');

const scratchDir = __dirname;
const files = fs.readdirSync(scratchDir).filter(f => f.startsWith('found_viewmode_4ceb') && f.endsWith('.json'));

console.log(`Checking ${files.length} files from Basecamp conversation...`);

for (const file of files) {
  const filePath = path.join(scratchDir, file);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`\nFile: ${file}, Step: ${data.step_index}, Source: ${data.source}, Type: ${data.type}`);
    if (data.tool_calls) {
      for (let tc of data.tool_calls) {
        console.log(`  Tool: ${tc.name || tc.ToolName}`);
        const args = tc.args || tc.Arguments || {};
        const target = args.TargetFile || args.target_file || args.Target || args.target || '';
        console.log(`  TargetFile: ${target}`);
        
        const code = args.CodeContent || args.code_content || args.ReplacementContent || args.replacement_content || '';
        console.log(`  Content size: ${code.length}`);
        if (code.length > 1000) {
          const outPath = path.join(scratchDir, `basecamp_extracted_${data.step_index}.tsx`);
          fs.writeFileSync(outPath, code, 'utf8');
          console.log(`  Saved extracted code to ${outPath}`);
        }
      }
    }
  } catch (e) {
    console.error(`Error processing ${file}:`, e.message);
  }
}
