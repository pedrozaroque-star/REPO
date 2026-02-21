
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function verifyAsadaReal() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await supabase.from('quickbooks_mappings').select('*').eq('qb_item_name', 'Carne Asada').single();

    console.log('--- VERIFICACIÓN FINAL CARNE ASADA ---');
    if (data) {
        console.log(`Producto: ${data.qb_item_name}`);
        console.log(`Costo en Sistema: $${data.last_fetch_cost}`);
        if (data.last_fetch_cost === 66.12) {
            console.log('✅ EXCELENTE: El sistema ya tiene los $66.12 de QuickBooks.');
        } else {
            console.log(`❌ ERROR: Sigue diciendo $${data.last_fetch_cost}. Algo falló en la sincronización.`);
        }
    } else {
        console.log('No se encontró el mapeo de Carne Asada.');
    }
}
verifyAsadaReal();
