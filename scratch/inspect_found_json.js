const fs = require('fs');
const path = require('path');

const scratchDir = 'scratch';
const files = fs.readdirSync(scratchDir);

files.forEach(file => {
  if (!file.startsWith('found_viewmode_') || !file.endsWith('.json')) return;
  const filePath = path.join(scratchDir, file);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    
    // Check tool_calls in JSON
    if (data.tool_calls && Array.isArray(data.tool_calls)) {
      data.tool_calls.forEach((tc, idx) => {
        const args = tc.args || tc.Arguments;
        if (!args) return;
        const target = args.TargetFile || args.TargetFile || '';
        if (target.includes('page.tsx')) {
          console.log(`FOUND edit in ${file} (step ${data.step_index}, tool ${tc.name || tc.ToolName})`);
          const repContent = args.ReplacementContent || args.CodeContent;
          if (repContent) {
            const cleanName = file.replace('.json', '');
            const outPath = `scratch/extracted_${cleanName}_tc${idx}.tsx`;
            fs.writeFileSync(outPath, repContent, 'utf8');
            console.log(`  Saved to ${outPath} (${repContent.length} bytes)`);
          }
        }
      });
    }
  } catch (e) {
    // ignore parsing errors
  }
});
console.log('Scan completed.');
