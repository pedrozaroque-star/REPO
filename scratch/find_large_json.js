const fs = require('fs');
const path = require('path');

const scratchDir = __dirname;
const files = fs.readdirSync(scratchDir).filter(f => f.startsWith('found_viewmode_') && f.endsWith('.json'));

const fileSizes = files.map(f => {
  const filePath = path.join(scratchDir, f);
  const stat = fs.statSync(filePath);
  return { name: f, size: stat.size };
});

fileSizes.sort((a, b) => b.size - a.size);

console.log('=== LARGEST JSON FILES ===');
fileSizes.slice(0, 15).forEach((f, idx) => {
  console.log(`${idx + 1}. ${f.name} : ${f.size} bytes`);
});
