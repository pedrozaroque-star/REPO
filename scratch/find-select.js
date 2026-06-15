const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../components/procedimientos/ProceduresTimeline.tsx');
const content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');
console.log('Searching for select elements in ProceduresTimeline.tsx...');
lines.forEach((line, index) => {
  if (line.includes('<select') || line.includes('role')) {
    if (line.includes('value=') || line.includes('option')) {
      console.log(`L${index + 1}: ${line.trim()}`);
    }
  }
});
