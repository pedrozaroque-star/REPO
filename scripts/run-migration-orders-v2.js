/**
 * Script para ejecutar migración SQL directamente contra Supabase.
 * Usa la REST API de PostgREST con un wrapper RPC o el endpoint SQL directo.
 * 
 * Ejecutar: node scripts/run-migration-orders-v2.js
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function executeSqlViaRpc(sql) {
    // Primero, crear la función RPC si no existe
    // Luego ejecutar el SQL a través de ella
    const createFnSql = `
        CREATE OR REPLACE FUNCTION exec_migration(sql_text text) 
        RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN EXECUTE sql_text; END;
        $$;
    `;
    
    // Step 1: Create the RPC function using PostgREST
    // PostgREST can't run DDL directly, but we can use the SQL Editor API
    // The Supabase URL format is: https://<project>.supabase.co
    // Management API: https://api.supabase.com/v1/projects/<project>/database/query
    
    // Alternative: Use the Supabase JS client's from() to call an existing RPC
    // But we need a different approach for DDL...
    
    // Let's try the simplest approach: use supabase-js admin to call a raw SQL function
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        db: { schema: 'public' }
    });
    
    // Try calling exec_migration RPC (may not exist yet)
    const { error: rpcError } = await supabase.rpc('exec_migration', { sql_text: sql });
    if (rpcError) {
        console.log(`  ⚠️ RPC exec_migration no disponible: ${rpcError.message}`);
        return false;
    }
    return true;
}

async function checkTables() {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    
    console.log('📊 Verificando estado de las tablas...\n');
    
    const checks = [
        { name: 'inventory_orders', query: () => supabase.from('inventory_orders').select('id').limit(1) },
        { name: 'inventory_order_lines', query: () => supabase.from('inventory_order_lines').select('id').limit(1) },
        { name: 'inventory_par_ideal', query: () => supabase.from('inventory_par_ideal').select('id').limit(1) },
    ];
    
    let allExist = true;
    for (const check of checks) {
        const { error } = await check.query();
        const exists = !error;
        console.log(`  ${check.name}: ${exists ? '✅ EXISTS' : '❌ MISSING (' + error.message + ')'}`);
        if (!exists) allExist = false;
    }
    
    // Check new columns
    const { data, error: colErr } = await supabase
        .from('inventory_items')
        .select('order_rounding_rule, order_sort_position, order_unit_description')
        .limit(1);
    console.log(`  inventory_items new columns: ${colErr ? '❌ MISSING' : '✅ EXISTS'}`);
    if (colErr) allExist = false;
    
    return allExist;
}

async function main() {
    // First check if migration already applied
    const alreadyDone = await checkTables();
    
    if (alreadyDone) {
        console.log('\n✅ ¡Migración ya aplicada! Todas las tablas existen.');
        return;
    }
    
    console.log('\n🔄 Intentando aplicar migración via RPC...');
    
    // Read migration SQL
    const sqlFile = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260624_inventory_orders_v2.sql'), 
        'utf-8'
    );
    
    // Split into individual statements and try each one
    const statements = sqlFile
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
    
    let success = true;
    for (let i = 0; i < statements.length; i++) {
        const sql = statements[i] + ';';
        const ok = await executeSqlViaRpc(sql);
        if (!ok && i === 0) {
            console.log('\n❌ No se puede ejecutar SQL remotamente via RPC.');
            console.log('   Opciones para aplicar la migración:');
            console.log('');
            console.log('   1️⃣  Dashboard de Supabase → SQL Editor:');
            console.log('      https://supabase.com/dashboard/project/ywwwdcvgfculqmcfkihq/sql');
            console.log('      → Copiar el contenido de: supabase/migrations/20260624_inventory_orders_v2.sql');
            console.log('');
            console.log('   2️⃣  Supabase CLI:');
            console.log('      npx supabase db push');
            console.log('');
            success = false;
            break;
        }
    }
    
    if (success) {
        console.log('\n🔄 Re-verificando tablas...');
        await checkTables();
    }
}

main().catch(e => console.error('Error:', e));
