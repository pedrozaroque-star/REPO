const fs = require('fs');
const path = require('path');

try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        console.log('--- ENV SCAN ---');
        lines.forEach(l => {
            if (l.trim() && l.includes('=')) {
                const [k, v] = l.split('=');
                console.log(`${k.trim()}: ${v.trim().substring(0, 5)}... (Length: ${v.trim().length})`);
            }
        });
    } else {
        console.log('MISSING .env.local');
    }
} catch (e) {
    console.log('ERROR READING ENV:', e.message);
}
