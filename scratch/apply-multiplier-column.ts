import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runMigration() {
    console.log('1. Altering table quickbooks_mappings to add multiplier column...');
    const alterQuery = 'ALTER TABLE quickbooks_mappings ADD COLUMN IF NOT EXISTS multiplier numeric DEFAULT 1';
    const { data: alterResult, error: alterError } = await supabase.rpc('execute_sql', { query_text: alterQuery });
    
    if (alterError) {
        console.error('Alter error:', alterError);
    } else {
        console.log('Alter result:', alterResult);
    }

    console.log('2. Updating multiplier to 60 for Papelito Para Torta (qb_item_id = 540)...');
    const { data: updateResult, error: updateError } = await supabase
        .from('quickbooks_mappings')
        .update({ multiplier: 60 })
        .eq('qb_item_id', '540');
    
    if (updateError) {
        console.error('Update error:', updateError);
    } else {
        console.log('Update success!');
    }

    console.log('3. Deleting incorrect mapping for 2 oz Lettuce Bag (qb_item_id = 523)...');
    const { data: deleteResult, error: deleteError } = await supabase
        .from('quickbooks_mappings')
        .delete()
        .eq('qb_item_id', '523');
    
    if (deleteError) {
        console.error('Delete error:', deleteError);
    } else {
        console.log('Delete success!');
    }

    console.log('4. Verifying mappings...');
    const { data: mappings } = await supabase
        .from('quickbooks_mappings')
        .select('*')
        .eq('inventory_item_id', 'fb83420e-8c32-4e85-a29d-e74de2055807');
    
    console.log(mappings);
}

runMigration();
