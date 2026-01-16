const fs = require('fs');
console.log('Start Debug');
try {
    const data = fs.readFileSync('feedback clientes.csv', 'utf8');
    console.log('File read, length:', data.length);
} catch (e) {
    console.error('Error:', e.message);
}
console.log('End Debug');
