import fs from 'fs';

const content = fs.readFileSync('app/roles/page.tsx', 'utf8');
const lines = content.split('\n');

let braceCount = 0;
let parenCount = 0;
let bracketCount = 0;

let openBraces = [];
let openParens = [];

for (let i = 0; i < lines.length; i++) {
  const lineNum = i + 1;
  const line = lines[i];
  
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    
    if (char === '{') {
      braceCount++;
      openBraces.push({ line: lineNum, col: j + 1 });
    } else if (char === '}') {
      braceCount--;
      if (openBraces.length > 0) {
        openBraces.pop();
      } else {
        console.log(`Extra closing brace '}' at line ${lineNum}, col ${j + 1}`);
      }
    } else if (char === '(') {
      parenCount++;
      openParens.push({ line: lineNum, col: j + 1 });
    } else if (char === ')') {
      parenCount--;
      if (openParens.length > 0) {
        openParens.pop();
      } else {
        console.log(`Extra closing paren ')' at line ${lineNum}, col ${j + 1}`);
      }
    } else if (char === '[') {
      bracketCount++;
    } else if (char === ']') {
      bracketCount--;
    }
  }
}

console.log(`End of file counts: braces=${braceCount}, parens=${parenCount}, brackets=${bracketCount}`);
if (openBraces.length > 0) {
  console.log(`Open braces (last 5):`, openBraces.slice(-5));
}
if (openParens.length > 0) {
  console.log(`Open parens (last 5):`, openParens.slice(-5));
}
