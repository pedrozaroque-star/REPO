import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function runMigration() {
    const connectionString = 'postgresql://postgres:100Prechivas.com@db.ywwwdcvgfculqmcfkihq.supabase.co:5432/postgres';
    console.log('Connecting to database...');
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('✅ Connected successfully!');

        console.log('1. Adding multiplier column to quickbooks_mappings if not exists...');
        await client.query('ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS multiplier numeric DEFAULT 1;');
        console.log('✅ Column added (or already exists).');

        console.log('2. Updating multiplier to 60 for Papelito Para Torta (qb_item_id = 540)...');
        await client.query("UPDATE quickbooks_mappings SET multiplier = 60 WHERE qb_item_id = '540';");
        console.log('✅ Papelito multiplier updated to 60.');

        console.log('3. Deleting incorrect mapping for 2 oz Lettuce Bag (qb_item_id = 523) if still present...');
        await client.query("DELETE FROM quickbooks_mappings WHERE qb_item_id = '523';");
        console.log('✅ Incorrect lettuce bag mapping deleted.');

        console.log('4. Verifying database mappings:');
        const res = await client.query("SELECT * FROM quickbooks_mappings WHERE inventory_item_id = 'fb83420e-8c32-4e85-a29d-e74de2055807';");
        console.log(res.rows);

    } catch (e: any) {
        console.error('Migration error:', e.message);
    } finally {
        await client.end();
    }
}

runMigration();
