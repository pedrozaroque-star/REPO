
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function cleanupZeroCostMappings() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('🔍 Buscando mapeos con costo 0...');

    const { data: zeros, error } = await supabase
        .from('quickbooks_mappings')
        .select('id, qb_item_name, last_fetch_cost')
        .eq('last_fetch_cost', 0);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    if (zeros.length === 0) {
        console.log('✅ No se encontraron mapeos con costo 0.');
        return;
    }

    console.log(`🗑️ Eliminando ${zeros.length} mapeos con costo 0...`);
    zeros.forEach(z => console.log(` - Eliminando: ${z.qb_item_name}`));

    const idsToDelete = zeros.map(z => z.id);
    const { error: delError } = await supabase
        .from('quickbooks_mappings')
        .delete()
        .in('id', idsToDelete);

    if (delError) {
        console.error('Error eliminando:', delError.message);
    } else {
        console.log('✅ Mapeos con costo 0 eliminados exitosamente.');
    }
}

cleanupZeroCostMappings();
