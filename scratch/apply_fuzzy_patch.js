const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '../app/roles/page.tsx');
const diffPath = path.join(__dirname, 'diff_roles_utf8.txt');

const pageContent = fs.readFileSync(pagePath, 'utf8');
const diffContent = fs.readFileSync(diffPath, 'utf8');

// Normalization function to ignore comments, whitespace, emojis, punctuation
function normalize(line) {
  return line
    .replace(/\/\/.*$/, '') // strip inline comments
    .replace(/[^a-zA-Z0-9]/g, '') // keep only alphanumeric characters
    .toLowerCase();
}

console.log('Parsing diff...');
const diffLines = diffContent.split('\n');
const hunks = [];
let currentHunk = null;

for (let line of diffLines) {
  // Strip carriage returns
  line = line.replace('\r', '');
  
  if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
    continue;
  }
  
  if (line.startsWith('@@')) {
    if (currentHunk) {
      hunks.push(currentHunk);
    }
    const match = line.match(/@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/);
    if (match) {
      currentHunk = {
        header: line,
        oldStart: parseInt(match[1]),
        oldLen: match[2] ? parseInt(match[2]) : 1,
        newStart: parseInt(match[3]),
        newLen: match[4] ? parseInt(match[4]) : 1,
        lines: []
      };
    }
  } else if (currentHunk) {
    if (!line.startsWith('\\')) { // Ignore no newline messages
      currentHunk.lines.push(line);
    }
  }
}
if (currentHunk) {
  hunks.push(currentHunk);
}

console.log(`Parsed ${hunks.length} hunks from diff.`);

let fileLines = pageContent.split('\n').map(l => l.replace('\r', ''));
let failedHunks = [];

hunks.forEach((hunk, index) => {
  const oldLines = hunk.lines.filter(l => l.startsWith(' ') || l.startsWith('-')).map(l => l.slice(1));
  const newLines = hunk.lines.filter(l => l.startsWith(' ') || l.startsWith('+')).map(l => l.slice(1));
  
  const oldStartZeroIdx = hunk.oldStart - 1;
  
  let matchIdx = -1;
  if (oldLines.length === 0) {
    // Pure insertion without context? Use line number
    matchIdx = oldStartZeroIdx;
  } else {
    // Normal fuzzy matching
    const normalizedOld = oldLines.map(normalize);
    const searchRange = 200; // Search widely
    
    // We try to find matchIdx
    for (let i = Math.max(0, oldStartZeroIdx - searchRange); i <= Math.min(fileLines.length - oldLines.length, oldStartZeroIdx + searchRange); i++) {
      let isMatch = true;
      for (let j = 0; j < oldLines.length; j++) {
        if (normalize(fileLines[i + j]) !== normalizedOld[j]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matchIdx = i;
        break;
      }
    }
    
    // If not found in range, search the entire file
    if (matchIdx === -1) {
      for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
        let isMatch = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (normalize(fileLines[i + j]) !== normalizedOld[j]) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) {
          matchIdx = i;
          break;
        }
      }
    }
  }

  if (matchIdx !== -1) {
    // Apply hunk
    console.log(`Hunk ${index + 1} matched at line ${matchIdx + 1} (expected around ${hunk.oldStart})`);
    
    // Replace oldLines in fileLines with newLines
    fileLines.splice(matchIdx, oldLines.length, ...newLines);
  } else {
    console.log(`❌ Hunk ${index + 1} FAILED to match:`, hunk.header);
    console.log('Hunk oldLines preview (normalized):');
    oldLines.slice(0, 5).forEach((l, idx) => console.log(`  [${normalize(l)}] : "${l}"`));
    failedHunks.push({ hunk, index });
  }
});

if (failedHunks.length === 0) {
  console.log('All patches applied successfully! Saving updated file...');
  fs.writeFileSync(pagePath, fileLines.join('\n'), 'utf8');
  console.log('File page.tsx saved successfully.');
} else {
  console.log(`❌ Patching failed. ${failedHunks.length} hunks could not be applied.`);
}
