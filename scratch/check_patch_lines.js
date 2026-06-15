const fs = require('fs');
const path = require('path');

const pageContent = fs.readFileSync(path.join(__dirname, '../app/roles/page.tsx'), 'utf8');
const pageLines = pageContent.split('\n');

console.log('=== page.tsx lines 120 to 145 ===');
for (let i = 120; i <= 145; i++) {
  console.log(`${i}: ${pageLines[i - 1]}`);
}

const diffContent = fs.readFileSync(path.join(__dirname, 'diff_roles_utf8.txt'), 'utf8');
const diffLines = diffContent.split('\n');

console.log('\n=== diff_roles_utf8.txt lines around fail (approx line 100-200) ===');
// Let's find any @@ -131 or similar in diff
diffLines.forEach((line, idx) => {
  if (line.includes('@@') && line.includes('131') || line.includes('125') || line.includes('135')) {
    console.log(`Diff Line ${idx + 1}: ${line}`);
    for (let i = 0; i < 15; i++) {
      console.log(`  ${diffLines[idx + i]}`);
    }
  }
});
