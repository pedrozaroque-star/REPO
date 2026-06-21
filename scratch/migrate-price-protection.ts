/**
 * Migración: Agregar columnas de protección de precios a quickbooks_mappings
 * 
 * - multiplier: Para items que QB tiene por pieza pero DB guarda por case
 * - max_drop_percent: % máximo de caída permitida antes de bloquear
 * 
 * Luego configura el Papelito Para Torta con multiplier=60
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function migrate() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('═══ STEP 1: Add columns via RPC/SQL ═══');
    
    // Use rpc to execute raw SQL for ALTER TABLE
    const { error: sqlError } = await supabase.rpc('exec_sql', {
        sql_query: `
            ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS multiplier decimal DEFAULT 1;
            ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS max_drop_percent decimal DEFAULT 50;
        `
    });

    if (sqlError) {
        console.log(`  RPC method not available: ${sqlError.message}`);
        console.log('  → Trying alternative: direct column test...');
        
        // Test if columns already exist by trying to query them
        const { data: test, error: testErr } = await supabase
            .from('quickbooks_mappings')
            .select('multiplier, max_drop_percent')
            .limit(1);
        
        if (testErr) {
            console.log(`  ❌ Columns don't exist yet. Need manual SQL migration.`);
            console.log('  Run this SQL in the Supabase Dashboard → SQL Editor:');
            console.log('  ─────────────────────────────────────────');
            console.log(`  ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS multiplier decimal DEFAULT 1;`);
            console.log(`  ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS max_drop_percent decimal DEFAULT 50;`);
            console.log('  ─────────────────────────────────────────');
            console.log(`  Then run: UPDATE quickbooks_mappings SET multiplier = 60 WHERE qb_item_id = '540';`);
            return false;
        } else {
            console.log('  ✅ Columns already exist!');
            console.log('  Current values:', JSON.stringify(test?.[0]));
        }
    } else {
        console.log('  ✅ Columns added successfully');
    }

    // STEP 2: Set Papelito multiplier
    console.log('\n═══ STEP 2: Set Papelito multiplier = 60 ═══');
    const { error: updateErr } = await supabase
        .from('quickbooks_mappings')
        .update({ multiplier: 60 })
        .eq('qb_item_id', '540');
    
    if (updateErr) {
        console.log(`  ❌ Error: ${updateErr.message}`);
    } else {
        console.log('  ✅ Papelito multiplier set to 60');
    }

    // STEP 3: Verify
    console.log('\n═══ STEP 3: Verify ═══');
    const { data: verify } = await supabase
        .from('quickbooks_mappings')
        .select('qb_item_id, qb_item_name, multiplier, max_drop_percent, last_fetch_cost')
        .eq('qb_item_id', '540')
        .single();
    
    if (verify) {
        console.log(`  ✅ ${verify.qb_item_name}: multiplier=${verify.multiplier}, max_drop=${verify.max_drop_percent}%, last_cost=$${verify.last_fetch_cost}`);
    }

    return true;
}

migrate();
