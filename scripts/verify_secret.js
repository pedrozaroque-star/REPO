const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Parse .env.local manually
try {
    const envPath = path.join(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) {
        console.log('ERROR: .env.local not found at', envPath);
        process.exit(1);
    }
    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = {};
    envContent.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join('=').trim(); // Handle values with =
            env[key] = value;
        }
    });

    const anon = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    const secret = env['SUPABASE_JWT_SECRET'];

    console.log('Checking keys...');
    if (!anon) console.log('MISSING: NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (!secret) console.log('MISSING: SUPABASE_JWT_SECRET');

    if (!anon || !secret) process.exit(1);

    // Buffer logic
    const rawSecret = secret.trim().replace(/^"(.*)"$/, '$1'); // Remove quotes
    let secretKey = rawSecret;
    // Supabase secrets are 88 chars base64 typically for HS256 (64 bytes)
    if (rawSecret.length === 88 || rawSecret.includes('+') || rawSecret.includes('/')) {
        secretKey = Buffer.from(rawSecret, 'base64');
        console.log('Treating secret as Base64');
    } else {
        console.log('Treating secret as String');
    }

    jwt.verify(anon, secretKey, (err, decoded) => {
        if (err) {
            console.error('FAILURE: Secret mismatch!', err.message);
            // Try string just in case
            try {
                jwt.verify(anon, rawSecret);
                console.log('BUT works as raw string?! (Ambiguous secret format)');
            } catch (e) { }
        } else {
            console.log('SUCCESS: Secret verifies Anon Key.');
        }
    });

} catch (err) {
    console.error('Script Error:', err);
}
