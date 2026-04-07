import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    console.log('Using DB URL:', process.env.DATABASE_URL ? 'FOUND' : 'NOT FOUND');
    if (!process.env.DATABASE_URL) return;

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS breaks_schedule JSONB DEFAULT '[]'::jsonb;`);
        console.log('Added COLUMN breaks_schedule JSONB to shifts table successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await client.end();
    }
}

run();
