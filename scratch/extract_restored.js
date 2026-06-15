const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/roles/page.tsx.restored');
console.log('Reading file...');
const content = fs.readFileSync(filePath, 'utf8');
console.log('Total characters:', content.length);

// Let's split by line and see what each line contains
const lines = content.split('\n');
console.log('Number of lines:', lines.length);
for (let i = 0; i < Math.min(lines.length, 10); i++) {
  console.log(`Line ${i}: length = ${lines[i].length}, preview = ${lines[i].substring(0, 100)}`);
}

// Let's check if it's a JSON file or what
try {
  const parsed = JSON.parse(content);
  console.log('Successfully parsed as JSON!');
  console.log('Keys:', Object.keys(parsed));
} catch (e) {
  console.log('Failed to parse as JSON:', e.message);
}
