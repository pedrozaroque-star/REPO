const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'found_viewmode_7f8d96b2-5c80-4156-a707-9b12d85ca4af_line1122.json');

console.log('Reading file...');
if (!fs.existsSync(filePath)) {
  console.log('File does not exist!');
  process.exit(1);
}

const fileContent = fs.readFileSync(filePath, 'utf8');
console.log('File length:', fileContent.length);

try {
  const data = JSON.parse(fileContent);
  console.log('Successfully parsed JSON!');
  console.log('Step Index:', data.step_index);
  console.log('Source:', data.source);
  console.log('Type:', data.type);
  
  if (data.tool_calls && Array.isArray(data.tool_calls)) {
    console.log('Number of tool calls:', data.tool_calls.length);
    data.tool_calls.forEach((tc, idx) => {
      console.log(`Tool call ${idx}: name=${tc.name}`);
      let args = tc.args || tc.Arguments || {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch(e) {}
      }
      
      console.log('Args keys:', Object.keys(args));
      const target = args.TargetFile || args.target_file || '';
      console.log('TargetFile:', target);
      
      // Let's print replacement or code content length
      const codeContent = args.CodeContent || args.ReplacementContent || '';
      console.log('Code/Replacement content length:', codeContent.length);
      
      if (codeContent) {
        const outPath = path.join(__dirname, `extracted_line1122_tool_${idx}.tsx`);
        fs.writeFileSync(outPath, codeContent, 'utf8');
        console.log(`Saved extracted content to ${outPath}`);
      }
    });
  } else if (data.content) {
    console.log('No tool_calls, but step has content of length:', data.content.length);
    // Let's check if the content itself has a tool call or code block
    const outPath = path.join(__dirname, `extracted_line1122_content.txt`);
    fs.writeFileSync(outPath, data.content, 'utf8');
    console.log(`Saved step content to ${outPath}`);
  }
} catch (e) {
  console.error('Error parsing JSON:', e.message);
}
