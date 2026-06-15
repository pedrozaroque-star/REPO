const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      searchDir(fullPath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const lineLower = line.toLowerCase();
        if (lineLower.includes('hombre') || lineLower.includes('mujer') || lineLower.includes('cajera') || lineLower.includes('cocinero') || lineLower.includes('gender') || lineLower.includes('sexo')) {
          console.log(`${fullPath}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
  }
}

console.log('Searching in app/planificador...');
searchDir(path.join(__dirname, '../app/planificador'));
console.log('Searching in components...');
searchDir(path.join(__dirname, '../components'));
