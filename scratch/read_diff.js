const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'diff_roles.txt');
const outputPath = path.join(__dirname, 'diff_roles_utf8.txt');

console.log('Reading diff_roles.txt...');
const buffer = fs.readFileSync(inputPath);
// Try to decode as UTF-16LE
const content = buffer.toString('utf16le');
console.log('Successfully decoded UTF-16LE content. Total length:', content.length);

// Save as UTF-8
fs.writeFileSync(outputPath, content, 'utf8');
console.log('Saved UTF-8 version to diff_roles_utf8.txt');

// Let's print a preview of the first 20 lines
const lines = content.split('\n');
console.log('=== FIRST 30 LINES ===');
console.log(lines.slice(0, 30).join('\n'));
