/**
 * Execute migration using Supabase's built-in SQL execution via the REST API
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function runMigration() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    console.log('Connecting to Supabase via direct PostgreSQL pooler...');
    
    const { default: pg } = await import('pg');
    
    // Supabase's transaction pooler: uses project ref in the user field
    // Format: postgres://postgres.[project-ref]:[password]@[host]:6543/postgres
    const projectRef = 'ywwwdcvgfculqmcfkihq';
    const dbPassword = process.env.SUPABASE_DB_PASSWORD;
    
    if (!dbPassword) {
        console.log('⚠️ No SUPABASE_DB_PASSWORD in env. Using service role key approach...');
        
        // Alternative: Use Supabase Management API
        // The pg password for hosted Supabase isn't the service role key
        // Let's try the session pooler with the project's DB password
        
        // Actually, let's just use direct REST API to run SQL
        // Supabase has an /sql endpoint for service role
        const sqlEndpoint = `${supabaseUrl}/rest/v1/`;
        
        console.log('Trying direct pg connection with common Supabase pooler formats...');
        
        // Try session pooler (port 5432) with direct connection
        const hosts = [
            `aws-0-us-west-1.pooler.supabase.com`,
            `db.${projectRef}.supabase.co`,
        ];
        
        for (const host of hosts) {
            for (const port of [5432, 6543]) {
                const connStr = `postgresql://postgres.${projectRef}:${serviceRoleKey}@${host}:${port}/postgres?sslmode=require`;
                console.log(`  Trying ${host}:${port}...`);
                const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
                try {
                    await client.connect();
                    console.log(`  ✅ Connected via ${host}:${port}!`);
                    
                    await client.query(`ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS multiplier decimal DEFAULT 1`);
                    console.log('  ✅ Added multiplier column');
                    
                    await client.query(`ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS max_drop_percent decimal DEFAULT 50`);
                    console.log('  ✅ Added max_drop_percent column');
                    
                    await client.query(`UPDATE quickbooks_mappings SET multiplier = 60 WHERE qb_item_id = '540'`);
                    console.log('  ✅ Set Papelito multiplier = 60');
                    
                    const result = await client.query(`SELECT qb_item_id, qb_item_name, multiplier, max_drop_percent FROM quickbooks_mappings WHERE qb_item_id = '540'`);
                    console.log('  ✅ Verification:', result.rows[0]);
                    
                    await client.end();
                    console.log('\n🎉 Migration complete!');
                    return;
                } catch (err: any) {
                    console.log(`    ❌ ${err.message.substring(0, 80)}`);
                    try { await client.end(); } catch {}
                }
            }
        }
        
        console.log('\n❌ Could not connect. You need to run the SQL manually.');
        console.log('Go to: https://supabase.com/dashboard/project/ywwwdcvgfculqmcfkihq/sql/new');
        console.log('And run:');
        console.log('─────────────────────────────────────────');
        console.log(`ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS multiplier decimal DEFAULT 1;`);
        console.log(`ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS max_drop_percent decimal DEFAULT 50;`);
        console.log(`UPDATE quickbooks_mappings SET multiplier = 60 WHERE qb_item_id = '540';`);
        console.log('─────────────────────────────────────────');
    }
}

runMigration();
