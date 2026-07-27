// Script: Crear tabla inventory_packaging_history en Supabase
// Ejecutar: node scripts/create-packaging-history.js

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log('Checking if inventory_packaging_history table exists...');

    const { data, error: testErr } = await supabase
        .from('inventory_packaging_history')
        .select('id')
        .limit(1);
    
    if (testErr && testErr.message.includes('does not exist')) {
        console.log('❌ Table does not exist. Please create it in Supabase SQL Editor with this SQL:');
        console.log(`
CREATE TABLE inventory_packaging_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    old_quantity_per_unit NUMERIC NOT NULL,
    new_quantity_per_unit NUMERIC NOT NULL,
    old_description TEXT,
    new_description TEXT,
    old_unit_measure TEXT,
    new_unit_measure TEXT,
    par_factor NUMERIC,
    source TEXT DEFAULT 'qb_sync',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_packaging_history_item_date 
    ON inventory_packaging_history(inventory_item_id, created_at DESC);
        `);
    } else {
        console.log('✅ Table inventory_packaging_history already exists!');
    }
}

main().catch(console.error);
