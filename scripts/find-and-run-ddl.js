const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const regions = [
    'us-west-1', 'us-west-2', 'us-east-1', 'us-east-2',
    'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
    'ap-southeast-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1',
    'ca-central-1', 'sa-east-1'
];

const username = 'postgres.ywwwdcvgfculqmcfkihq';
const password = '100Prechivas.com';
const dbName = 'postgres';

const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20260701_store_order_template.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

async function testRegion(region) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://${username}:${password}@${host}:6543/${dbName}`;
    
    console.log(`Testing ${region} (${host})...`);
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await client.connect();
        console.log(`\n🎉 SUCCESS! Connected to ${region}`);
        console.log(`Running migration DDL...`);
        await client.query(sql);
        console.log(`✅ Migration applied successfully!`);
        await client.end();
        return true;
    } catch (e) {
        console.log(`❌ Failed for ${region}: ${e.message}`);
        try { await client.end(); } catch (err) {}
        return false;
    }
}

(async () => {
    for (const region of regions) {
        const ok = await testRegion(region);
        if (ok) {
            console.log("\nMigration completed!");
            process.exit(0);
        }
        // Small delay
        await new Promise(r => setTimeout(r, 200));
    }
    console.log("\n❌ Could not connect to any pooler region.");
    process.exit(1);
})();
