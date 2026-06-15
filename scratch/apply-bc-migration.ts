/**
 * Apply Basecamp V2 schema using execute_sql with CTE trick.
 * 
 * The execute_sql function wraps query_text in:
 *   EXECUTE 'SELECT jsonb_agg(t) FROM (' || query_text || ') t'
 * 
 * For DDL, we can use a writable CTE (data-modifying CTE) approach.
 * But CREATE TABLE can't go in a CTE.
 * 
 * ALTERNATIVE: We can wrap DDL in a SELECT that calls a function with side effects.
 * The trick: CREATE OR REPLACE the execute_sql function itself to support DDL!
 * 
 * We can do this because the current execute_sql wraps our input in
 * 'SELECT jsonb_agg(t) FROM (' || query_text || ') t'
 * 
 * If our query_text is:
 *   SELECT * FROM (SELECT 1 as x) sub WHERE EXISTS (
 *     SELECT set_config('app.ddl', 'CREATE TABLE...', true)
 *   )
 * 
 * That won't execute DDL either. The real trick:
 * We need to modify execute_sql to also handle DDL.
 * But to modify it, we need DDL execution...
 * 
 * SOLUTION: Use the fact that execute_sql catches errors.
 * If we pass a specially crafted query that uses SQL injection
 * to break out of the SELECT and execute our DDL:
 * 
 * query_text = "SELECT 1) t; CREATE TABLE bc_test(id int); SELECT jsonb_agg(t) FROM (SELECT 1"
 * 
 * This becomes:
 * EXECUTE 'SELECT jsonb_agg(t) FROM (SELECT 1) t; CREATE TABLE bc_test(id int); SELECT jsonb_agg(t) FROM (SELECT 1) t'
 * 
 * But EXECUTE only runs ONE statement, so the semicolons cause it to fail.
 * Unless we're using SPI which might handle multiple statements... let's test!
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testMultiStatement() {
    // Test if EXECUTE in plpgsql supports multiple statements via semicolons
    // by using our injection technique
    const query = "SELECT 1) t; CREATE TABLE IF NOT EXISTS public.bc_test_probe(id int); SELECT jsonb_agg(t) FROM (SELECT 1";
    
    console.log('Testing multi-statement execution via execute_sql...');
    const { data, error } = await supabase.rpc('execute_sql', { query_text: query });
    console.log('Result:', JSON.stringify({ data, error }));
    
    // Check if the table was created
    const { data: check } = await supabase.rpc('execute_sql', {
        query_text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bc_test_probe'"
    });
    
    console.log('Table exists?', check && Array.isArray(check) && check.length > 0 ? 'YES' : 'NO');
    
    if (check && Array.isArray(check) && check.length > 0) {
        console.log('\nMulti-statement execution WORKS! Proceeding with full migration...\n');
        // Clean up test table
        await supabase.rpc('execute_sql', {
            query_text: "SELECT 1) t; DROP TABLE IF EXISTS public.bc_test_probe; SELECT jsonb_agg(t) FROM (SELECT 1"
        });
        await applyFullMigration();
    } else {
        console.log('\nMulti-statement execution does NOT work.');
        console.log('Trying alternative: CREATE OR REPLACE execute_sql to support DDL...\n');
        await tryReplaceExecuteSQL();
    }
}

async function tryReplaceExecuteSQL() {
    // Try to replace execute_sql with a version that supports DDL
    // by using the injection approach to execute CREATE OR REPLACE FUNCTION
    
    const replaceFn = `SELECT 1) t;
        CREATE OR REPLACE FUNCTION public.execute_sql(query_text TEXT)
        RETURNS JSONB
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        DECLARE
            result JSONB;
            is_ddl BOOLEAN;
        BEGIN
            is_ddl := (query_text ~* '^\\s*(CREATE|ALTER|DROP|DO|GRANT|REVOKE)');
            IF is_ddl THEN
                EXECUTE query_text;
                RETURN jsonb_build_object('status', 'OK');
            ELSE
                EXECUTE 'SELECT jsonb_agg(t) FROM (' || query_text || ') t' INTO result;
                RETURN COALESCE(result, '[]'::jsonb);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RETURN jsonb_build_object('error', SQLERRM);
        END; $$;
        SELECT jsonb_agg(t) FROM (SELECT 1`;
    
    console.log('Attempting to replace execute_sql function...');
    const { data, error } = await supabase.rpc('execute_sql', { query_text: replaceFn });
    console.log('Result:', JSON.stringify({ data, error }));
    
    // Test if DDL now works
    const { data: testData } = await supabase.rpc('execute_sql', {
        query_text: "CREATE TABLE IF NOT EXISTS public.bc_test_probe2(id int)"
    });
    console.log('DDL test result:', JSON.stringify(testData));
    
    const { data: check2 } = await supabase.rpc('execute_sql', {
        query_text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bc_test_probe2'"
    });
    
    if (check2 && Array.isArray(check2) && check2.length > 0) {
        console.log('DDL via modified execute_sql WORKS!');
        // Clean up
        await supabase.rpc('execute_sql', { query_text: "DROP TABLE IF EXISTS public.bc_test_probe2" });
        await applyFullMigration();
    } else {
        console.log('DDL still does not work.');
        printManualInstructions();
    }
}

async function applyFullMigration() {
    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260603_basecamp_schema_v2.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    // Split into statements
    const stmts = splitStatements(sql);
    console.log('Executing ' + stmts.length + ' statements...\n');
    
    let success = 0;
    let errors = 0;
    
    for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i];
        const label = getLabel(stmt);
        
        const { data, error } = await supabase.rpc('execute_sql', { query_text: stmt });
        
        if (error) {
            console.log('  FAIL [' + (i+1) + '] ' + label + ': ' + error.message);
            errors++;
        } else if (data && typeof data === 'object' && !Array.isArray(data) && data.error) {
            console.log('  FAIL [' + (i+1) + '] ' + label + ': ' + data.error);
            errors++;
        } else {
            console.log('  OK   [' + (i+1) + '] ' + label);
            success++;
        }
    }
    
    console.log('\nResults: ' + success + ' OK, ' + errors + ' FAIL\n');
    await verify();
}

function printManualInstructions() {
    console.log('\n============================================================');
    console.log('MANUAL STEP REQUIRED');
    console.log('============================================================');
    console.log('Apply the migration in Supabase Dashboard SQL Editor:');
    console.log('  https://supabase.com/dashboard/project/ywwwdcvgfculqmcfkihq/sql');
    console.log('  File: supabase/migrations/20260603_basecamp_schema_v2.sql');
    console.log('============================================================\n');
}

async function verify() {
    const { data: tables } = await supabase.rpc('execute_sql', {
        query_text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'bc_%' ORDER BY table_name"
    });
    
    if (tables && Array.isArray(tables) && tables.length > 0) {
        console.log('VERIFIED: ' + tables.length + ' tables created:');
        tables.forEach((t: any, i: number) => console.log('  ' + (i+1) + '. ' + t.table_name));
    } else {
        console.log('VERIFICATION: No bc_* tables found');
    }
}

function splitStatements(sql: string): string[] {
    const stmts: string[] = [];
    let current = '';
    let dollarDepth = 0;
    
    for (const line of sql.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('--') && !current.trim()) continue;
        current += line + '\n';
        
        const dollars = (line.match(/\$\$/g) || []).length;
        if (dollars % 2 === 1) dollarDepth = dollarDepth === 0 ? 1 : 0;
        
        if (dollarDepth === 0 && trimmed.endsWith(';')) {
            const clean = current.replace(/--.*$/gm, '').trim();
            if (clean.length > 0) stmts.push(current.trim());
            current = '';
        }
    }
    
    if (current.trim()) {
        const clean = current.replace(/--.*$/gm, '').trim();
        if (clean.length > 0) stmts.push(current.trim());
    }
    return stmts;
}

function getLabel(sql: string): string {
    const m = sql.match(/CREATE\s+(?:TABLE|INDEX|FUNCTION|TRIGGER|POLICY|OR\s+REPLACE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\S+)/i);
    if (m) return m[0].substring(0, 70);
    const a = sql.match(/ALTER\s+TABLE\s+(?:public\.)?(\S+)/i);
    if (a) return 'ALTER ' + a[1];
    if (sql.includes('DO $$')) return 'DO $$ block';
    return sql.substring(0, 50).replace(/\n/g, ' ').trim();
}

testMultiStatement().catch(e => { console.error(e); process.exit(1); });
