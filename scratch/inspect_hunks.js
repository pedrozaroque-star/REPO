const fs = require('fs');
const path = require('path');

const diffPath = path.join(__dirname, 'diff_roles_utf8.txt');
const diff = fs.readFileSync(diffPath, 'utf8');

const lines = diff.split('\n');
console.log('Total lines in diff:', lines.length);

let hunkCount = 0;
lines.forEach((line, idx) => {
  if (line.startsWith('@@')) {
    hunkCount++;
    console.log(`Hunk ${hunkCount} at line ${idx + 1}: ${line}`);
    // Print next 5 lines
    for (let i = 1; i <= 5; i++) {
      if (lines[idx + i]) {
        console.log(`  ${lines[idx + i]}`);
      }
    }
  }
});
