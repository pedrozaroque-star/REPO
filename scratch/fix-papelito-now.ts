/**
 * EMERGENCY FIX: Corregir el precio del Papelito Para Torta a $34.80 (case de 60 × $0.58)
 * El sync de QB lo sobrescribió con $0.48 (sin multiplicador)
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function fixPapelito() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const PAPELITO_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807';
    const CORRECT_PRICE = 34.80; // $0.58/pieza × 60 piezas/case

    console.log('🚨 EMERGENCY FIX: Papelito Para Torta');
    
    // 1. Get current state
    const { data: before } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit')
        .eq('id', PAPELITO_ID)
        .single();
    
    console.log(`  ANTES: $${before?.purchase_unit_cost} ($/pieza: $${((before?.purchase_unit_cost || 0) / (before?.quantity_per_unit || 1)).toFixed(4)})`);

    // 2. Fix the price
    const { error } = await supabase
        .from('inventory_items')
        .update({ purchase_unit_cost: CORRECT_PRICE, updated_at: new Date() })
        .eq('id', PAPELITO_ID);

    if (error) {
        console.log(`  ❌ Error: ${error.message}`);
        return;
    }

    // 3. Also update price history with correct price
    await supabase.from('inventory_price_history').insert({
        inventory_item_id: PAPELITO_ID,
        purchase_unit_cost: CORRECT_PRICE,
        effective_date: new Date().toISOString()
    });

    // 4. Fix the mapping last_fetch_cost too
    await supabase
        .from('quickbooks_mappings')
        .update({ last_fetch_cost: CORRECT_PRICE, updated_at: new Date() })
        .eq('qb_item_id', '540');

    // 5. Verify
    const { data: after } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit')
        .eq('id', PAPELITO_ID)
        .single();
    
    console.log(`  DESPUÉS: $${after?.purchase_unit_cost} ($/pieza: $${((after?.purchase_unit_cost || 0) / (after?.quantity_per_unit || 1)).toFixed(4)})`);
    console.log('  ✅ Papelito corregido!');
}

fixPapelito();
