import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function verify() {
    // Check tables
    const { data: tables, error: tErr } = await sb.rpc('execute_sql', {
        query_text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'bc_%' ORDER BY table_name"
    });
    
    if (tErr) {
        console.log('Error querying tables:', tErr.message);
        return;
    }
    
    console.log('=== BASECAMP V2 TABLES ===');
    console.log('Total tables: ' + (tables?.length || 0));
    if (tables) {
        tables.forEach((t: any, i: number) => {
            console.log('  ' + (i + 1) + '. ' + t.table_name);
        });
    }
    
    // Check RLS
    const { data: rls } = await sb.rpc('execute_sql', {
        query_text: "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'bc_%' ORDER BY tablename"
    });
    
    console.log('\n=== RLS STATUS ===');
    if (rls) {
        rls.forEach((r: any) => {
            console.log('  ' + (r.rowsecurity ? 'ENABLED' : 'DISABLED') + ' - ' + r.tablename);
        });
    }
    
    // Check indexes
    const { data: idx } = await sb.rpc('execute_sql', {
        query_text: "SELECT count(*) as cnt FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'bc_%' AND indexname LIKE 'idx_%'"
    });
    console.log('\n=== INDEXES ===');
    console.log('Total custom indexes: ' + (idx?.[0]?.cnt || 'unknown'));
    
    // Check policies
    const { data: pol } = await sb.rpc('execute_sql', {
        query_text: "SELECT count(*) as cnt FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'bc_%'"
    });
    console.log('\n=== RLS POLICIES ===');
    console.log('Total policies: ' + (pol?.[0]?.cnt || 'unknown'));
    
    // Check triggers
    const { data: trg } = await sb.rpc('execute_sql', {
        query_text: "SELECT count(*) as cnt FROM information_schema.triggers WHERE trigger_schema = 'public' AND trigger_name LIKE 'trg_bc_%'"
    });
    console.log('\n=== TRIGGERS ===');
    console.log('Total triggers: ' + (trg?.[0]?.cnt || 'unknown'));
    
    // Check the updated_at function
    const { data: fn } = await sb.rpc('execute_sql', {
        query_text: "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = 'bc_set_updated_at'"
    });
    console.log('\n=== FUNCTIONS ===');
    console.log('bc_set_updated_at: ' + (fn && fn.length > 0 ? 'EXISTS' : 'MISSING'));
}

verify().catch(e => console.error('Fatal:', e));
