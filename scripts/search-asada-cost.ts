
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findAllAsadas() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: qbAll } = await supabase.from('quickbooks_mappings').select('*');

    console.log('--- BUSCANDO "61.2" EN TODOS LOS MAPEOS ---');
    qbAll?.forEach(m => {
        if (m.last_fetch_cost === 61.2) {
            console.log(`- MATCH COSTO 61.2: ${m.qb_item_name} (ID: ${m.qb_item_id})`);
        }
    });

    console.log('\n--- BUSCANDO CUALQUIER COSA CON "ASADA" ---');
    qbAll?.forEach(m => {
        if (m.qb_item_name.toLowerCase().includes('asada')) {
            console.log(`- MATCH NOMBRE ASADA: ${m.qb_item_name} (Costo: $${m.last_fetch_cost})`);
        }
    });
}

findAllAsadas();
