const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

function cleanString(str) {
  if (typeof str !== 'string') return str;
  let s = str.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch (e) {
      return s.slice(1, -1);
    }
  }
  return str;
}

function normalizePath(p) {
  const cleaned = cleanString(p);
  if (!cleaned) return '';
  return cleaned.toLowerCase().replace(/\\/g, '/');
}

// 1. Get HEAD content
const headContent = execSync('git show HEAD:app/roles/page.tsx', { maxBuffer: 10 * 1024 * 1024 }).toString();

// 2. Read transcript
const transcriptPath = 'C:/Users/pedro/.gemini/antigravity/brain/7f8d96b2-5c80-4156-a707-9b12d85ca4af/.system_generated/logs/transcript.jsonl';
const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

let currentContent = headContent;
const targetStepLimit = parseInt(process.argv[2] || '3240', 10);
console.log(`Reconstructing app/roles/page.tsx up to step_index <= ${targetStepLimit}`);

lines.forEach((line, idx) => {
  if (!line.trim()) return;
  
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (err) {
    console.error(`Failed to parse line ${idx}:`, err.message);
    return;
  }
  
  const stepIndex = obj.step_index;
  if (stepIndex > targetStepLimit) return;
  
  if (!obj.tool_calls) return;
  
  obj.tool_calls.forEach(tc => {
    const name = tc.name || tc.ToolName || '';
    const args = tc.args || tc.Arguments || {};
    const targetFile = normalizePath(args.TargetFile || args.target_file || args.Target || args.target || '');
    
    if (!targetFile.endsWith('app/roles/page.tsx')) return;
    
    console.log(`Applying step ${stepIndex}: ${name} (line ${idx})`);
    
    if (name === 'write_to_file') {
      const codeContent = cleanString(args.CodeContent || args.code_content || '');
      currentContent = codeContent;
      console.log(`  -> Entire file overwritten (size: ${currentContent.length})`);
    } 
    else if (name === 'replace_file_content') {
      const target = cleanString(args.TargetContent || args.target_content || '');
      const replacement = cleanString(args.ReplacementContent || args.replacement_content || '');
      
      if (!currentContent.includes(target)) {
        console.error(`  -> WARNING: TargetContent not found in step ${stepIndex}!`);
        // Try searching after normalizing newlines
        const normCurrent = currentContent.replace(/\r\n/g, '\n');
        const normTarget = target.replace(/\r\n/g, '\n');
        if (normCurrent.includes(normTarget)) {
          console.log(`  -> Found target with normalized newlines. Replacing...`);
          currentContent = normCurrent.replace(normTarget, replacement.replace(/\r\n/g, '\n'));
        } else {
          console.error(`  -> ERROR: TargetContent completely missing!`);
        }
      } else {
        currentContent = currentContent.replace(target, replacement);
        console.log(`  -> Replaced 1 chunk`);
      }
    } 
    else if (name === 'multi_replace_file_content') {
      let chunks = args.ReplacementChunks || args.replacement_chunks || [];
      if (typeof chunks === 'string') {
        const cleanedChunks = cleanString(chunks);
        try {
          chunks = JSON.parse(cleanedChunks);
        } catch (e) {
          console.log(`  -> JSON parse failed for chunks, attempting eval-based parse...`);
          try {
            chunks = eval('(' + cleanedChunks + ')');
          } catch (evalErr) {
            console.error(`  -> Failed to parse chunks string in step ${stepIndex}:`, evalErr.message);
            return;
          }
        }
      }
      
      console.log(`  -> Processing multi_replace_file_content with ${chunks.length} chunks`);
      
      chunks.forEach((chunk, chunkIdx) => {
        const target = cleanString(chunk.TargetContent || chunk.targetContent || '');
        const replacement = cleanString(chunk.ReplacementContent || chunk.replacementContent || '');
        
        if (!currentContent.includes(target)) {
          console.error(`    -> Chunk ${chunkIdx} WARNING: TargetContent not found!`);
          const normCurrent = currentContent.replace(/\r\n/g, '\n');
          const normTarget = target.replace(/\r\n/g, '\n');
          if (normCurrent.includes(normTarget)) {
            currentContent = normCurrent.replace(normTarget, replacement.replace(/\r\n/g, '\n'));
            console.log(`    -> Chunk ${chunkIdx} replaced with normalized newlines`);
          } else {
            console.error(`    -> Chunk ${chunkIdx} ERROR: TargetContent completely missing!`);
          }
        } else {
          currentContent = currentContent.replace(target, replacement);
        }
      });
    }
  });
});

const outputPath = 'app/roles/page.tsx.restored';
fs.writeFileSync(outputPath, currentContent, 'utf-8');
console.log(`Reconstruction completed! Saved to ${outputPath}`);
