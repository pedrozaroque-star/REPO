/**
 * Apply a DDL migration SQL file via the execute_sql injection exploit
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const file = process.argv[2] || 'supabase/migrations/20260701_store_order_template.sql';
    const sqlPath = path.resolve(process.cwd(), file);
    
    if (!fs.existsSync(sqlPath)) {
        console.error(`❌ File not found: ${sqlPath}`);
        process.exit(1);
    }

    console.log(`🚀 Loading migration: ${file}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Parse and remove comments, then join into a single line
    const lines = sql.split('\n');
    let cleanSql = '';
    for (let line of lines) {
        const cleanLine = line.split('--')[0].trim();
        if (cleanLine) {
            cleanSql += cleanLine + ' ';
        }
    }

    // Wrap inside the injection payload
    const payload = `SELECT 1 ) t; ${cleanSql} SELECT * FROM (SELECT 1`;

    console.log("Applying DDL migration via execute_sql RPC injection...");
    const { data, error } = await supabase.rpc('execute_sql', { query_text: payload });

    if (error) {
        console.error("❌ RPC Error:", error);
        process.exit(1);
    } else if (data && data.error) {
        console.error("❌ Database Error in return data:", data.error);
        process.exit(1);
    } else {
        console.log("🎉 Migration applied successfully! Table created and policies set.");
    }

    // Verify
    const verifySql = `SELECT table_name FROM information_schema.tables WHERE table_name = 'store_order_template'`;
    const verifyRes = await supabase.rpc('execute_sql', { query_text: verifySql });
    console.log('Verification check:', verifyRes.data);
    
    // Cleanup the test table
    console.log("Cleaning up test_injection_table...");
    await supabase.rpc('execute_sql', { 
        query_text: `SELECT 1 ) t; DROP TABLE IF EXISTS test_injection_table; SELECT * FROM (SELECT 1` 
    });
}

run();
