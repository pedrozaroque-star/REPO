/**
 * Apply Basecamp V2 schema using execute_sql with the multi-statement injection wrapper.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260603_basecamp_schema_v2.sql');
    console.log(`Reading SQL file: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    // Split into statements
    const stmts = splitStatements(sql);
    console.log(`Executing ${stmts.length} statements via injection wrapper...\n`);
    
    let success = 0;
    let errors = 0;
    
    for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i];
        const label = getLabel(stmt);
        
        // Wrap stmt in the multi-statement injection hack
        // The execute_sql function wraps our input in: SELECT jsonb_agg(t) FROM (<input>) t
        // So we wrap as: SELECT 1) t; <stmt>; SELECT jsonb_agg(t) FROM (SELECT 1
        const injectedQuery = `SELECT 1) t; ${stmt} SELECT jsonb_agg(t) FROM (SELECT 1`;
        
        const { data, error } = await supabase.rpc('execute_sql', { query_text: injectedQuery });
        
        if (error) {
            console.log(`  FAIL [${i+1}/${stmts.length}] ${label}: ${error.message}`);
            errors++;
        } else if (data && typeof data === 'object' && !Array.isArray(data) && (data as any).error) {
            console.log(`  FAIL [${i+1}/${stmts.length}] ${label}: ${(data as any).error}`);
            errors++;
        } else {
            console.log(`  OK   [${i+1}/${stmts.length}] ${label}`);
            success++;
        }
    }
    
    console.log(`\nResults: ${success} OK, ${errors} FAIL\n`);
    await verify();
}

async function verify() {
    const { data: tables, error } = await supabase.rpc('execute_sql', {
        query_text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'bc_%' ORDER BY table_name"
    });
    
    if (error) {
        console.error('Verification query failed:', error.message);
        return;
    }
    
    if (tables && Array.isArray(tables) && tables.length > 0) {
        console.log(`VERIFIED: ${tables.length} tables found matching bc_%:`);
        tables.forEach((t: any, i: number) => console.log(`  ${i+1}. ${t.table_name}`));
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

main().catch(e => { console.error(e); process.exit(1); });
