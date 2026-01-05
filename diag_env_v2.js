const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), '.env.local');

console.log('Checking path:', envPath);

if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    console.log('--- .env.local content (masked) ---');
    content.split('\n').forEach(line => {
        if (line.includes('=')) {
            const [key, ...REST] = line.split('=');
            const value = REST.join('=');
            console.log(`${key.trim()}: ${value.trim().substring(0, 4)}... (length: ${value.trim().length})`);
        }
    });
} else {
    console.log('.env.local NOT FOUND');
}
