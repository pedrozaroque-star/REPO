
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

console.log('--- Current Environment Configuration ---');
console.log('QUICKBOOKS_CLIENT_ID:', process.env.QUICKBOOKS_CLIENT_ID ? process.env.QUICKBOOKS_CLIENT_ID.substring(0, 5) + '...' : 'MISSING');
console.log('QUICKBOOKS_ENVIRONMENT:', process.env.QUICKBOOKS_ENVIRONMENT);
console.log('QUICKBOOKS_REDIRECT_URI:', process.env.QUICKBOOKS_REDIRECT_URI);
console.log('-----------------------------------------');

if (process.env.QUICKBOOKS_ENVIRONMENT !== 'production') {
    console.error('WARNING: Environment is NOT set to production!');
}

if (process.env.QUICKBOOKS_REDIRECT_URI !== 'http://localhost:3000/api/integrations/quickbooks/callback') {
    console.error('WARNING: Redirect URI does not match the expected value!');
}
