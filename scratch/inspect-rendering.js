const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/planificador/page.tsx');
const content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');
console.log('Searching for visibleEmployees.map in app/planificador/page.tsx...');
lines.forEach((line, index) => {
  if (line.includes('visibleEmployees')) {
    console.log(`L${index + 1}: ${line.trim()}`);
    // Print 15 lines after
    for (let i = 1; i <= 15; i++) {
      if (lines[index + i]) {
        console.log(`   +${i}: ${lines[index + i].trim()}`);
      }
    }
  }
});
