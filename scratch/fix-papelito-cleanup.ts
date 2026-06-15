import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function fixPapelitoCost() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const PAPELITO_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807';
    
    // Costo unitario confirmado por el usuario: $0.58 por pieza
    // Case de 60 piezas → costo del case = 60 × $0.58 = $34.80
    const COST_PER_PIECE = 0.58;
    const QTY_PER_CASE = 60;
    const CASE_COST = COST_PER_PIECE * QTY_PER_CASE; // $34.80

    console.log('=== BEFORE ===');
    const { data: before } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
        .eq('id', PAPELITO_ID)
        .single();
    
    console.log(`  ${before?.name}: $${before?.purchase_unit_cost} / ${before?.quantity_per_unit} ${before?.unit_measure}`);
    console.log(`  Cost per piece: $${((before?.purchase_unit_cost || 0) / (before?.quantity_per_unit || 1)).toFixed(4)}`);

    // 1. Update inventory_items with correct CASE cost
    const { error: updateError } = await supabase
        .from('inventory_items')
        .update({
            purchase_unit_cost: CASE_COST,  // $34.80 per case
            quantity_per_unit: QTY_PER_CASE, // 60 pza per case
            unit_measure: 'pza',
            unit_type: 'Case',
            updated_at: new Date()
        })
        .eq('id', PAPELITO_ID);

    if (updateError) { console.error('Error:', updateError.message); return; }

    // 2. Update QB mapping to match
    await supabase
        .from('quickbooks_mappings')
        .update({ last_fetch_cost: CASE_COST, updated_at: new Date() })
        .eq('inventory_item_id', PAPELITO_ID);

    // 3. Clean price history and set correct entry
    await supabase.from('inventory_price_history').delete().eq('inventory_item_id', PAPELITO_ID);
    await supabase.from('inventory_price_history').insert({
        inventory_item_id: PAPELITO_ID,
        purchase_unit_cost: CASE_COST,
        effective_date: new Date().toISOString()
    });

    // 4. Verify
    console.log('\n=== AFTER ===');
    const { data: after } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
        .eq('id', PAPELITO_ID)
        .single();
    
    console.log(`  ${after?.name}: $${after?.purchase_unit_cost} / ${after?.quantity_per_unit} ${after?.unit_measure}`);
    console.log(`  Cost per piece: $${((after?.purchase_unit_cost || 0) / (after?.quantity_per_unit || 1)).toFixed(4)}`);
    console.log(`\n✅ Ahora 1 pza de papelito = $${COST_PER_PIECE.toFixed(2)} en las recetas`);
}

fixPapelitoCost();
